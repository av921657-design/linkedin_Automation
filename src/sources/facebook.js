import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';

/**
 * Facebook source: scrapes a page/profile's visible feed posts.
 *
 *   {
 *     "type": "facebook",
 *     "profileUrl": "https://www.facebook.com/YOUR-PAGE",
 *     "maxPostsPerRun": 10,
 *     "enabled": true
 *   }
 *
 * Requires the automation browser profile to be signed into facebook.com once
 * (npm run login). Facebook's DOM changes often and varies per layout; this
 * best-effort pass anchors on div[role="article"] blocks and the ad-preview
 * message container. Expect to iterate on anchors after first live login.
 * Text-only posts are candidates; photo-only posts are skipped (nothing to
 * reformat). Images found inside a post are downloaded best-effort.
 */

export async function collectCandidates(source, page, context, log) {
  const url = source.profileUrl;
  if (!url || /YOUR-(?:HANDLE|PAGE)/i.test(url)) {
    log('[facebook] profileUrl not configured — skipping source.');
    return [];
  }
  const maxPosts = source.maxPostsPerRun ?? 10;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  const loginForm = await page
    .locator('input[name="email"], form[action*="login"]')
    .count()
    .catch(() => 0);
  if (loginForm > 0) {
    log('[facebook] Not signed into facebook.com in the automation profile — run `npm run login`, sign in, then retry. Source skipped this run.');
    return [];
  }

  // Feed loads progressively; scroll a few screens to pull posts in.
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 1800).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const posts = await page.evaluate(() =>
    [...document.querySelectorAll('div[role="article"]')]
      .map((a) => {
        const text =
          a
            .querySelector('[data-ad-preview="message"], div[data-ad-comet-preview]')
            ?.innerText?.trim() ?? '';
        const imgs = [
          ...a.querySelectorAll(
            'a[href*="/photos/"] img, a[href*="/photo"] img, img[src*="scontent"]',
          ),
        ]
          .map((i) => i.src)
          .filter((s) => /scontent/.test(s) && !/s(?:150|320|480|540|720)x/.test(s));
        const link =
          [...a.querySelectorAll('a[href]')]
            .map((x) => x.href)
            .find((h) => /\/posts\/|\/videos\/|\/photo|story_fbid/.test(h)) ?? '';
        return { text, imgs, link };
      })
      .filter((p) => p.text || p.link),
  );

  const seen = new Set();
  const candidates = [];
  for (const p of posts) {
    if (candidates.length >= maxPosts) break;
    if (!p.text) continue; // photo-only posts have nothing to reformat

    const key =
      (p.link.match(/story_fbid=([\w-]+)|\/posts\/([\w.:-]+)|\/videos\/(\d+)/) ?? [])
        .slice(1)
        .find(Boolean) || crypto.createHash('sha256').update(p.text).digest('hex').slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);

    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    const dir = path.join(DIRS.downloads, hash);
    const media = [];
    if (p.imgs.length && !fs.existsSync(path.join(dir, '.scraped'))) {
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < Math.min(p.imgs.length, 4); i++) {
        await download(context, p.imgs[i], path.join(dir, `image-${i + 1}.jpg`));
      }
      fs.writeFileSync(path.join(dir, '.scraped'), 'done');
    }
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isFile() && !f.name.startsWith('.')) media.push(path.join(dir, f.name));
      }
    }

    candidates.push({
      id: `facebook:${key}`,
      hash,
      text: p.text,
      media,
      order: candidates.length,
      source: 'facebook',
      moveTo: () => null,
    });
  }

  log(`[facebook] Found ${candidates.length} post(s) at ${url}`);
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
