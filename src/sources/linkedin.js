import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS } from '../paths.js';
import { guardAuth } from '../browser.js';

/**
 * LinkedIn source: scrapes your OWN posts from another account you control.
 *
 * 2026 feed DOM anchors (hashed CSS classes are ignored on purpose):
 *   post container : smallest ancestor of the text box that also holds the
 *                    post's permalink — LinkedIn dropped the old
 *                    [data-view-name="feed-full-update"] roots (Oct 2026);
 *                    text boxes + urn links are the stable anchors.
 *   post text      : [data-testid="expandable-text-box"] (first inside the post)
 *   post id        : anchor href containing urn:li:activity:<id>
 *   video id       : <img src=".../dms/image/v2/<VIDEO_ID>/videocover-...">
 *
 * Media:
 *   - images are downloaded immediately (licdn.com/dms/image, minus avatars,
 *     company logos and video cover frames);
 *   - videos stream as signed fMP4 HLS segments (Video.js/MSE, blob src), so
 *     they are NOT downloaded while scraping. A session-wide listener records
 *     every signed segment URL the page requests (including idle prefetch).
 *     Each video candidate gets a `fetchVideo` hook that run.js invokes only
 *     for the post about to be reposted: it plays the video muted at 8x to
 *     force-load the remaining segments, then concatenates init (/1/) + media
 *     segments (/2/../N/) into video.mp4.
 */

const ACTIVITY_LINK = 'a[href*="urn:li:activity"]';
const TEXT_BOX = '[data-testid="expandable-text-box"]';

export async function collectCandidates(source, page, context, log) {
  const maxPosts = source.maxPostsPerRun ?? 10;
  const url = source.profileUrl;
  if (!url || url.includes('YOUR-HANDLE')) {
    log('[linkedin] profileUrl not configured — skipping source.');
    return [];
  }
  // Credit line for reposts from this account: "Source @handle".
  const handle = (url.match(/\/in\/([^/?#]+)/) || [])[1] || '';

  // Capture video stream URLs for the whole session (must start before the
  // first navigation: the player prefetches init + first segments while the
  // page is idle, and more arrive while fetchVideo plays the picked post).
  const videoStreams = new Map(); // videoId -> Map(variant -> Map(segIndex -> url))
  const onStreamResponse = (r) => {
    const m = r
      .url()
      .match(
        /dms\.licdn\.com\/playlist\/vid\/v2\/([^/]+)\/(?!video-auto-caption)([^/]+)\/[^/]+\/(\d+)\/\d+/,
      );
    if (!m) return;
    if (!videoStreams.has(m[1])) videoStreams.set(m[1], new Map());
    const variants = videoStreams.get(m[1]);
    if (!variants.has(m[2])) variants.set(m[2], new Map());
    const segs = variants.get(m[2]);
    const idx = Number(m[3]);
    if (!segs.has(idx)) segs.set(idx, r.url());
  };
  context.on('response', onStreamResponse);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page);
  await page.waitForSelector(TEXT_BOX, { timeout: 20000 }).catch(() => {});
  // Nudge lazy-loading.
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1600).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const scraped = await page.evaluate(
    ({ TEXT_BOX, ACTIVITY_LINK }) => {
      // One block per post: from each text box, climb to the smallest ancestor
      // that also contains a post permalink (urn link). Wrapper ancestors that
      // swallow several posts are dropped.
      const roots = [];
      const seen = new Set();
      for (const tb of document.querySelectorAll(TEXT_BOX)) {
        let root = tb.parentElement;
        for (let i = 0; i < 16 && root; i++) {
          if (root.querySelector(ACTIVITY_LINK)) break;
          root = root.parentElement;
        }
        if (!root || seen.has(root)) continue;
        seen.add(root);
        roots.push(root);
      }
      return roots
        .filter((r) => !roots.some((o) => o !== r && r.contains(o)))
        .map((root) => {
          const textEl = root.querySelector(TEXT_BOX);
          const hrefs = [...root.querySelectorAll(ACTIVITY_LINK)].map((a) => a.href);
          const srcs = [...root.querySelectorAll('img')].map(
            (img) => img.currentSrc || img.src || '',
          );
          const images = srcs.filter(
            (s) =>
              /licdn\.com\/dms\/image/i.test(s) &&
              !/profile-displayphoto|company-logo|videocover/i.test(s),
          );
          const cover = srcs.find((s) => /dms\/image\/v2\/[^/]+\/videocover/i.test(s));
          return {
            text: (textEl ? textEl.innerText : '').trim(),
            urn: hrefs.length ? (hrefs[0].match(/urn:li:activity:\d+/) || [null])[0] : null,
            images,
            videoId: cover ? (cover.match(/dms\/image\/v2\/([^/]+)\/videocover/) || [null])[1] : null,
          };
        });
    },
    { TEXT_BOX, ACTIVITY_LINK },
  );

  const candidates = [];
  for (const post of scraped.slice(0, maxPosts)) {
    if (!post.text) continue;
    const { urn, text, images, videoId } = post;
    const hash = crypto.createHash('sha256').update(urn || text).digest('hex').slice(0, 32);
    const dir = path.join(DIRS.downloads, hash);
    const marker = path.join(dir, '.scraped');
    const files = [];

    if (fs.existsSync(marker)) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isFile() && !f.name.startsWith('.')) files.push(path.join(dir, f.name));
      }
    } else {
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < images.length; i++) {
        const dest = path.join(dir, `image-${i + 1}.jpg`);
        if (await download(context, images[i], dest)) files.push(dest);
      }
      fs.writeFileSync(marker, 'done');
    }

    const candidate = {
      id: `linkedin:${hash}`,
      hash,
      text,
      media: files,
      order: candidates.length,
      source: 'linkedin',
      sourceHandle: handle ? `@${handle}` : undefined,
      moveTo: () => null, // LinkedIn source: ledger alone prevents reposts
    };

    if (videoId) {
      candidate.fetchVideo = async () => {
        const dest = path.join(dir, 'video.mp4');
        if (fs.existsSync(dest)) return dest; // downloaded in an earlier run
        return fetchVideoFor(page, context, {
          urn,
          videoId,
          dir,
          log,
          videoStreams,
          onStreamResponse,
        });
      };
    }
    candidates.push(candidate);
  }

  log(`[linkedin] Found ${candidates.length} post(s) at ${url}`);
  return candidates;
}

