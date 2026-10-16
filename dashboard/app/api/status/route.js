import { NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import { readJson, STATUS_PATH, HISTORY_PATH } from '../../../lib/blobs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [status, history] = await Promise.all([readJson(STATUS_PATH), readJson(HISTORY_PATH)]);
  return NextResponse.json({ status, history: Array.isArray(history) ? history : [] });
}
