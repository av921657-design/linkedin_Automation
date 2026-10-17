#!/usr/bin/env node
/**
 * Daily encrypted backup -> OneDrive.
 *
 * Archives: config.json, state/, queue/, failed/, chrome-profile/ (minus
 * regenerable caches — the profile is ~930 MB of which ~911 MB is cache).
 * Encrypts with AES-256-GCM; the passphrase lives ONLY on this machine —
 * macOS Keychain on the Mac (see src/secrets.js for the resolution order;
 * Windows uses the NTFS-locked state/backup.pass file) and your password
 * manager — never in the repo, never on Vercel, never inside the archive.
 *
 * Report (file, size, sha256) is pushed to the dashboard so you can see
 * "last backup" from anywhere. Run manually: `npm run backup`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { ROOT, DIRS, ensureDirs } from './src/paths.js';
import { dashboardSettings } from './src/sync.js';
import { notify } from './src/notify.js';
import { passphrase, backupDir } from './src/secrets.js';

const MAGIC = Buffer.from('LABK1'); // v1 container: magic|salt(16)|iv(12)|tag(16)|ciphertext
const KEEP = 7;

// Chrome writes gigabytes of this; none of it is login state.
const TAR_EXCLUDES = [
  '--exclude', 'chrome-profile/Default/Cache',
  '--exclude', 'chrome-profile/Default/Code Cache',
  '--exclude', 'chrome-profile/Default/GPUCache',
  '--exclude', 'chrome-profile/Default/GrShaderCache',
  '--exclude', 'chrome-profile/Default/DawnWebGPUCache',
  '--exclude', 'chrome-profile/Default/DawnGraphiteCache',
  '--exclude', 'chrome-profile/GraphiteDawnCache',
  '--exclude', 'chrome-profile/Default/Crashpad',
  '--exclude', 'chrome-profile/Default/Crash Reports',
  '--exclude', 'chrome-profile/Default/component_crx_cache',
  '--exclude', 'chrome-profile/component_crx_cache',
  '--exclude', 'chrome-profile/Default/segmentation_platform',
  '--exclude', 'chrome-profile/Default/Search Logos',
  '--exclude', 'chrome-profile/OptimizationGuideModelsManifest',
  '--exclude', 'chrome-profile/Default/BudgetDatabase',
  '--exclude', 'chrome-profile/Default/blob_storage',
  '--exclude', 'chrome-profile/Default/Download Service',
  '--exclude', 'chrome-profile/Default/File System',
  '--exclude', 'chrome-profile/Default/commerce_subscription_db',
  '--exclude', 'chrome-profile/Default/PersistentOriginTrials',
  '--exclude', 'chrome-profile/Default/Safe Browsing Cookies',
  '--exclude', 'state/run.lock',
  // The archive must not carry its own key: backups sit in OneDrive, and a
  // passphrase inside them would make every cloud copy self-decrypting.
  '--exclude', 'state/backup.pass',
];

async function main() {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace(/(\d{8})(\d{4})/, '$1-$2');
  const outDir = backupDir();
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `linkedin-automation-backup-${stamp}.tar.gz.enc`);
  const tmpTar = path.join(DIRS.downloads, `backup-${Date.now()}.tar.gz`);
  const relTar = path.relative(ROOT, tmpTar).split(path.sep).join('/');

  console.log(`[${new Date().toISOString()}] Creating archive (excluding browser caches)...`);
  // Every operand is relative to ROOT: GNU tar (Git for Windows) parses a
  // leading "D:" as a remote host and dies with "Cannot connect to D:".
  execFileSync('tar', ['-czf', relTar, ...TAR_EXCLUDES, 'config.json', 'state', 'queue', 'failed', 'chrome-profile'], { cwd: ROOT, stdio: 'inherit' });
  const tarSize = fs.statSync(tmpTar).size;
  console.log(`Tar: ${(tarSize / 1024 / 1024).toFixed(1)} MB`);

  // Encrypt: scrypt(passphrase) -> AES-256-GCM, streaming.
  const pass = passphrase();
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  await new Promise((resolve, reject) => {
    const outStream = fs.createWriteStream(out);
    outStream.on('error', reject);
    outStream.write(Buffer.concat([MAGIC, salt, iv]));
    const read = fs.createReadStream(tmpTar);
    read.on('error', reject);
    cipher.on('error', reject);
    // GCM tag is only known after the last byte — keep the file open, then append it.
    cipher.on('end', () => {
      outStream.end(Buffer.concat([cipher.getAuthTag()]));
      outStream.on('finish', resolve);
    });
    read.pipe(cipher).pipe(outStream, { end: false });
  });
  fs.rmSync(tmpTar, { force: true });

  const buf = fs.readFileSync(out);
  const sizeMB = +(buf.length / 1024 / 1024).toFixed(1);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  console.log(`Encrypted archive: ${out} (${sizeMB} MB)`);

  // Retention: newest KEEP archives.
  const all = fs.readdirSync(outDir)
    .filter((f) => f.startsWith('linkedin-automation-backup-') && f.endsWith('.tar.gz.enc'))
    .sort()
    .reverse();
  for (const old of all.slice(KEEP)) {
    fs.rmSync(path.join(outDir, old));
    console.log(`Pruned old backup: ${old}`);
  }

  // Report to the dashboard (best-effort).
  const { url, token, enabled } = dashboardSettings();
  if (enabled) {
    try {
      await fetch(`${url}/api/backup`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ at: new Date().toISOString(), ok: true, file: path.basename(out), sizeMB, sha256 }),
        signal: AbortSignal.timeout(10000),
      });
      console.log('Reported to dashboard.');
    } catch (err) {
      console.log(`Dashboard report failed (backup itself is fine): ${err.message}`);
    }
  }
  console.log('✔ Backup complete.');
}

main().catch((err) => {
  console.error(`✖ Backup failed: ${err.message}`);
  notify('LinkedIn Automation — backup failed', err.message);
  const { url, token, enabled } = dashboardSettings();
  if (enabled) {
    fetch(`${url}/api/backup`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString(), ok: false, error: err.message }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
  process.exitCode = 1;
});
