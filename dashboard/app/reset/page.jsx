'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '../../components/controls';

export default function ResetPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {kind:'ok'|'err', text}

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) { setMsg({ kind: 'err', text: 'New password must be at least 8 characters.' }); return; }
    if (next !== confirm) { setMsg({ kind: 'err', text: 'The two new passwords do not match.' }); return; }
    if (next === current) { setMsg({ kind: 'err', text: 'New password must differ from the current one.' }); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setMsg({ kind: 'ok', text: 'Password updated. You are signed in with the new one — every older session was signed out.' });
        setCurrent(''); setNext(''); setConfirm('');
      } else {
        setMsg({ kind: 'err', text: j.error || 'Could not reset the password.' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Network error — could not reach the server.' });
    }
    setBusy(false);
  }

  return (
    <div className="login-shell">
      <div className="theme-toggle-anchor"><ThemeToggle /></div>
      <h1 className="wordmark">Cadence<span className="dot">.</span></h1>
      <p className="tagline">Change the dashboard password.</p>
      <form className="login-card" onSubmit={submit}>
        <label htmlFor="cur">Current password</label>
        <input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••••••" autoFocus />
        <label htmlFor="n1" style={{ marginTop: 14 }}>New password</label>
        <input id="n1" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="at least 8 characters" />
        <label htmlFor="n2" style={{ marginTop: 14 }}>Confirm new password</label>
        <input id="n2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="repeat it" />
        {msg && <div className={msg.kind === 'ok' ? 'okmsg' : 'err'}>{msg.text}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
        <div className="login-foot">
          <Link className="linkbtn" href="/">Back to dashboard</Link>
        </div>
      </form>
      <p className="login-hint">Forgot it too, or locked out? On the Mac: <code>npm run dashboard:unlock</code> (uses the local sync token).</p>
    </div>
  );
}
