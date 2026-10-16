/**
 * Where the backup passphrase and the OneDrive backup folder live —
 * cross-platform so backup.js / restore.js work on both macOS and Windows.
 *
 * Passphrase resolution order:
 *   1. BACKUP_PASSPHRASE env var (any platform; for automation only)
 *   2. macOS Keychain item com.av921657-design.linkedin-automation-backup (Mac only —
 *      unchanged from the original flow, `npm run backup:setup`)
 *   3. state/backup.pass file (Windows path; created by
 *      `npm run backup:setup:win`, NTFS-locked to the current user; git-ignored)
 *
 * Backup folder resolution: BACKUP_DIR env → Mac CloudStorage OneDrive scan →
 * Windows %OneDrive% folder → error with a hint.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT } from './paths.js';

const KEYCHAIN_SERVICE = 'com.av921657-design.linkedin-automation-backup';
export const PASS_FILE = path.join(ROOT, 'state', 'backup.pass');

export function passphrase() {
  const env = process.env.BACKUP_PASSPHRASE;
  if (env && env.trim()) return env.trim();

  if (process.platform === 'darwin') {
    try {
      return execFileSync(
        'security',
        ['find-generic-password', '-a', os.userInfo().username, '-s', KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf8' },
      ).trim();
    } catch {
      /* fall through to the file, then the shared error below */
    }
  }

  if (fs.existsSync(PASS_FILE)) {
    const v = fs.readFileSync(PASS_FILE, 'utf8').trim();
    if (v) return v;
  }

  const setupCmd =
    process.platform === 'win32' ? 'npm run backup:setup:win' : 'npm run backup:setup';
  throw new Error(
    `No backup passphrase found (env BACKUP_PASSPHRASE / state/backup.pass${
      process.platform === 'darwin' ? ' / Keychain' : ''
    }). One-time setup: ${setupCmd}`,
  );
}

export function backupDir() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;

  if (process.platform === 'darwin') {
    const cs = path.join(os.homedir(), 'Library', 'CloudStorage');
    let od;
    try {
      od = fs.readdirSync(cs).find((d) => d.startsWith('OneDrive'));
    } catch {
      /* no CloudStorage — fall through */
    }
    if (od) return path.join(cs, od, 'linkedin-automation-backups');
  }

  if (process.platform === 'win32') {
    const od = process.env.OneDrive || path.join(os.homedir(), 'OneDrive');
    return path.join(od, 'linkedin-automation-backups');
  }

  throw new Error(
    'OneDrive backup folder not found — sign into OneDrive, or set BACKUP_DIR to the folder path.',
  );
}
