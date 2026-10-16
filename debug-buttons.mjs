// One-off debug: open the composer and dump every button's attributes.
import fs from 'node:fs';
import { launch } from './src/browser.js';
import { DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());

await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /start a post|create a post/i }).first().click();
await page.waitForTimeout(4000); // let the composer finish loading

const buttons = await page.evaluate(() => {
  const out = [];
  for (const btn of document.querySelectorAll('dialog button, [role="dialog"] button, .share-box button')) {
    out.push({
      aria: btn.getAttribute('aria-label'),
      text: (btn.textContent ?? '').trim().slice(0, 40),
      testid: btn.getAttribute('data-testid'),
      cls: (btn.className ?? '').slice(0, 60),
    });
  }
  return out;
});

console.log(JSON.stringify(buttons, null, 2));
fs.writeFileSync(`${DIRS.logs}/composer-buttons.json`, JSON.stringify(buttons, null, 2));
await context.close();
