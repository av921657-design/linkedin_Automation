#!/usr/bin/env node
/**
 * One-time backup-passphrase setup for machines without a macOS Keychain
 * (Windows / Linux). Writes the passphrase to state/backup.pass — a
 * git-ignored file — and locks it to the current user (icacls on Windows,
 * chmod 600 elsewhere). The passphrase is never printed or echoed.
 *
 *   npm run backup:setup:win        (or: node windows/backup-setup.mjs)
 *
 * On a Mac you don't need this: `npm run backup:setup` stores the same
 * passphrase in the Keychain (which src/secrets.js prefers anyway).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { PASS_FILE } from '../src/secrets.js';

/** Read one hidden line from the terminal (echo suppressed). */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onKey = (chunk) => {
      for (const c of chunk.toString()) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onKey);
          process.stdout.write('\n');
          resolve(buf);
          return;
        } else if (c === '\u0003') {
          process.exit(130); // Ctrl-C
        } else if (c === '\u007f' || c === '\b') {
          buf = buf.slice(0, -1);
        } else if (c >= ' ') {
          buf += c;
        }
      }
    };
    stdin.on('data', onKey);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error('Run this in an interactive terminal (it prompts with hidden input).');
  }
  if (fs.existsSync(PASS_FILE) && fs.readFileSync(PASS_FILE, 'utf8').trim()) {
    console.log('state/backup.pass already exists. Delete it first if you mean to replace the passphrase.');
    return;
  }
  const a = await askHidden('Backup passphrase (typing is hidden): ');
  const b = await askHidden('Type it again to confirm: ');
  if (!a.trim()) throw new Error('Empty passphrase — aborted.');
  if (a !== b) throw new Error('The two entries did not match — nothing was saved.');

  fs.mkdirSync(path.dirname(PASS_FILE), { recursive: true });
  fs.writeFileSync(PASS_FILE, a, { encoding: 'utf8', mode: 0o600 });

  if (process.platform === 'win32') {
    // Restrict the file to the current user: drop inherited ACLs, grant only
    // this user Full Control. Best-effort — warn, don't fail, if icacls trips.
    try {
      execFileSync('icacls', [PASS_FILE, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { stdio: 'pipe' });
    } catch (e) {
      console.log(`Warning: icacls lockdown failed (${e.message}). The file is written but not ACL-locked.`);
    }
  } else {
    fs.chmodSync(PASS_FILE, 0o600);
  }

  console.log('✔ Passphrase saved to state/backup.pass (locked to your user; never committed — state/ is git-ignored).');
  console.log('Next: node restore.js  (decrypts the newest OneDrive backup)');
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
});
