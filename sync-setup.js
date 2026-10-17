#!/usr/bin/env node
/**
 * One-command setup for runner -> dashboard sync (the file `src/sync.js`,
 * `unlock.js` and `recover.js` all read): state/dashboard.json.
 *
 *   node sync-setup.js --url https://<project>.vercel.app --generate
 *   node sync-setup.js --url https://<project>.vercel.app --token <SYNC_TOKEN already in Vercel>
 *   node sync-setup.js --check
 *   printf %s "<dashboard password>" | node sync-setup.js --remember-password
 *
 * The token must exist in BOTH places to work: this file and the Vercel
 * project's `SYNC_TOKEN` environment variable. `--generate` prints the value
 * once so it can be pasted into Vercel; afterwards `--check` proves whether the
 * deployment accepted it. Without a matching pair the runner still works — it
 * posts from the local config.json and simply skips the cloud round-trip.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { ROOT, DIRS } from './src/paths.js';

const FILE = path.join(DIRS.stateDir, 'dashboard.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(settings) {
  fs.mkdirSync(DIRS.stateDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  if (process.platform === 'win32') {
    try {
      execFileSync('icacls', [FILE, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { stdio: 'pipe' });
    } catch (e) {
      console.log(`Warning: icacls lockdown failed (${e.message}). The file is written but not ACL-locked.`);
    }
  }
}

/** Does the live dashboard accept this token? Returns a short verdict line. */
async function probe(url, token) {
  try {
    const res = await fetch(`${url}/api/config`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: true, line: `connected — dashboard config v${body?.version ?? '?'}, ${Array.isArray(body?.config?.sources) ? body.config.sources.length : '?'} source(s)` };
    }
    if (res.status === 401) {
      return { ok: false, line: 'HTTP 401 — the dashboard does not know this token yet. Set it as SYNC_TOKEN in Vercel (Storage/Environment Variables for this project), redeploy, then re-run --check.' };
    }
    return { ok: false, line: `HTTP ${res.status} — the dashboard answered but rejected the request.` };
  } catch (err) {
    return { ok: false, line: `could not reach ${url} (${err.message})` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const valueOf = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const settings = read();

  if (flag('--check')) {
    if (!settings.url || !settings.token) {
      throw new Error(`No url+token in ${path.relative(ROOT, FILE)} — run: node sync-setup.js --url <dashboard url> --generate`);
    }
    const r = await probe(settings.url, settings.token);
    console.log(`Sync ${r.ok ? 'is live' : 'is not working'}: ${r.line}`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }

  if (flag('--remember-password')) {
    if (process.stdin.isTTY) {
      throw new Error('Pipe the password in (so it never sits in shell history or on screen): npm run dashboard:remember');
    }
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const password = Buffer.concat(chunks).toString('utf8').replace(/\n+$/, '');
    if (password.length < 8) throw new Error('Password must be at least 8 characters — nothing was saved.');
    save({ ...settings, password });
    console.log(`Saved to ${path.relative(ROOT, FILE)} (locked to this user, git-ignored). \`npm run dashboard:password\` can now copy it to your clipboard.`);
    return;
  }

  const url = (valueOf('--url') || settings.url || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('Pass --url https://<project>.vercel.app (the deployed dashboard address).');

  let token = valueOf('--token') || settings.token || '';
  let generated = false;
  if (!token) {
    if (!flag('--generate')) {
      throw new Error('No sync token yet. Use --generate to create one, or --token <value> if SYNC_TOKEN is already set in Vercel.');
    }
    token = crypto.randomBytes(32).toString('base64url');
    generated = true;
  }

  const next = { ...settings, url, token };
  save(next);
  console.log(`Saved ${path.relative(ROOT, FILE)} (locked to this user, git-ignored, never committed).`);

  if (generated) {
    console.log('\nOne-time step in Vercel — the runner cannot do this for you:');
    console.log(`  1. Project -> Settings -> Environment Variables -> add SYNC_TOKEN with this exact value:`);
    console.log(`\n     ${token}\n`);
    console.log('  2. Redeploy (env changes apply to new deployments).');
    console.log('  3. Come back here and run: node sync-setup.js --check');
    console.log('  Copy it into your password manager too — recover.js and unlock.js read it from this file.');
  }

  const r = await probe(url, token);
  console.log(`\nProbe: ${r.line}`);
  if (!r.ok && generated) console.log('(expected until the Vercel step above is done — the file is already saved, so --check is all that is left.)');
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
});
