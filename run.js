#!/usr/bin/env node
/**
 * Main runner — executed by launchd at the scheduled posting hours
 * (day-wise: weekday vs weekend, see config `schedule` + src/schedule.js),
 * or manually via `npm start` (respects the schedule) / `npm run post-now`
 * (--force, ignores it) / `npm run dry-run`.
 *
 * Flow: safety checks -> off-schedule gate -> collect candidates from sources
 * -> pick oldest unposted -> reformat -> post via composer -> record in ledger
 * -> archive -> optional engagement (like/comment on the fresh post; failures
 * are warnings only and never mark the post failed).
 *
 * Flags:
 *   --dry-run   run every step except the final "Post" click, then discard.
 *               Also bypasses the off-schedule gate so you can test any time.
 *   --force     post now even if this hour is not in today's schedule.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { ensureDirs, DIRS, ROOT } from './src/paths.js';
import { Ledger } from './src/ledger.js';
import { reformat, mergeReformat } from './src/reformat.js';
import { rewriteForPost } from './src/summarize.js';
import { notify } from './src/notify.js';
import { resolveConfig, pushStatus, pushLedger } from './src/sync.js';
import { launch, guardAuth, makeLogger, AuthError } from './src/browser.js';
import { PostError, postToLinkedIn } from './src/poster.js';
import { engageFeed, planEngagement } from './src/engage.js';
import { isSlot, slotsForDate } from './src/schedule.js';
import * as folderSource from './src/sources/folder.js';
import * as linkedinSource from './src/sources/linkedin.js';
import * as articleSource from './src/sources/article.js';
import * as feedSource from './src/sources/feed.js';
import * as xSource from './src/sources/x.js';
import * as instagramSource from './src/sources/instagram.js';
import * as facebookSource from './src/sources/facebook.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
ensureDirs();
const log = makeLogger();

/** Both schedulers kill a run long before this (launchd's ExitTimeOut, Task
 *  Scheduler's PT1H limit), so an older lock is abandoned rather than live.
 *  Without the age check a recycled pid wedges every future run forever. */
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

/** Prevent overlapping runs (a long video upload can exceed the interval). */
function acquireLock() {
  let held = null;
  try {
    held = JSON.parse(fs.readFileSync(DIRS.lockFile, 'utf8'));
  } catch {
    held = null; // no lock, or an unreadable one — take it
  }
  if (held && typeof held.pid === 'number') {
    let alive = false;
    try {
      process.kill(held.pid, 0); // throws if the process is gone
      alive = true;
    } catch {
      alive = false;
    }
    const at = Date.parse(held.at);
    const stale = Number.isFinite(at) && Date.now() - at > LOCK_STALE_MS;
    if (alive && !stale) {
      log(`Another run is already active (pid ${held.pid}). Exiting.`);
      return false;
    }
    log(`Ignoring ${stale ? 'stale' : 'abandoned'} lock (pid ${held.pid}).`);
  }
  try {
    fs.writeFileSync(DIRS.lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  } catch (err) {
    log(`Warning: could not write the lock file: ${err.message}`);
  }
  return true;
}

function releaseLock() {
  fs.rmSync(DIRS.lockFile, { force: true });
}

/** Subfolders of a source root that count as one queued candidate. */
function countCandidates(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).length;
  } catch {
    return 0;
  }
}

/** Queue depth across every enabled folder source, plus what is parked in failed/. */
function dirCounts(cfg) {
  const roots = new Set(
    (cfg.sources ?? [])
      .filter((s) => s.type === 'folder' && s.enabled !== false)
      .map((s) => (s.path ? (path.isAbsolute(s.path) ? s.path : path.join(ROOT, s.path)) : DIRS.queue))
      .map((p) => path.resolve(p)),
  );
  let queue = 0;
  for (const root of roots) queue += countCandidates(root);
  let failedDir = 0;
  try {
    failedDir = fs.readdirSync(DIRS.failed).filter((n) => !/^[._]/.test(n)).length;
  } catch {
    failedDir = 0;
  }
  return { queue, failedDir };
}

