import { NextResponse } from 'next/server';
import { isAuthorized, isMachine } from '../../../lib/auth';
import { readJson, writeJson, BACKUP_PATH } from '../../../lib/blobs';

export const dynamic = 'force-dynamic';

/** Last encrypted-backup report from the Mac (or a failure notice). */
export async function GET(request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const backup = await readJson(BACKUP_PATH);
  return NextResponse.json({ backup });
}

export async function PUT(request) {
  if (!isMachine(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }
  const doc = {
    at: typeof body?.at === 'string' ? body.at.slice(0, 40) : new Date().toISOString(),
    ok: Boolean(body?.ok),
    file: typeof body?.file === 'string' ? body.file.slice(0, 200) : null,
    sizeMB: Number(body?.sizeMB) || 0,
    sha256: typeof body?.sha256 === 'string' ? body.sha256.slice(0, 64) : null,
    error: typeof body?.error === 'string' ? body.error.slice(0, 500) : null,
  };
  await writeJson(BACKUP_PATH, doc);
  return NextResponse.json({ ok: true });
}
