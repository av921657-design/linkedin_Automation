import { NextResponse } from 'next/server';
import { isAuthorized, passwordState, storeUnreadable, verifyPassword, resetPassword, authCookieHeader } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Change the dashboard password. The credential lives as a salted scrypt hash
 * in a private blob (dashboard/auth.json) — the plaintext is never stored or
 * logged. Two authorised ways in:
 *   • a logged-in browser session proves it knows the CURRENT password;
 *   • the Mac (Bearer SYNC_TOKEN) can recover access without it (lockout escape).
 * After a reset every older session cookie stops matching (cookies derive from
 * the hash), so existing logins are signed out.
 */
export async function POST(request) {
  const kind = await isAuthorized(request);
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }

  const current = String(body?.currentPassword ?? '');
  const next = String(body?.newPassword ?? '');

  // A trusted Mac (token) may reset blind to recover a lockout; anyone else must know the current password.
  if (kind !== 'token') {
    const state = await passwordState();
    if (state === 'unknown') {
      const { status, error } = storeUnreadable();
      return NextResponse.json({ ok: false, error }, { status });
    }
    if (!(await verifyPassword(current))) {
      // Say what is actually missing instead of blaming a typed password: an
      // unclaimed deployment has no current password to get wrong. This reveals
      // no more than the sign-in route already does.
      if (state === 'unclaimed') {
        return NextResponse.json({ ok: false, error: 'No dashboard password exists yet — set the first one on the sign-in page.' }, { status: 401 });
      }
      if (state === 'bootstrapped') {
        return NextResponse.json({ ok: false, error: 'Current password is incorrect. (This deployment still uses the DASHBOARD_PASSWORD environment variable.)' }, { status: 401 });
      }
      return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
    }
  }

  if (next.length < 8) return NextResponse.json({ ok: false, error: 'New password must be at least 8 characters.' }, { status: 400 });
  if (next.length > 200) return NextResponse.json({ ok: false, error: 'New password is too long (max 200).' }, { status: 400 });
  if (next === current) return NextResponse.json({ ok: false, error: 'New password must differ from the current one.' }, { status: 400 });

  try {
    const { updatedAt, secret } = await resetPassword(next);
    const res = NextResponse.json({ ok: true, updatedAt });
    // The actor that just proved control gets a fresh, valid session cookie.
    // The secret is passed in so the cookie is minted from the hash just
    // written, not from a blob read that could still be propagating.
    res.headers.append('set-cookie', await authCookieHeader(request, secret));
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not save the new password.' }, { status: 500 });
  }
}