async function collectAll(cfg, context) {
  const candidates = [];
  for (const source of cfg.sources ?? []) {
    if (source.enabled === false) continue;
    try {
      let found = [];
      if (source.type === 'folder') {
        found = await folderSource.collectCandidates(source, cfg);
      } else if (source.type === 'linkedin') {
        const page = context.pages()[0] ?? (await context.newPage());
        found = await linkedinSource.collectCandidates(source, page, context, log);
      } else if (source.type === 'article') {
        const page = context.pages()[0] ?? (await context.newPage());
        found = await articleSource.collectCandidates(source, page, context, log);
      } else if (source.type === 'substack' || source.type === 'medium') {
        found = await feedSource.collectCandidates(source, context, log);
      } else if (source.type === 'x') {
        const page = context.pages()[0] ?? (await context.newPage());
        found = await xSource.collectCandidates(source, page, context, log);
      } else if (source.type === 'instagram') {
        const page = context.pages()[0] ?? (await context.newPage());
        found = await instagramSource.collectCandidates(source, page, context, log);
      } else if (source.type === 'facebook') {
        const page = context.pages()[0] ?? (await context.newPage());
        found = await facebookSource.collectCandidates(source, page, context, log);
      } else {
        log(`Unknown source type "${source.type}" — skipped.`);
      }
      // A source's own `reformat` block overrides the global formatting
      // defaults for every candidate it produced (merged at post time).
      if (source.reformat && found.length) {
        for (const c of found) c.reformat = source.reformat;
      }
      candidates.push(...found);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      log(`Source "${source.type}" failed: ${err.message}`);
    }
  }
  return candidates;
}

/** Park an exhausted candidate in failed/. Network sources keep no local
 *  files (their `moveTo` returns null) — the ledger alone dedupes those. */
function park(candidate) {
  try {
    return candidate.moveTo(DIRS.failed) ?? null;
  } catch {
    return null; // best-effort; the retry count is already recorded
  }
}

function pickCandidate(candidates, ledger, maxRetries) {
  for (const c of candidates) {
    if (ledger.isPosted(c.hash)) continue;
    if (ledger.attempts(c.id) >= maxRetries) {
      const dest = park(c);
      log(`Candidate ${c.id} exhausted ${maxRetries} retries${dest ? ` — parked in failed/ (${dest})` : '.'}`);
      continue;
    }
    return c;
  }
  return null;
}

/**
 * Posting stage — collect → pick → rewrite → post → ledger. Best-effort:
 * a PostError is recorded (retry/park + notify) but does NOT abort the run,
 * so the independent engagement stage still executes. Only AuthError (and
 * genuinely unexpected errors) propagate to pause everything.
 *
 * `post.maxPerRun` candidates are attempted per wake; the loop stops at the
 * first failure so one broken post cannot spend the rest of the run's budget.
 */
async function doPosting({ cfg, context, ledger, runInfo, log }) {
  const candidates = await collectAll(cfg, context);
  if (candidates.length === 0) {
    log('No candidates to post. Nothing to do.');
    return;
  }
  const maxRetries = cfg.limits?.maxRetriesPerCandidate ?? 3;
  const budget = Math.max(1, Number(cfg.post?.maxPerRun) || 1);
  const posted = [];
  for (let i = 0; i < budget; i++) {
    const candidate = pickCandidate(candidates, ledger, maxRetries);
    if (!candidate) {
      log(posted.length ? 'No further candidates available this run.' : 'All candidates already posted or exhausted. Nothing to do.');
      return;
    }
    if (!(await postOne({ candidate, cfg, context, ledger, runInfo, maxRetries, posted }))) return;
  }
}

