import crypto from 'node:crypto';
import { BlobNotFoundError, BlobPreconditionFailedError, head, put } from '@vercel/blob';

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

/**
 * Reads are bounded by this, in milliseconds.
 *
 * A store call that cannot be answered does not fail quickly: the SDK retries,
 * so `head()` can sit there for tens of seconds. Unbounded, every request that
 * touches the store hangs with it — the login button spins forever and the
 * function burns its whole timeout instead of saying what is wrong. Reads are
 * also the only place a deadline is safe: a write cut short may still land, so
 * writes keep their natural completion.
 */
const READ_DEADLINE_MS = 4000;

/** Reject rather than wait past the deadline; the underlying call is abandoned. */
function withDeadline(promise, ms = READ_DEADLINE_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`blob store read exceeded ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

/** Read a JSON blob by pathname; null when it does not exist (yet) or fails. */
export async function readJson(pathname) {
  try {
    const meta = await withDeadline(head(pathname));
    const headers = {};
    // Private blobs: the download URL requires the store token (OIDC deployments
    // get it injected; without it the unsigned URL 403s).
    if (process.env.BLOB_READ_WRITE_TOKEN) headers.authorization = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
    // Cache-buster: overwriting a fixed blob path can serve a slightly stale
    // copy from the edge for a few seconds otherwise.
    const res = await withDeadline(fetch(meta.url + (meta.url.includes('?') ? '&' : '?') + '_ts=' + Date.now(), { headers, cache: 'no-store' }));
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

/**
 * Does this blob exist? Only an answer from the store counts as proof of
 * absence: a missing token, a network failure or a suspended store is
 * 'unknown', never 'absent' — otherwise a read failure would look like an
 * unclaimed deployment.
 * @returns {'present'|'absent'|'unknown'}
 */
export async function stateOf(pathname) {
  try {
    await withDeadline(head(pathname));
    return 'present';
  } catch (err) {
    if (err instanceof BlobNotFoundError) return 'absent';
    return 'unknown';
  }
}

/**
 * Why the store cannot be read, as far as the function can tell from its own
 * environment. The two answers need opposite fixes, so they must not share one
 * message: 'no-credentials' means nothing was ever injected (no store attached
 * to the project), 'refused' means a token is present but the store rejected it
 * (suspended, deleted, or a token belonging to a different store).
 * @returns {'no-credentials'|'refused'}
 */
export function storeProblem() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'refused';
  if (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID) return 'refused';
  return 'no-credentials';
}

/**
 * Write only while the pathname is still free. The store enforces this, so a
 * claim can never overwrite an existing record and two racing claims cannot
 * both win.
 * @returns {'created'|'exists'|'failed'} — 'failed' means the store refused or
 * was unreachable, which must be treated as "do not sign anyone in".
 */
export async function createJson(pathname, value) {
  try {
    await put(pathname, JSON.stringify(value, null, 2), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json',
    });
    return 'created';
  } catch (err) {
    // The API reports a colliding pathname as a bad_request carrying its own
    // wording, so match on the message as well as the ETag precondition type.
    const text = String(err?.message ?? err);
    return err instanceof BlobPreconditionFailedError || /exist/i.test(text) ? 'exists' : 'failed';
  }
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
