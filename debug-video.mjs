// Diagnostic: capture the network URLs LinkedIn uses for feed video streaming.
// Usage: node debug-video.mjs
import fs from 'node:fs';
import { launch, guardAuth } from './src/browser.js';
import { ensureDirs, DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const url = cfg.sources.find((s) => s.type === 'linkedin')?.profileUrl;

const all = [];
const onResponse = (r) => {
  try {
    const u = new URL(r.url());
    all.push({ host: u.host, url: r.url() });
  } catch {
    all.push({ host: '(none)', url: r.url() });
  }
};

ensureDirs();
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());
context.on('response', onResponse);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page);
  await page
    .waitForSelector('[data-view-name="feed-full-update"]', { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(3000);

  const bigPlay = page.locator('.vjs-big-play-button').first();
  if ((await bigPlay.count().catch(() => 0)) > 0) {
    await bigPlay.scrollIntoViewIfNeeded().catch(() => {});
    await bigPlay
      .click({ timeout: 4000 })
      .catch((e) => console.log('big-play click failed:', e.message));
  } else {
    console.log('no .vjs-big-play-button; trying video.play()');
    await page.evaluate(() => document.querySelector('video')?.play?.()).catch(() => {});
  }
  await page.waitForTimeout(7000);

  const hosts = {};
  for (const r of all) hosts[r.host] = (hosts[r.host] || 0) + 1;
  console.log('HOSTS:');
  for (const [h, n] of Object.entries(hosts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)) {
    console.log(String(n).padStart(5), h);
  }

  const interesting = [...new Set(all.map((r) => r.url))].filter((u) =>
    /vid|playlist|m3u8|mp4|m4s|fragment|seg(ment)?|stream|dms\.licdn/i.test(u),
  );
  console.log('\nINTERESTING URLS:');
  for (const u of interesting.slice(0, 80)) console.log(u.slice(0, 240));
  if (!interesting.length) console.log('(none)');
} finally {
  context.off('response', onResponse);
  await context.close();
}