/**
 * Play the post's video muted at 8x so the player fetches its signed HLS
 * segments, then download init + media segments and concatenate to video.mp4.
 * Segments come from the session-wide capture started in collectCandidates,
 * so init/first segments prefetched while the page was idle are included.
 * Returns the path, or null when the video cannot be assembled (the post is
 * then reposted as text only, mirroring the folder-source fallback).
 */
async function fetchVideoFor(
  page,
  context,
  { urn, videoId, dir, log, videoStreams, onStreamResponse },
) {
  try {
    // Post root for this urn: nearest ancestor div of its permalink that
    // contains the <video> player (replaces the retired feed-full-update root).
    const root = page
      .locator(`a[href*="${urn}"]`)
      .first()
      .locator('xpath=ancestor::div[.//video][1]');
    const video = root.locator('video').first();
    if ((await video.count().catch(() => 0)) === 0) {
      log(`[linkedin] ${videoId}: video element not found — skipping video.`);
      return null;
    }
    await video.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);

    await video
      .evaluate(async (v) => {
        v.muted = true;
        try {
          v.playbackRate = 8;
        } catch {}
        await v.play();
      })
      .catch((e) => log(`[linkedin] ${videoId}: play() failed: ${e.message}`));

    const started = Date.now();
    let lastTotal = 0;
    let stallSince = Date.now();
    while (Date.now() - started < 300000) {
      await page.waitForTimeout(2000);
      const total = [...(videoStreams.get(videoId)?.values() ?? [])].reduce(
        (n, m) => n + m.size,
        0,
      );
      if (total !== lastTotal) {
        lastTotal = total;
        stallSince = Date.now();
      }
      const state = await video
        .evaluate((v) => ({ ended: v.ended, current: v.currentTime }))
        .catch(() => null);
      if (!state) break;
      if (state.ended) break;
      if (total === lastTotal && Date.now() - stallSince > 45000) break;
    }
    await video.evaluate((v) => v.pause()).catch(() => {});

    // Use the variant with the most captured segments; require init (/1/)
    // and a contiguous run 1..N so the file cannot be silently truncated.
    const captured = videoStreams.get(videoId) ?? new Map();
    let best = null;
    let bestN = 0;
    for (const [variant, segs] of captured) {
      if (segs.size > bestN) {
        best = variant;
        bestN = segs.size;
      }
    }
    if (!best) {
      log(`[linkedin] ${videoId}: no stream segments captured — skipping video.`);
      return null;
    }
    const segs = captured.get(best);
    if (!segs.has(1)) {
      log(`[linkedin] ${videoId}: init segment missing — skipping video.`);
      return null;
    }
    const max = Math.max(...segs.keys());
    const missing = [];
    for (let i = 1; i <= max; i++) if (!segs.has(i)) missing.push(i);
    if (missing.length) {
      log(
        `[linkedin] ${videoId}: ${missing.length} segment(s) missing (${missing
          .slice(0, 5)
          .join(', ')}…) — skipping video.`,
      );
      return null;
    }

    const chunks = [];
    for (let i = 1; i <= max; i++) {
      const res = await context.request.get(segs.get(i), { timeout: 30000 }).catch(() => null);
      if (!res || !res.ok()) {
        log(`[linkedin] ${videoId}: segment ${i} fetch failed — skipping video.`);
        return null;
      }
      chunks.push(await res.body());
    }
    const out = Buffer.concat(chunks);
    if (out.length < 10000) {
      log(`[linkedin] ${videoId}: assembled video too small — skipping video.`);
      return null;
    }
    const dest = path.join(dir, 'video.mp4');
    fs.writeFileSync(dest, out);
    log(
      `[linkedin] ${videoId}: video assembled (${(out.length / 1e6).toFixed(1)} MB, ${max - 1} segments).`,
    );
    return dest;
  } finally {
    context.off('response', onStreamResponse);
  }
}

async function download(context, url, dest) {
  try {
    const response = await context.request.get(url, { timeout: 30000 });
    if (!response.ok()) return false;
    const buf = await response.body();
    if (!buf || buf.length < 1024) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}
