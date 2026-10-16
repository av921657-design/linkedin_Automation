import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';

/**
 * Instagram source: scrapes a profile's own posts (captions + media).
 *
 *   {
 *     "type": "instagram",
 *     "profileUrl": "https://www.instagram.com/YOUR-HANDLE/",
 *     "maxPostsPerRun": 10,
 *     "enabled": true
 *   }
 *
 * Requires the automation browser profile to be signed into instagram.com
 * once (npm run login). IG serves the first ~12 posts embedded as JSON in
 * <script type="application/json"> tags; this module walks that JSON for
 * media nodes regardless of schema version. Videos are downloaded from their
 * direct mp4 URL when present. Pinned posts stay pinned at the top of the
 * grid, so they can dominate candidates — the ledger prevents reposts either
 * way.
 */

export async function collectCandidates(source, page, context, log) {
  const url = source.profileUrl;
  if (!url || url.includes('YOUR-HANDLE')) {
    log('[instagram] profileUrl not configured — skipping source.');
    return [];
  }
  const maxPosts = source.maxPostsPerRun ?? 10;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  const loginForm = await page.locator('input[name="username"]').count().catch(() => 0);
  if (/accounts\/login/i.test(page.url()) || loginForm > 0) {
    log('[instagram] Not signed into instagram.com in the automation profile — run `npm run login`, sign in, then retry. Source skipped this run.');
    return [];
  }

  const media = await page.evaluate(() => {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node.shortcode === 'string' && (node.display_url || node.video_url)) {
        found.push(node);
      }
      for (const v of Object.values(node)) walk(v);
    };
    for (const s of document.querySelectorAll('script')) {
      const txt = s.textContent ?? '';
      if (!txt.includes('shortcode')) continue;
      try {
        walk(JSON.parse(txt));
      } catch {
        /* not JSON — ignore */
      }
    }
    return found.slice(0, 40).map((n) => {
      const caption =
        (typeof n.caption === 'string' && n.caption) ||
        n.edge_media_to_caption?.edges?.[0]?.node?.text ||
        '';
      return {
        shortcode: n.shortcode,
        caption: String(caption).trim(),
        image: n.display_url ?? null,
        video: n.video_url ?? null,
        isVideo: Boolean(n.is_video || n.video_url),
        ts: n.taken_at_timestamp ?? n.taken_at ?? 0,
      };
    });
  });

  // Newest first, skip posts without a caption (photo-only reposts have no
  // text to reformat) and skip already-known shortcodes this run.
  media.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const seen = new Set();
  const candidates = [];
  for (const m of media) {
    if (candidates.length >= maxPosts) break;
    if (!m.caption || seen.has(m.shortcode)) continue;
    seen.add(m.shortcode);

    const hash = crypto.createHash('sha256').update(m.shortcode).digest('hex').slice(0, 32);
    const dir = path.join(DIRS.downloads, hash);
    const files = [];
    if (!fs.existsSync(path.join(dir, '.scraped'))) {
      fs.mkdirSync(dir, { recursive: true });
      const src = m.isVideo ? m.video : m.image;
      if (src) {
        await download(context, src, path.join(dir, m.isVideo ? 'video.mp4' : 'image.jpg'));
      }
      fs.writeFileSync(path.join(dir, '.scraped'), 'done');
    }
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isFile() && !f.name.startsWith('.')) files.push(path.join(dir, f.name));
      }
    }

    candidates.push({
      id: `instagram:${m.shortcode}`,
      hash,
      text: m.caption,
      media: files,
      order: m.ts ?? candidates.length,
      source: 'instagram',
      moveTo: () => null,
    });
  }

  log(`[instagram] Found ${candidates.length} post(s) at ${url}`);
  return candidates;
}

async function download(context, url, dest) {
  try {
    const res = await context.request.get(url, { timeout: 45000 });
    if (!res.ok()) return false;
    const buf = await res.body();
    if (!buf || buf.length < 1024) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}