/** Post a single candidate. Returns true when the caller may post another. */
async function postOne({ candidate, cfg, context, ledger, runInfo, maxRetries, posted }) {
  runInfo.candidate = [...posted, candidate.id].join(', ');
  runInfo.source = candidate.source;

  // LinkedIn-source videos stream as signed segments; download the video now,
  // while the post is still on screen (before the composer navigates away).
  if (candidate.fetchVideo) {
    try {
      const videoPath = await candidate.fetchVideo();
      if (videoPath && !candidate.media.includes(videoPath)) candidate.media.push(videoPath);
      if (!videoPath) log(`Video not available for ${candidate.id} — posting text only.`);
    } catch (err) {
      log(`Video download failed for ${candidate.id}: ${err.message} — posting text only.`);
    }
  }

  // Rewrite stage: full articles become structured posts; the raw article
  // text stays the basis for relevance hashtags.
  let rawText = candidate.text;
  let postedText = null;
  const useTemplate = candidate.summarize && cfg.rewrite?.template?.enabled !== false;
  if (candidate.summarize) postedText = await rewriteForPost(candidate, cfg.rewrite, log);
  const fmtCfg = mergeReformat(cfg.reformat, candidate.reformat);
  if (candidate.sourceHandle) fmtCfg.sourceHandle = candidate.sourceHandle;
  if (useTemplate) {
    fmtCfg.style = { ...(fmtCfg.style ?? {}), hook: '', cta: '', sentencesPerParagraph: 0 };
    fmtCfg.autoHashtags = {
      ...(fmtCfg.autoHashtags ?? {}),
      source: 'relevance',
      count: cfg.rewrite?.template?.hashtagCount ?? 10,
    };
  }
  const text = reformat(postedText ?? rawText, fmtCfg);
  log(`Posting candidate ${candidate.id} (hash ${candidate.hash}, ${candidate.media.length} media file(s))${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const page = context.pages()[0] ?? (await context.newPage());
  const delayRange = cfg.post?.minTypeDelayMs ?? 12;
  const delay = Math.floor(delayRange + Math.random() * Math.max(1, (cfg.post?.maxTypeDelayMs ?? 40) - delayRange));

  let result;
  try {
    result = await postToLinkedIn(page, { text, mediaPaths: candidate.media }, { dryRun: DRY_RUN, typeDelay: delay });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof PostError) {
      runInfo.result = 'failed';
      runInfo.error = String(err.message ?? err).slice(0, 500);
      const attempts = DRY_RUN ? 0 : ledger.bumpAttempt(candidate.id, err.message);
      if (!DRY_RUN && attempts >= maxRetries) {
        const dest = park(candidate);
        log(`Candidate ${candidate.id} failed ${attempts} times${dest ? ` — parked in failed/ (${dest})` : '.'}`);
      }
      log(`POST FAILED: ${err.message}`);
      if (!DRY_RUN) notify('LinkedIn Automation — post failed', err.message);
      process.exitCode = DRY_RUN ? process.exitCode : 1;
      return false;
    }
    throw err;
  }

  if (DRY_RUN) {
    log(`Dry run complete — composer filled (${candidate.media.length} media file(s) attached), draft discarded. State unchanged.`);
    void result;
    return false;
  }

  ledger.markPosted(candidate.hash, { ref: candidate.id, source: candidate.source });
  posted.push(candidate.id);
  runInfo.result = 'posted';
  runInfo.candidate = posted.join(', ');
  runInfo.counts.postedTotal = ledger.postedCount();
  try {
    const dest = candidate.moveTo(DIRS.posted);
    log(`✔ Posted and recorded${dest ? ` (archived to ${dest})` : ''}. Ledger now has ${ledger.postedCount()} post(s).`);
  } catch (err) {
    log(`Warning: posted OK but archiving failed: ${err.message}`);
  }
  return true;
}

async function main() {
  if (fs.existsSync(DIRS.authFlag) && !DRY_RUN) {
    log('AUTH_REQUIRED flag present — skipping run until you log in (see state/AUTH_REQUIRED).');
    notify('LinkedIn Automation paused', 'Not logged in. Run: npm run login');
    await pushStatus({ at: new Date().toISOString(), dryRun: false, result: 'auth-paused', error: 'Not logged in — run `npm run login`, then delete state/AUTH_REQUIRED.' }, log);
    return;
  }

  if (!acquireLock()) return;

  const ledger = new Ledger();
  const { cfg, origin, version: configVersion } = await resolveConfig(log);
  log(`Config source: ${origin} (version ${configVersion}).`);

  // Off-schedule gate: a wake outside today's posting hours posts AND engages
  // nothing, so skip it before launching Chrome (idle wakes stay free). launchd
  // normally only wakes on-slot; this also enforces a dashboard schedule edit on
  // the very next tick even before install-schedule.sh regenerates the plist.
  // --dry-run and --force bypass it for testing / "post now".
  if (!DRY_RUN && !FORCE) {
    const now = new Date();
    if (!isSlot(cfg, now)) {
      const today = slotsForDate(cfg, now);
      const list = today.length ? today.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ') : 'none';
      log(`[schedule] Off-schedule wake — today's hours are ${list}. Skipping; use --force to post now.`);
      releaseLock();
      return;
    }
  }

  const runInfo = {
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    result: 'nothing',
    candidate: null,
    source: null,
    error: null,
    configVersion,
    origin,
    counts: { postedTotal: ledger.postedCount(), retriesPending: Object.keys(ledger.data.attempts ?? {}).length, ...dirCounts(cfg) },
  };
  let context = null;

  try {
    context = await launch(cfg);

    // 1) Posting (best-effort; a failure here still lets engagement run).
    await doPosting({ cfg, context, ledger, runInfo, log });

    // 2) Engagement (independent — runs every scheduled wake when enabled).
    if (cfg.engagement?.enabled) {
      if (DRY_RUN) {
        const plan = planEngagement(cfg.engagement, cfg.rewrite?.llm);
        const where = [plan.handles.length ? `@${plan.handles.join(', @')}` : null, plan.keywords.length ? `keywords: ${plan.keywords.join(', ')}` : null]
          .filter(Boolean)
          .join(' | ');
        log(`[engage] dry run — would engage ${plan.maxPerRun} post(s) from ${where || '(nothing configured)'} via "${plan.strategy}": ${plan.like ? 'like' : 'no like'}, ${plan.comment ?? 'no comment'}.`);
      } else {
        const page = context.pages()[0] ?? (await context.newPage());
        const engagement = await engageFeed(page, { cfg: cfg.engagement, ledger, llm: cfg.rewrite?.llm, log });
        if (engagement.attempted) runInfo.engagement = engagement;
      }
    }
  } catch (err) {
    runInfo.error = String(err.message ?? err).slice(0, 500);
    if (err instanceof AuthError || /login|authwall|checkpoint/i.test(err.message)) {
      runInfo.result = 'auth-paused';
      fs.writeFileSync(DIRS.authFlag, `${new Date().toISOString()} ${err.message}\n`);
      log(`AUTH REQUIRED: ${err.message}`);
      notify('LinkedIn Automation paused', 'Not logged in — run `npm run login`, then delete state/AUTH_REQUIRED.');
      process.exitCode = 1;
    } else {
      runInfo.result = 'error';
      log(`UNEXPECTED ERROR: ${err.stack ?? err.message}`);
      notify('LinkedIn Automation — error', err.message ?? 'unexpected error');
      process.exitCode = 1;
    }
  } finally {
    if (context) await context.close().catch(() => {});
    releaseLock();
    // Recount after posting: files have moved out of queue/ and into posted/.
    Object.assign(runInfo.counts, dirCounts(cfg), { retriesPending: Object.keys(ledger.data.attempts ?? {}).length });
    await pushStatus(runInfo, log);
    await pushLedger(ledger, log);
  }
}

await main();
