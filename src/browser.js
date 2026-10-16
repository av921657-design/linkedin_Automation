import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ROOT } from './paths.js';

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/** True if the page looks like a login wall, checkpoint, or captcha. */
export function isAuthWall(page) {
  const url = page.url();
  if (/\/login|\/checkpoint|\/authwall|\/uas\/login/i.test(url)) return true;
  return false;
}

/** Throws AuthError if the current page is an auth wall. */
export async function guardAuth(page) {
  if (isAuthWall(page)) {
    throw new AuthError(`Not logged in (landed on ${page.url()}). Run \`npm run login\`, then delete state/AUTH_REQUIRED.`);
  }
  // Secondary signal: LinkedIn sometimes keeps the URL but renders the authwall body.
  const hasPasswordField = await page
    .locator('input#session_key, input[name="session_key"]')
    .count()
    .catch(() => 0);
  if (hasPasswordField > 0) {
    throw new AuthError('Login form detected on feed. Session expired — run `npm run login`.');
  }
}

/** Launch the dedicated automation profile. Headful by default. */
export async function launch(cfg) {
  const b = cfg.browser ?? {};
  const profileDir =
    typeof b.profileDir === 'string' && b.profileDir
      ? path.isAbsolute(b.profileDir)
        ? b.profileDir
        : path.join(ROOT, b.profileDir)
      : DIRS.chromeProfile;
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: b.channel || 'chrome',
    headless: Boolean(b.headless),
    locale: b.locale || 'en-US',
    viewport: { width: 1380, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return context;
}

/** Append-only run log: console + logs/run-YYYY-MM-DD.log */
export function makeLogger(logsDir = DIRS.logs) {
  const day = new Date().toISOString().slice(0, 10);
  const file = `${logsDir}/run-${day}.log`;
  return (line) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    fs.appendFileSync(file, stamped + '\n');
  };
}

/** Save a screenshot for post-mortems on failures. Returns the path. */
export async function screenshot(page, label) {
  try {
    const file = `${DIRS.logs}/${Date.now()}-${label.replace(/\W+/g, '-')}.png`;
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}
