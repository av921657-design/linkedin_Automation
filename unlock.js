#!/usr/bin/env node
/**
 * Recover dashboard access from the Mac when the password was reset (or the
 * env bootstrap no longer applies). Sends the new password to the hosted
 * /api/reset endpoint with the local SYNC_TOKEN; the token is the trusted-
 * device credential, so the current password is not required.
 *
 * The password is read from stdin (never argv, never printed):
 *   read -r -s -p 'New password: ' pw && printf %s "$pw" | node unlock.js
 * (npm run dashboard:unlock wraps this and hides the input.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './src/paths.js';

const settingsPath = path.join(ROOT, 'state', 'dashboard.json');
let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch {
  console.error(`Missing or unreadable ${settingsPath}. Expected { "url", "token" }.`);
  process.exit(1);
}
const base = String(process.env.DASHBOARD_URL || settings.url || '').replace(/\/+$/, '');
const token = String(process.env.DASHBOARD_TOKEN || settings.token || '');
if (!base || !token) {
  console.error('state/dashboard.json needs a url and a token (SYNC_TOKEN).');
  process.exit(1);
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const password = Buffer.concat(chunks).toString('utf8').replace(/\n+$/, '');
if (password.length < 8) {
  console.error('New password must be at least 8 characters.');
  process.exit(1);
}

try {
  const res = await fetch(`${base}/api/reset`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ newPassword: password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) {
    console.error(`Reset failed: HTTP ${res.status}${j.error ? ` — ${j.error}` : ''}`);
    process.exit(1);
  }
  console.error('Dashboard password reset. Every existing login was signed out; use the new password.');
} catch (err) {
  console.error(`Could not reach the dashboard: ${err.message}`);
  process.exit(1);
}
