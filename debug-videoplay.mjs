// Diagnostic: play the first video post at 8x (muted), capture every signed
// playlist/vid request, then fetch the segments and concatenate them into
// logs/video-sample.mp4. Reports capture coverage and MP4 box structure.
// Usage: node debug-videoplay.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, guardAuth } from './src/browser.js';
import { ensureDirs, DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const url = cfg.sources.find((s) => s.type === 'linkedin')?.profileUrl;
const TARGET_ID = process.argv[2] || null; // optional video id filter

const segs = [];
ensureDirs();
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());
context.on('response', (r) => {
  const u = r.url();
  if (u.includes('playlist/vid') && !segs.includes(u)) segs.push(u);
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page);
  await page
    .waitForSelector('[data-view-name="feed-full-update"]', { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const firstPost = page.locator('[data-view-name="feed-full-update"]').first();
  const video = firstPost.locator('video').first();
  await video.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1200);

  const started = Date.now();
  await video
    .evaluate(async (v) => {
      v.muted = true;
      try {
        v.playbackRate = 8;
      } catch {}
      await v.play();
    })
    .catch((e) => console.log('play() failed:', e.message));

  let lastCount = 0;
  let stallSince = Date.now();
  while (Date.now() - started < 150000) {
    await page.waitForTimeout(2000);
    if (segs.length !== lastCount) {
      lastCount = segs.length;
      stallSince = Date.now();
    }
    const state = await video
      .evaluate((v) => ({
        ended: v.ended,
        paused: v.paused,
        current: v.currentTime,
        dur: v.duration,
      }))
      .catch(() => null);
    if (!state) break;
    console.log(
      `t=${((Date.now() - started) / 1000).toFixed(0)}s segs=${segs.length} current=${Number(state.current).toFixed(1)} dur=${Number(state.dur).toFixed(1)} ended=${state.ended} paused=${state.paused}`,
    );
    if (state.ended) break;
    if (state.paused && state.current > 0 && Date.now() - stallSince > 8000) break;
    if (segs.length === lastCount && Date.now() - stallSince > 60000) break;
  }
  await video.evaluate((v) => v.pause()).catch(() => {});

  console.log('\ncaptured playlist urls:', segs.length);
  for (const u of segs) console.log('  ', u.slice(-100));
} finally {
  await context.close();
}

// Group captured segments and describe indices for the target/first video id.
const byId = new Map();
for (const u of segs) {
  const m = u.match(/playlist\/vid\/v2\/([^/]+)\//);
  if (!m) continue;
  if (!byId.has(m[1])) byId.set(m[1], []);
  byId.get(m[1]).push(u);
}
console.log('\nvideo ids seen:', [...byId.keys()].join(', '));
