import { NextResponse } from 'next/server';
import { isMachine } from '../../../lib/auth';
import { readJson, writeJson, STATUS_PATH, HISTORY_PATH } from '../../../lib/blobs';

export const dynamic = 'force-dynamic';

/** Only http(s): this value is rendered into an <a href>, so a javascript: or
 *  data: URL must not survive the round trip through the status blob. */
function safeUrl(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.trim().slice(0, max);
  return /^https?:\/\//i.test(s) ? s : null;
}

/** Called by the Mac runner after every scheduled run (token-only). */
export async function POST(request) {
  if (!isMachine(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }
  const entry = {
    at: typeof body.at === 'string' ? body.at.slice(0, 40) : new Date().toISOString(),
    dryRun: Boolean(body.dryRun),
    result: ['posted', 'failed', 'error', 'nothing', 'auth-paused', 'daily-cap', 'waiting-for-plan', 'no-match', 'retrying', 'busy', 'held'].includes(body.result) ? body.result : 'error',
    // The autopilot's decision for this wake — which hour it picked and why.
    plan:
      body.plan && typeof body.plan === 'object'
        ? {
            hour: Number.isInteger(body.plan.hour) && body.plan.hour >= 0 && body.plan.hour <= 23 ? body.plan.hour : null,
            reason: typeof body.plan.reason === 'string' ? body.plan.reason.slice(0, 200) : null,
            tz: typeof body.plan.tz === 'string' ? body.plan.tz.slice(0, 64) : null,
          }
        : null,
    candidate: typeof body.candidate === 'string' ? body.candidate.slice(0, 120) : null,
    source: typeof body.source === 'string' ? body.source.slice(0, 60) : null,
    error: typeof body.error === 'string' ? body.error.slice(0, 500) : null,
    counts: body.counts && typeof body.counts === 'object' ? {
      postedTotal: Number(body.counts.postedTotal) || 0,
      postedToday: Number(body.counts.postedToday) || 0,
      maxPerDay: Number(body.counts.maxPerDay) || 0,
      queue: Number(body.counts.queue) || 0,
      failedDir: Number(body.counts.failedDir) || 0,
      retriesPending: Number(body.counts.retriesPending) || 0,
      measuredPosts: Number(body.counts.measuredPosts) || 0,
    } : null,
    configVersion: typeof body.configVersion === 'string' ? body.configVersion.slice(0, 12) : null,
    origin: typeof body.origin === 'string' ? body.origin.slice(0, 20) : null,
    engagement:
      body.engagement && typeof body.engagement === 'object'
        ? {
            attempted: Boolean(body.engagement.attempted),
            liked: Boolean(body.engagement.liked),
            commented: Boolean(body.engagement.commented),
            postUrl: safeUrl(body.engagement.postUrl, 200),
            author: typeof body.engagement.author === 'string' ? body.engagement.author.slice(0, 80) : null,
            error: typeof body.engagement.error === 'string' ? body.engagement.error.slice(0, 300) : null,
          }
        : null,
  };
  await writeJson(STATUS_PATH, entry);
  const history = await readJson(HISTORY_PATH);
  const list = Array.isArray(history) ? history : [];
  list.unshift(entry);
  await writeJson(HISTORY_PATH, list.slice(0, 50));
  return NextResponse.json({ ok: true });
}
