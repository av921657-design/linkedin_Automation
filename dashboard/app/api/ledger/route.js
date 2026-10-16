import { NextResponse } from 'next/server';
import { isAuthorized, isMachine } from '../../../lib/auth';
import { readJson, writeJson, LEDGER_PATH } from '../../../lib/blobs';

export const dynamic = 'force-dynamic';

/** Cloud copy of the posting ledger — the anti-double-post brain. */
export async function GET(request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ledger = await readJson(LEDGER_PATH);
  return NextResponse.json({ ledger });
}

export async function PUT(request) {
  if (!isMachine(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }
  const posted = body?.posted;
  if (!posted || typeof posted !== 'object' || Array.isArray(posted)) {
    return NextResponse.json({ ok: false, error: '`posted` must be an object.' }, { status: 400 });
  }
  const postedCount = Object.keys(posted).length;
  if (postedCount > 20000) {
    return NextResponse.json({ ok: false, error: 'Ledger implausibly large.' }, { status: 400 });
  }
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
  // Engagement records only ever grow and a runner that predates the field
  // sends nothing, so union with the cloud copy instead of overwriting it —
  // otherwise every push would wipe the anti-double-engage history.
  const prev = await readJson(LEDGER_PATH);
  const doc = {
    savedAt: new Date().toISOString(),
    posted,
    attempts: isMap(body?.attempts) ? body.attempts : {},
    engaged: { ...(isMap(prev?.engaged) ? prev.engaged : {}), ...(isMap(body?.engaged) ? body.engaged : {}) },
  };
  await writeJson(LEDGER_PATH, doc);
  return NextResponse.json({ ok: true, postedCount });
}
