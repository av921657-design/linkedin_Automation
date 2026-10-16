// Diagnostic: open the configured LinkedIn source profile's activity page and
// report what the automation browser actually sees (post containers, text,
// media, network video URLs). Usage: node debug-recent.mjs
import fs from 'node:fs';
import { launch, guardAuth, makeLogger, screenshot } from './src/browser.js';
import { ensureDirs, DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const source = cfg.sources.find((s) => s.type === 'linkedin');
const url = source?.profileUrl;
const log = makeLogger();

if (!url) {
  console.error('No linkedin source in config.json');
  process.exit(1);
}

const mediaHits = [];
const onResponse = (r) => {
  const u = r.url();
  if (
    /\.mp4(\?|$)|\.m3u8|dms\/video|videoplayback|\.m4s(\?|$)|\.ts(\?|$)/i.test(u) &&
    !mediaHits.includes(u)
  ) {
    mediaHits.push(u);
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
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1600).catch(() => {});
    await page.waitForTimeout(1600);
  }

  // Nudge the first video so the player requests its stream (if any).
  const firstVideo = page.locator('video').first();
  if ((await firstVideo.count().catch(() => 0)) > 0) {
    await firstVideo.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }

  const info = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('[data-view-name="feed-full-update"]')];
    const nestedCount = roots.filter((r) => roots.some((o) => o !== r && o.contains(r))).length;
    const posts = roots.map((root) => {
      const t = root.querySelector('[data-testid="expandable-text-box"]');
      const text = (t ? t.innerText : '').trim();
      const anchors = [...root.querySelectorAll('a[href*="urn:li:activity"]')].map((a) => a.href);
      const urn = anchors.length ? (anchors[0].match(/urn:li:activity:\d+/) || [null])[0] : null;
      const imgs = [...root.querySelectorAll('img')]
        .map((i) => i.currentSrc || i.src || '')
        .filter((s) => /licdn\.com\/dms\/image/i.test(s) && !/profile-displayphoto/i.test(s));
      const vids = [...root.querySelectorAll('video')].map(
        (v) => v.currentSrc || v.getAttribute('src') || '',
      );
      return {
        textLen: text.length,
        head: text.slice(0, 80).replace(/\n/g, ' / '),
        urn,
        imgCount: imgs.length,
        img0: imgs[0] ? imgs[0].slice(0, 130) : null,
        vidCount: vids.length,
        vid0: vids[0] ? vids[0].slice(0, 80) : null,
        commentaryCount: root.querySelectorAll('[data-view-name="feed-commentary"]').length,
        cls: String(root.className).slice(0, 70),
      };
    });
    return { rootCount: roots.length, nestedCount, posts };
  });

  console.log(JSON.stringify(info, null, 2));
  console.log('\nMEDIA RESPONSES:');
  for (const u of mediaHits) console.log(u.slice(0, 220));
  if (!mediaHits.length) console.log('(none captured)');

  const shot = await screenshot(page, 'debug-recent');
  console.log('screenshot:', shot);
} finally {
  context.off('response', onResponse);
  await context.close();
}
