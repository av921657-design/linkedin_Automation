import { NextResponse } from 'next/server';
import { authCookieHeader, claimPassword, clearCookieHeader, passwordState, STORE_UNREADABLE, verifyPassword } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

/** Nothing about the credential can be trusted while the store is unreadable, so no branch may sign anyone in. */
const storeUnreachable = () => NextResponse.json({ ok: false, error: STORE_UNREADABLE.error }, { status: STORE_UNREADABLE.status });

/**
 * Sign in. On a deployment that has no credential of any kind this also sets
 * the first password (`{ password, setup: true }`): that state means
 * dashboard/auth.json provably does not exist *and* DASHBOARD_PASSWORD is unset,
 * and the record is written as a create-only put, so it can never replace a
 * password somebody already chose or win a race against another claim.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected JSON body.' }, { status: 400 });
  }
  const password = String(body?.password ?? '');

  if (password && (await verifyPassword(password))) {
    const res = NextResponse.json({ ok: true });
    res.headers.append('set-cookie', await authCookieHeader(request));
    return res;
  }

  const state = await passwordState();

  if (body?.setup !== true) {
    // The plain sign-in attempt must say *why* nothing matched, otherwise a
    // misconfigured deployment reads as "wrong password" forever.
    if (state === 'unclaimed') {
      return NextResponse.json({
        ok: false,
        unclaimed: true,
        error: 'This dashboard has no password yet. Set the first one below.',
      }, { status: 401 });
    }
    if (state === 'unknown') return storeUnreachable();
    return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  }

  if (state === 'unknown') return storeUnreachable();
  if (state !== 'unclaimed') {
    return NextResponse.json({
      ok: false,
      error: state === 'bootstrapped'
        ? 'A bootstrap password is already configured (DASHBOARD_PASSWORD) — sign in with it instead.'
        : 'A password is already set — sign in or use Reset password.',
    }, { status: 409 });
  }
  if (password.length < 8) return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
  if (password.length > 200) return NextResponse.json({ ok: false, error: 'Password is too long (max 200).' }, { status: 400 });

  const { outcome, secret, updatedAt } = await claimPassword(password);
  if (outcome === 'exists') {
    return NextResponse.json({ ok: false, error: 'Someone has already set this dashboard’s password — sign in instead.' }, { status: 409 });
  }
  if (outcome !== 'created') {
    return NextResponse.json({ ok: false, error: 'The dashboard could not write to its Blob store, so nothing was saved.' }, { status: 503 });
  }
  // The claimer proved control of an unclaimed deployment; log that session in
  // from the hash just written rather than re-reading a blob still propagating.
  const res = NextResponse.json({ ok: true, claimed: true, updatedAt });
  res.headers.append('set-cookie', await authCookieHeader(request, secret));
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('set-cookie', clearCookieHeader());
  return res;
}
