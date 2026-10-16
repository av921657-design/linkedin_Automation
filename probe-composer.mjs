import fs from 'node:fs';
import { launch, guardAuth } from './src/browser.js';
import { DIRS } from './src/paths.js';

// Read-only probe: open the feed composer and report what it contains
// (draft restore? attached media?). Touches nothing, just closes.

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());

await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await guardAuth(page);

const start = page.getByRole('button', { name: /start a post|create a post/i }).first();
await start.waitFor({ state: 'visible', timeout: 20000 });
await start.click();
await page.waitForTimeout(5000);

const dialogs = await page.getByRole('dialog').count();
console.log('dialogs:', dialogs);

const editor = page.locator('[contenteditable="true"][role="textbox"]').first();
if ((await editor.count().catch(() => 0)) > 0) {
  const t = (await editor.innerText().catch(() => '')) ?? '';
  console.log(`editor textLen=${t.length}`);
  console.log('editor head:', JSON.stringify(t.slice(0, 150)));
  console.log('editor tail:', JSON.stringify(t.slice(-150)));
} else {
  console.log('editor: NOT FOUND');
}

for (let i = 0; i < dialogs; i++) {
  const d = page.getByRole('dialog').nth(i);
  const visible = await d.isVisible().catch(() => false);
  const imgs = await d.locator('img').count().catch(() => 0);
  const btns = await d.getByRole('button').allInnerTexts().catch(() => []);
  const srcs = await d
    .locator('img')
    .evaluateAll((els) => els.map((e) => e.currentSrc || e.src || '').slice(0, 12))
    .catch(() => []);
  console.log(`--- dialog ${i} visible=${visible} imgs=${imgs}`);
  console.log('buttons:', btns.slice(0, 15).map((b) => JSON.stringify(b)).join(' | '));
  for (const s of srcs.slice(0, 8)) console.log('img:', s.slice(0, 110));
}

await page.screenshot({ path: 'logs/probe-composer.png' });
console.log('screenshot: logs/probe-composer.png');
await context.close();
console.log('done');
