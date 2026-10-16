// Diagnostic: play the first video post at 8x muted, capture all dms.licdn.com
// stream URLs, fetch the target video's segments in index order, concatenate
// them into logs/video-sample.mp4 and report the MP4 box/handler structure.
// Usage: node debug-concat.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, guardAuth } from './src/browser.js';
import { ensureDirs, DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const url = cfg.sources.find((s) => s.type === 'linkedin')?.profileUrl;

const streamUrls = [];
ensureDirs();
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());
context.on('response', (r) => {
  const u = r.url();
  if (u.includes('dms.licdn.com') && !streamUrls.includes(u)) streamUrls.push(u);
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
    if (streamUrls.length !== lastCount) {
      lastCount = streamUrls.length;
      stallSince = Date.now();
    }
    const state = await video
      .evaluate((v) => ({ ended: v.ended, current: v.currentTime, dur: v.duration }))
      .catch(() => null);
    if (!state) break;
    if (state.ended) break;
    if (streamUrls.length === lastCount && Date.now() - stallSince > 45000) break;
  }
  await video.evaluate((v) => v.pause()).catch(() => {});

  fs.writeFileSync(path.join(DIRS.logs, 'stream-urls.json'), JSON.stringify(streamUrls, null, 2));
  console.log('total dms URLs captured:', streamUrls.length);

  // Path-shape summary (strip ids/timestamps) to spot init/manifest URLs.
  const shapes = new Map();
  for (const u of streamUrls) {
    const p = new URL(u).pathname
      .replace(/D4E[0-9A-Za-z_-]+/g, '<ID>')
      .replace(/B4E[0-9A-Za-z_-]+/g, '<TOK>')
      .replace(/\d{10,}/g, '<TS>');
    shapes.set(p, (shapes.get(p) || 0) + 1);
  }
  console.log('\nURL shapes:');
  for (const [p, n] of shapes) console.log(String(n).padStart(4), p);

  // Target = first video id seen under playlist/vid.
  const firstSeg = streamUrls.find((u) => /playlist\/vid\/v2\/([^/]+)\/hls-/.test(u));
  const targetId = firstSeg.match(/playlist\/vid\/v2\/([^/]+)\//)[1];
  console.log('\ntarget video id:', targetId);

  const targetSegs = [];
  for (const u of streamUrls) {
    const m = u.match(new RegExp(`playlist/vid/v2/${targetId}/[^/]+/[^/]+/(\\d+)/(\\d+)(\\?|$)`));
    if (m) targetSegs.push({ u, idx: Number(m[1]) });
  }
  targetSegs.sort((a, b) => a.idx - b.idx);
  const dedup = [];
  let prev = -1;
  for (const s of targetSegs) {
    if (s.idx !== prev) dedup.push(s);
    prev = s.idx;
  }
  console.log(
    'target segments:',
    dedup.length,
    'indices',
    dedup[0]?.idx,
    '..',
    dedup[dedup.length - 1]?.idx,
  );

  // Fetch and concatenate.
  const chunks = [];
  for (const s of dedup) {
    const res = await context.request.get(s.u, { timeout: 30000 });
    if (!res.ok()) {
      console.log('segment fetch failed', s.idx, res.status());
      break;
    }
    chunks.push(await res.body());
  }
  const out = Buffer.concat(chunks);
  const dest = path.join(DIRS.logs, 'video-sample.mp4');
  fs.writeFileSync(dest, out);
  console.log('wrote', dest, out.length, 'bytes');

  // Box scan (top-level) and handler scan.
  const scan = [];
  let off = 0;
  while (off + 8 <= out.length && scan.length < 40) {
    let size = out.readUInt32BE(off);
    const type = out.slice(off + 4, off + 8).toString('latin1');
    if (size === 1) size = Number(out.readBigUInt64BE(off + 8));
    else if (size === 0) size = out.length - off;
    if (!/^[\x20-\x7e]{4}$/.test(type) || size < 8 || off + size > out.length) {
      scan.push(`??(${JSON.stringify(type)})@${off}`);
      break;
    }
    scan.push(`${type}+${size}`);
    off += size;
  }
  console.log('\ntop-level boxes:', scan.join(' '));

  const handlers = [];
  let i = 0;
  while ((i = out.indexOf('hdlr', i)) !== -1 && handlers.length < 8) {
    handlers.push(out.slice(i + 12, i + 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
    i += 4;
  }
  console.log('hdlr types:', handlers.join(', '));
  const hasFtyp = out.slice(0, 200).toString('latin1').includes('ftyp');
  console.log('starts with ftyp:', hasFtyp);
} finally {
  await context.close();
}
