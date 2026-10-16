import { NextResponse } from 'next/server';
import { verifyPassword, authCookieHeader, clearCookieHeader } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let password = '';
  try {
    password = String((await request.json())?.password ?? '');
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected JSON body.' }, { status: 400 });
  }
  if (!password || !(await verifyPassword(password))) {
    return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.headers.append('set-cookie', await authCookieHeader(request));
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('set-cookie', clearCookieHeader());
  return res;
}
