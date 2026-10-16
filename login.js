import fs from 'node:fs';

const FEED_URL = 'https://www.linkedin.com/feed/';

/**
 * One-time setup: opens the automation Chrome profile and waits until you
 * are logged in to LinkedIn (up to 5 minutes), then exits and clears any
 * stale AUTH_REQUIRED flag.
 */
const { launch, isAuthWall } = await import('./src/browser.js');
const { ensureDirs, DIRS } = await import('./src/paths.js');
const { notify } = await import('./src/notify.js');

ensureDirs();

console.log('Opening Chrome with the automation profile…');
console.log('Log in to LinkedIn in the window that opens (you have 5 minutes).');

const context = await launch(JSON.parse(fs.readFileSync(DIRS.config, 'utf8')));
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

const deadline = Date.now() + 5 * 60 * 1000;
let ok = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(3000);
  const url = page.url();
  if (/\/feed\//.test(url) && !isAuthWall(page)) {
    // Extra confirmation: the composer button exists.
    const hasComposer = await page.getByRole('button', { name: /start a post/i }).count().catch(() => 0);
    if (hasComposer > 0) {
      ok = true;
      break;
    }
  }
}

await context.close();

if (ok) {
  fs.rmSync(DIRS.authFlag, { force: true });
  console.log('✔ Logged in. The automation can now post. You can close this terminal.');
  notify('LinkedIn Automation', 'Login saved — automation ready.');
} else {
  console.log('✖ Timed out waiting for login. Run `npm run login` and try again.');
  process.exitCode = 1;
}
