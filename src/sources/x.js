import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';

/**
 * X / Twitter source: scrapes an account's timeline posts.
 *
 *   {
 *     "type": "x",
 *     "profileUrl": "https://x.com/YOUR-HANDLE",
 *     "maxPostsPerRun": 10,
 *     "enabled": true
 *   }
 *
 * Requires the automation browser profile to be signed into x.com once
 * (npm run login, sign in manually, close the window). Until then the source
 * logs a hint and yields nothing — it never pauses the whole run.
 *
 * Text + images are supported; X videos are blob-streamed and are skipped
 * (posting goes out as text-only for video tweets).
 */

export async function collectCandidates(source, page, context, log) {
  const url = source.profileUrl;
  if (!url || url.includes('YOUR-HANDLE')) {
    log('[x] profileUrl not configured — skipping source.');
    return [];
  }
  const maxPosts = source.maxPostsPerRun ?? 10;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  const loginForm = await page
    .locator('input[autocomplete="username"], input[name="text"]')
    .count()
    .catch(() => 0);
  if (/\/login|\/i\/flow/i.test(page.url()) || loginForm > 0) {
    log('[x] Not signed into x.com in the automation profile — run `npm run login`, sign in, then retry. Source skipped this run.');
    return [];
  }

  await page
    .waitForSelector('article[data-testid="tweet"]', { timeout: 20000 })
    .catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 2000).catch(() => {});
    await page.waitForTimeout(1200);
  }

  const tweets = await page.evaluate(() =>
    [...document.querySelectorAll('article[data-testid="tweet"]')].map((a) => {
      const text = a.querySelector('[data-testid="tweetText"]')?.innerText?.trim() ?? '';
      const time = a.querySelector('time')?.getAttribute('datetime') ?? '';
      const social = a.querySelector('[data-testid="socialContext"]')?.innerText ?? '';
      const imgs = [...a.querySelectorAll('img[src*="pbs.twimg.com/media"]')].map((i) => i.src);
      const link =
        [...a.querySelectorAll('a[href*="/status/"]')]
          .map((x) => x.href)
          .find((h) => /\/status\/\d+/.test(h)) ?? '';
      return { text, time, social, imgs, link };
    }),
  );

  const seen = new Set();
  const candidates = [];
  for (const t of tweets) {
    const statusId = (t.link.match(/\/status\/(\d+)/) ?? [])[1];
    if (!statusId || seen.has(statusId)) continue;
    seen.add(statusId);
    if (!t.text) continue;
    if (/repost|retweeted/i.test(t.social)) continue; // skip retweets

    const hash = crypto.createHash('sha256').update(statusId).digest('hex').slice(0, 32);
    const dir = path.join(DIRS.downloads, hash);
    const media = [];
    if (t.imgs.length && !fs.existsSync(path.join(dir, '.scraped'))) {
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < t.imgs.length; i++) {
        const big = t.imgs[i].replace(/name=(small|medium|normal)/, 'name=large');
        await download(context, big, path.join(dir, `image-${i + 1}.jpg`));
      }
      fs.writeFileSync(path.join(dir, '.scraped'), 'done');
    }
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isFile() && !f.name.startsWith('.')) media.push(path.join(dir, f.name));
      }
    }

    candidates.push({
      id: `x:${statusId}`,
      hash,
      text: t.text,
      media,
      order: Date.parse(t.time) || candidates.length,
      source: 'x',
      moveTo: () => null,
    });
  }

  log(`[x] Found ${candidates.length} post(s) at ${url}`);
  return candidates;
}

async function download(context, url, dest) {
  try {
    const res = await context.request.get(url, { timeout: 30000 });
    if (!res.ok()) return false;
    const buf = await res.body();
    if (!buf || buf.length < 1024) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}
