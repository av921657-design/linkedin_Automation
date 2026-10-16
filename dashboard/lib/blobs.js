import crypto from 'node:crypto';
import { head, put } from '@vercel/blob';

// Single source of truth for the automation: the runner on the Mac pulls
// config.json from here and pushes its run results back into status/history.
export const CONFIG_PATH = 'dashboard/config.json';
export const STATUS_PATH = 'dashboard/status.json';
export const HISTORY_PATH = 'dashboard/history.json';
export const LEDGER_PATH = 'dashboard/ledger.json';
export const BACKUP_PATH = 'dashboard/backup.json';
// Salted password hash set by the in-app reset; when present it overrides the
// DASHBOARD_PASSWORD env (which stays as the first-login bootstrap only).
export const AUTH_PATH = 'dashboard/auth.json';

/** Read a JSON blob by pathname; null when it does not exist (yet) or fails. */
export async function readJson(pathname) {
  try {
    const meta = await head(pathname);
    const headers = {};
    // Private blobs: the download URL requires the store token (OIDC deployments
    // get it injected; without it the unsigned URL 403s).
    if (process.env.BLOB_READ_WRITE_TOKEN) headers.authorization = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
    // Cache-buster: overwriting a fixed blob path can serve a slightly stale
    // copy from the edge for a few seconds otherwise.
    const res = await fetch(meta.url + (meta.url.includes('?') ? '&' : '?') + '_ts=' + Date.now(), { headers, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

/** Key-sorted stringify so reordering fields never fakes a new version. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function versionOf(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex').slice(0, 12);
}
