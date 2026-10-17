#!/usr/bin/env node
/**
 * Restore an encrypted backup archive (created by backup.js) onto this Mac.
 *
 *   node restore.js --list                 show available archives
 *   node restore.js                        restore the newest (asks first)
 *   node restore.js --file <name> --yes    restore a specific archive
 *
 * Extracts config.json, state/, queue/, failed/, chrome-profile/ into the
 * project folder (merge — existing files are overwritten). Close the
 * automation browser first. On a brand-new machine: clone the repo and
 * `npm install` before restoring, then `npm run login` (Chrome login
 * cookies are bound to the machine that created them — Keychain on Mac,
 * DPAPI on Windows — so a fresh login is always required after a restore).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

import { ROOT, DIRS, ensureDirs } from './src/paths.js';
import { passphrase, backupDir } from './src/secrets.js';

const MAGIC = 'LABK1';

function archives(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('linkedin-automation-backup-') && f.endsWith('.tar.gz.enc'))
    .sort()
    .reverse();
}

async function main() {
  const args = process.argv.slice(2);
  const dir = backupDir();
  const list = archives(dir);

  if (args.includes('--list')) {
    console.log(list.length ? list.join('\n') : 'No archives found in ' + dir);
    return;
  }
  if (!list.length) throw new Error('No archives found in ' + dir);

  const fi = args.indexOf('--file');
  const chosen = fi >= 0 ? args[fi + 1] : list[0];
  if (!list.includes(chosen)) throw new Error(`Archive not found: ${chosen} (see --list)`);
  const src = path.join(dir, chosen);

  if (!args.includes('--yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Restore "${chosen}" into ${ROOT}?\nThis overwrites config.json, state/, queue/, failed/ and chrome-profile/. Type yes: `
    );
    rl.close();
    if (answer.trim() !== 'yes') return console.log('Aborted.');
  }

  const buf = fs.readFileSync(src);
  const magic = buf.subarray(0, 5).toString();
  if (magic !== MAGIC) throw new Error('Not a recognized backup container.');
  const salt = buf.subarray(5, 21);
  const iv = buf.subarray(21, 33);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(33, buf.length - 16);

  const pass = passphrase();
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);

  ensureDirs();
  const tmpTar = path.join(DIRS.downloads, `restore-${Date.now()}.tar.gz`);
  const relTar = path.relative(ROOT, tmpTar).split(path.sep).join('/');
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmpTar);
      out.on('error', reject);
      out.on('finish', resolve);
      decipher.on('error', reject);
      Readable.from([data]).pipe(decipher).pipe(out);
    });
  } catch (err) {
    // Every GCM failure (wrong key, edited or half-downloaded file) arrives as
    // "unable to authenticate data", which nobody can act on.
    if (/authenticate|unsupported state/i.test(err.message)) {
      throw new Error(
        `"${chosen}" does not open with this passphrase. Archives keep the passphrase that was active when they were written, ` +
        `so a later ${process.platform === 'win32' ? 'backup:setup:win' : 'backup:setup'} leaves older files unreadable — ` +
        `try an archive from after that change, or restore the original passphrase. (A truncated download also looks like this.)`,
      );
    }
    throw err;
  }
  // Relative operand + cwd, so no drive letter reaches tar's argv (GNU tar
  // reads "D:" as a remote host and fails).
  execFileSync('tar', ['-xzf', relTar], { cwd: ROOT, stdio: 'inherit' });
  fs.rmSync(tmpTar, { force: true });
  console.log('✔ Restored from', chosen);
  console.log('Next steps on a new machine: npm run login, then install the schedule (Mac: ./install-schedule.sh — Windows: npm run schedule:win).');
}

main().catch((err) => {
  console.error(`✖ Restore failed: ${err.message}`);
  process.exitCode = 1;
});
