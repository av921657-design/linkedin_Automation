import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS } from './paths.js';

/**
 * Dashboard sync (Mac -> Vercel), fully optional and failure-tolerant:
 *
 *   pull  — at run start, fetch config.json from the hosted dashboard.
 *           Falls back to the last cached remote copy, then to local config.json.
 *   push  — after a run, send a small status summary (result, counts, error).
 *           Never fails the run.
 *
 * Local settings live in state/dashboard.json (git-ignored):
 *   { "url": "https://<project>.vercel.app", "token": "<SYNC_TOKEN>" }
 * env DASHBOARD_URL / DASHBOARD_TOKEN override it. The file can also mark
 * `"mode": "sync"` to force the dashboard config even when the cache is stale;
 * default mode "prefer-dashboard" always trusts a valid remote config first.
 */

const CONNECT_TIMEOUT_MS = 8000;

/**
 * A rejected token is a provisioning mistake, not a transient fault, so saying
 * it once per run is enough — otherwise every wake of an unsynced machine logs
 * the same three failures. Per-process: a long-lived process that starts
 * working mid-run is still picked up.
 */
let tokenRejected = false;
function noteRejection(log, status) {
  if (status !== 401 && status !== 403) return false;
  if (!tokenRejected) {
    tokenRejected = true;
    log(`Dashboard refused the sync token (HTTP ${status}) — cloud config, status and ledger sync are off for this run. Check it with: npm run sync:check`);
  }
  return true;
}

export function dashboardSettings() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(DIRS.stateDir, 'dashboard.json'), 'utf8'));
  } catch {
    /* no file = sync disabled */
  }
  const url = (process.env.DASHBOARD_URL || file.url || '').replace(/\/+$/, '');
  const token = process.env.DASHBOARD_TOKEN || file.token || '';
  return { url, token, enabled: Boolean(url && token) };
}

function versionOf(obj) {
  const stable = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  };
  return crypto.createHash('sha256').update(stable(obj)).digest('hex').slice(0, 12);
}

function localConfig() {
  return JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
}

function writeCache(cfg) {
  try {
    fs.mkdirSync(DIRS.stateDir, { recursive: true });
    fs.writeFileSync(path.join(DIRS.stateDir, 'remote-config.json'), JSON.stringify(cfg, null, 2) + '\n');
  } catch {
    /* non-fatal */
  }
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIRS.stateDir, 'remote-config.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Shape guard only — the full rules live in dashboard/lib/validate.js. This
 *  rejects a payload so malformed that a run would crash on it, and nothing
 *  more: an out-of-range number must never stop the machine from posting. */
function isSaneConfig(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (!Array.isArray(obj.sources)) return false;
  if (obj.sources.some((s) => !s || typeof s !== 'object' || typeof s.type !== 'string')) return false;
  const pool = obj.reformat?.autoHashtags?.pool;
  if (pool !== undefined && (!Array.isArray(pool) || pool.some((t) => typeof t !== 'string'))) return false;
  // Lenient on the optional engagement block: right shapes or absent.
  if (obj.engagement !== undefined && (typeof obj.engagement !== 'object' || obj.engagement === null)) return false;
  for (const k of ['pool', 'handles', 'keywords']) {
    if (Array.isArray(obj.engagement?.[k]) && obj.engagement[k].some((t) => typeof t !== 'string')) return false;
  }
  return true;
}

/**
 * Resolve the config for this run. Returns { cfg, origin, version }.
 * origin: 'dashboard' | 'dashboard-cache' | 'local'
 */
export async function resolveConfig(log) {
  const local = localConfig();
  const { url, token, enabled } = dashboardSettings();
  if (!enabled) {
    return { cfg: local, origin: 'local', version: versionOf(local) };
  }
  try {
    const res = await fetch(`${url}/api/config`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json();
      if (isSaneConfig(body?.config)) {
        writeCache(body.config);
        return { cfg: body.config, origin: 'dashboard', version: body.version ?? versionOf(body.config) };
      }
      log('Dashboard config failed sanity checks — ignoring it this run.');
    } else if (!noteRejection(log, res.status)) {
      log(`Dashboard config fetch returned HTTP ${res.status} — using fallback.`);
    }
  } catch (err) {
    log(`Dashboard unreachable (${err.message}) — using fallback.`);
  }
  const cached = readCache();
  if (isSaneConfig(cached)) return { cfg: cached, origin: 'dashboard-cache', version: versionOf(cached) };
  return { cfg: local, origin: 'local', version: versionOf(local) };
}

function countDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

function countFiles(dir) {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/** Push a run summary; swallow every error — telemetry must never break posting. */
export async function pushStatus(info, log) {
  const { url, token, enabled } = dashboardSettings();
  if (!enabled || tokenRejected) return;
  try {
    const payload = {
      ...info,
      counts: {
        postedTotal: info.counts?.postedTotal ?? 0,
        queue: countDirs(DIRS.queue),
        failedDir: countFiles(DIRS.failed),
        retriesPending: info.counts?.retriesPending ?? 0,
      },
    };
    const res = await fetch(`${url}/api/ingest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (!res.ok && !noteRejection(log, res.status)) log(`Status push returned HTTP ${res.status}.`);
  } catch (err) {
    log(`Status push failed: ${err.message}`);
  }
}

/**
 * Cloud copy of the posting ledger (the anti-double-post brain) — pushed
 * after every run so a fresh machine can `npm run recover` without ever
 * re-posting history. Fire-and-forget like pushStatus.
 */
export async function pushLedger(ledger, log) {
  const { url, token, enabled } = dashboardSettings();
  if (!enabled || tokenRejected) return;
  try {
    const res = await fetch(`${url}/api/ledger`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        posted: ledger.data.posted ?? {},
        attempts: ledger.data.attempts ?? {},
        engaged: ledger.data.engaged ?? {},
      }),
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (!res.ok && !noteRejection(log, res.status)) log(`Ledger push returned HTTP ${res.status}.`);
  } catch (err) {
    log(`Ledger push failed: ${err.message}`);
  }
}
