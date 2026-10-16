// Diagnostic: fetch a captured LinkedIn HLS playlist URL and inspect its body
// (segment format, pagination) to plan the downloader.
// Usage: node debug-playlist.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, guardAuth } from './src/browser.js';
import { ensureDirs, DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const url = cfg.sources.find((s) => s.type === 'linkedin')?.profileUrl;

const playlistRe = /dms\.licdn\.com\/playlist\/vid\/.+\/hls-/;
const captured = [];

ensureDirs();
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());
context.on('response', (r) => {
  const u = r.url();
  if (playlistRe.test(u) && !captured.includes(u)) captured.push(u);
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page);
  await page.waitForTimeout(4000);
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 1600).catch(() => {});
    await page.waitForTimeout(1200);
  }

  console.log('captured playlist URLs:', captured.length);
  const ids = [
    ...new Set(
      captured.map((u) => (u.match(/playlist\/vid\/v2\/([^/]+)\//) || [])[1]).filter(Boolean),
    ),
  ];
  console.log('unique video ids:', ids.length, ids.slice(0, 8));

  if (captured.length) {
    const sample = captured[0];
    console.log('sample:', sample);
    const res = await context.request.get(sample, { timeout: 30000 });
    console.log('status:', res.status(), 'content-type:', res.headers()['content-type']);
    const body = await res.text();
    console.log('body length:', body.length);
    fs.writeFileSync(path.join(DIRS.logs, 'playlist-sample.txt'), body);
    console.log('--- body head ---');
    console.log(body.slice(0, 2500));

    // Check the /2/ sibling (same id + quality) if present — pagination?
    const sibling = sample.replace(/\/1\/\d+(\?)/, '/2/$1').replace(/\/1\/(\d+)/, '/2/$1');
    if (sibling !== sample) {
      const res2 = await context.request.get(sibling, { timeout: 30000 });
      console.log('\n--- sibling /2/ status:', res2.status());
      const body2 = await res2.text();
      console.log('sibling body length:', body2.length);
      console.log(body2.slice(0, 1200));
    }
  }
} finally {
  await context.close();
}
