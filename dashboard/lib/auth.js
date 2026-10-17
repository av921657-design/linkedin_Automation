import crypto from 'node:crypto';
import { createJson, readJson, stateOf, writeJson, AUTH_PATH } from './blobs';

const COOKIE_NAME = 'dash_auth';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const COOKIE_KEY = 'cadence-session-v1';
// scrypt params kept modest so a login/reset costs ~100ms, not seconds, on serverless.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/**
 * Shared answer for both auth routes when the credential store itself is
 * unreachable — the login or reset must then refuse rather than blame the
 * password the user typed.
 */
export const STORE_UNREADABLE = {
  status: 503,
  error: 'The dashboard cannot read its Vercel Blob store. Set BLOB_READ_WRITE_TOKEN in the project environment variables, connect a Blob store, then redeploy.',
};

/** One-way hash of the password with a random per-reset salt. Never reversible. */
function hashPassword(password, saltHex) {
  return crypto
    .scryptSync(String(password), Buffer.from(saltHex, 'hex'), SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
    .toString('hex');
}

/** The value the auth cookie is derived from. It is a hash, not the password, so a reset
 *  (which changes the hash) invalidates every previously issued cookie automatically. */
function cookieValue(secret) {
  return crypto.createHmac('sha256', COOKIE_KEY).update(String(secret)).digest('hex');
}

/** The stored reset record, or null before the first reset (then the env password governs). */
async function readAuthRecord() {
  const rec = await readJson(AUTH_PATH);
  return rec && typeof rec.hash === 'string' && typeof rec.salt === 'string' ? rec : null;
}

/** Secret the current session cookie must match: the reset hash if one exists, else the bootstrap env password. */
async function activeSecret() {
  const rec = await readAuthRecord();
  return rec ? rec.hash : process.env.DASHBOARD_PASSWORD || '';
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Constant-time string compare. Length leaks are fine; content leaks are not. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function bearerToken(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** Check a candidate password against the stored hash, or the env bootstrap before any reset has run. */
export async function verifyPassword(candidate) {
  if (!candidate) return false;
  const rec = await readAuthRecord();
  if (rec) {
    const a = Buffer.from(hashPassword(candidate, rec.salt), 'hex');
    const b = Buffer.from(rec.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** UI access: valid auth cookie. Machine access (the Mac runner): Bearer SYNC_TOKEN. */
export async function isAuthorized(request) {
  if (isMachine(request)) return 'token';
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const given = cookies[COOKIE_NAME];
  if (!given) return null;
  const secret = await activeSecret();
  if (!secret) return null;
  return safeEqual(given, cookieValue(secret)) ? 'cookie' : null;
}

/** Ingest is token-only: the browser UI must never fake run results. */
export function isMachine(request) {
  const syncToken = process.env.SYNC_TOKEN;
  return syncToken && safeEqual(bearerToken(request), syncToken) ? 'token' : null;
}

/** Build a fresh record + persist it. Returns the new secret so the caller can
 *  mint a cookie without re-reading the blob it just wrote. */
export async function resetPassword(newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const record = {
    v: 1,
    salt,
    hash: hashPassword(newPassword, salt),
    updatedAt: new Date().toISOString(),
    source: 'reset',
  };
  await writeJson(AUTH_PATH, record);
  return { updatedAt: record.updatedAt, secret: record.hash };
}

/**
 * Which credential governs login?
 *   claimed      — dashboard/auth.json holds a salted hash (an in-app reset or claim set it)
 *   bootstrapped — no stored record, so DASHBOARD_PASSWORD is the first-login password
 *   unclaimed    — neither: nothing can sign in until someone sets the first password
 *   unknown      — the blob store could not be read, so no safe conclusion exists
 */
export async function passwordState() {
  const store = await stateOf(AUTH_PATH);
  if (store === 'present') return 'claimed';
  if (store === 'unknown') return 'unknown';
  return process.env.DASHBOARD_PASSWORD ? 'bootstrapped' : 'unclaimed';
}

/**
 * Set the very first password on a deployment that has none. The write is a
 * create-only put, so this can never replace an existing credential — a
 * concurrent claim or a blob read that lied about absence both lose.
 * @returns {{outcome: 'created'|'exists'|'failed', secret: string, updatedAt: string}}
 */
export async function claimPassword(newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const record = {
    v: 1,
    salt,
    hash: hashPassword(newPassword, salt),
    updatedAt: new Date().toISOString(),
    source: 'claim',
  };
  const outcome = await createJson(AUTH_PATH, record);
  return { outcome, secret: record.hash, updatedAt: record.updatedAt };
}

/** Vercel terminates TLS and forwards the original scheme; `next dev` is plain http. */
function wantsSecureCookie(request) {
  const fwd = request?.headers?.get?.('x-forwarded-proto');
  if (fwd) return fwd.split(',')[0].trim() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Set a cookie derived from the CURRENT secret, so a reset logs old sessions out.
 *  Pass `secret` when the caller just wrote one, to avoid a stale blob read. */
export async function authCookieHeader(request, secret) {
  const value = cookieValue(secret ?? (await activeSecret()));
  const secure = wantsSecureCookie(request) ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${MAX_AGE}`;
}

export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
