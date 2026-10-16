import { NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import { readJson, writeJson, versionOf, CONFIG_PATH } from '../../../lib/blobs';
import { validateConfig } from '../../../lib/validate';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const config = await readJson(CONFIG_PATH);
  return NextResponse.json({
    config,
    version: config ? versionOf(config) : null,
    configured: Boolean(config),
  });
}

export async function PUT(request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }
  const config = body?.config ?? body;
  const { ok, errors } = validateConfig(config);
  if (!ok) return NextResponse.json({ ok: false, errors }, { status: 400 });
  await writeJson(CONFIG_PATH, config);
  return NextResponse.json({ ok: true, version: versionOf(config) });
}
