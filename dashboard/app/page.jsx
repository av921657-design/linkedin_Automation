'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clone } from '../lib/ui';
import { ThemeToggle } from '../components/controls';
import { useNextRun } from '../components/dayrail';
import { Overview } from '../components/overview';
import { Sources } from '../components/sources';
import { Format } from '../components/format';
import { Rewrite } from '../components/rewrite';
import { Schedule } from '../components/schedule';
import { Limits } from '../components/limits';
import { Raw } from '../components/raw';

const TABS = [
  ['overview', 'Overview'],
  ['sources', 'Sources'],
  ['format', 'Format & hashtags'],
  ['rewrite', 'Article rewrite'],
  ['schedule', 'Schedule'],
  ['limits', 'Posting & limits'],
  ['raw', 'Raw JSON'],
];

export default function Page() {
  const [authed, setAuthed] = useState(null); // null = checking
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [setup, setSetup] = useState(false); // first run: choose the password
  const [unclaimed, setUnclaimed] = useState(false);
  const [loginErr, setLoginErr] = useState('');
  const [cfg, setCfg] = useState(null);
  const [loadedVersion, setLoadedVersion] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [cloud, setCloud] = useState(null); // { ledgerSavedAt, ledgerPosted, backup }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // {kind:'ok'|'err', text}
  const [loadErr, setLoadErr] = useState('');
  const [rev, setRev] = useState(0);

  /** Pull everything the dashboard shows. Resolves true when the config was
   *  replaced, so callers can tell a real reload from a failed one. */
  async function load() {
    let c;
    try {
      c = await fetch('/api/config', { credentials: 'same-origin' });
    } catch {
      setLoadErr('Could not reach the server.');
      return false;
    }
    if (c.status === 401) {
      setAuthed(false);
      return false;
    }
    setAuthed(true);

    let loaded = false;
    let problem = '';
    try {
      const cj = await c.json();
      if (cj.config) {
        setCfg(cj.config);
        setLoadedVersion(cj.version);
        setRev((r) => r + 1); // fresh config from the server → remount the form with clean local state
        loaded = true;
      }
    } catch {
      problem = 'The server returned an unreadable config.';
    }

    // Status, ledger and backup are decorative next to the config: report a
    // failure but still hand back a usable page.
    const [s, l, bk] = await Promise.allSettled([
      fetch('/api/status', { credentials: 'same-origin' }).then((r) => r.json()),
      fetch('/api/ledger', { credentials: 'same-origin' }).then((r) => r.json()),
      fetch('/api/backup', { credentials: 'same-origin' }).then((r) => r.json()),
    ]);
    if (s.status === 'fulfilled') {
      setStatus(s.value.status);
      setHistory(s.value.history || []);
    } else if (!problem) {
      problem = 'Run status could not be loaded.';
    }
    const lj = l.status === 'fulfilled' ? l.value : {};
    const bj = bk.status === 'fulfilled' ? bk.value : {};
    setCloud({
      ledgerSavedAt: lj?.ledger?.savedAt || null,
      ledgerPosted: lj?.ledger?.posted ? Object.keys(lj.ledger.posted).length : null,
      backup: bj?.backup || null,
    });
    setLoadErr(problem);
    return loaded;
  }

  useEffect(() => {
    load();
  }, []);

  async function login(e) {
    e.preventDefault();
    setLoginErr('');
    if (setup && password !== confirmPw) {
      setLoginErr('The two passwords do not match.');
      return;
    }
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(setup ? { password, setup: true } : { password }),
      });
      if (res.ok) {
        setPassword('');
        setConfirmPw('');
        setSetup(false);
        setUnclaimed(false);
        setAuthed(true);
        await load();
      } else {
        const j = await res.json().catch(() => ({}));
        // Nothing configured server-side: this is a fresh deployment, so offer
        // to set the first password with the text they just typed.
        if (j.unclaimed && !setup) setSetup(true);
        setUnclaimed(Boolean(j.unclaimed));
        setLoginErr(j.error || 'Login failed.');
      }
    } catch {
      setLoginErr('Could not reach the server.');
    }
  }

  if (authed === null) {
    return (
      <div className="login-shell">
        <div className="theme-toggle-anchor"><ThemeToggle /></div>
        <h1 className="wordmark">Cadence<span className="dot">.</span></h1>
        <p className="tagline">Waking the machine…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="login-shell">
        <div className="theme-toggle-anchor"><ThemeToggle /></div>
        <h1 className="wordmark">Cadence<span className="dot">.</span></h1>
        <p className="tagline">The posting machine on your Mac, operated from here.</p>
        <form className="login-card" onSubmit={login}>
          <label htmlFor="dash-pw">{setup ? 'Choose a dashboard password' : 'Dashboard password'}</label>
          <input
            id="dash-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={setup ? 'at least 8 characters' : '••••••••••••'}
            autoComplete={setup ? 'new-password' : 'current-password'}
            autoFocus
          />
          {setup && (
            <>
              <label htmlFor="dash-pw2" style={{ marginTop: 14 }}>Confirm password</label>
              <input
                id="dash-pw2"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                placeholder="repeat it"
              />
            </>
          )}
          {loginErr && <div className="err">{loginErr}</div>}
          <button className="primary" type="submit">{setup ? 'Set password & unlock' : 'Unlock dashboard'}</button>
          <div className="login-foot">
            {setup
              ? <button className="linkbtn" type="button" onClick={() => { setSetup(false); setLoginErr(''); }}>Back to sign in</button>
              : <Link className="linkbtn" href="/reset">Forgot? Reset password</Link>}
            {!setup && (
              <button className="linkbtn" type="button" onClick={() => { setSetup(true); setLoginErr(''); }}>First run: set a password</button>
            )}
          </div>
        </form>
        <p className="login-hint">
          {unclaimed
            ? 'Nothing is stored yet, so this deployment is unclaimed — the first password set here becomes the only one.'
            : <>Locked out? On the Mac: <code>npm run dashboard:unlock</code></>}
        </p>
      </div>
    );
  }

  const update = (fn) => {
    setCfg((prev) => {
      const d = clone(prev || {});
      const out = fn(d);
      return out === undefined ? d : out;
    });
    setDirty(true);
    setMsg(null);
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ config: cfg }),
      });
      const j = await res.json();
      if (j.ok) {
        setLoadedVersion(j.version);
        setDirty(false);
        setMsg({ kind: 'ok', text: `Saved (version ${j.version}) — the runner applies it at its next scheduled run.` });
      } else {
        setMsg({ kind: 'err', text: (j.errors || [j.error || 'Save failed.']).join('\n') });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Network error while saving.' });
    }
    setSaving(false);
  }

  return (
    <Shell
      cfg={cfg}
      loadedVersion={loadedVersion}
      dirty={dirty}
      tab={tab}
      setTab={setTab}
      status={status}
      history={history}
      cloud={cloud}
      saving={saving}
      msg={msg}
      loadErr={loadErr}
      rev={rev}
      update={update}
      save={save}
      reload={load}
      setDirty={setDirty}
      setMsg={setMsg}
    />
  );
}

function Shell({ cfg, loadedVersion, dirty, tab, setTab, status, history, cloud, saving, msg, loadErr, rev, update, save, reload, setDirty, setMsg }) {
  const paused = status?.result === 'auth-paused';
  const countdown = useNextRun(cfg);
  const running = !paused && countdown.active;
  const authStale = status?.configVersion && loadedVersion && status.configVersion !== loadedVersion;

  return (
    <div className="wrap">
      <header className="topbar">
        <div>
          <div className="eyebrow">
            <span className={`led ${running ? 'live' : ''}`} aria-hidden="true" />
            {countdown.clock} {countdown.tzLabel} time · LinkedIn automation
          </div>
          <div className="brandline">
            <h1 className="wordmark">Cadence<span className="dot">.</span></h1>
            <span className="tagline">config v{loadedVersion || '—'}{dirty ? ' · unsaved changes' : ''}</span>
          </div>
        </div>
        <div className="top-right">
          <div className="topchip">
            {paused
              ? <>run status <b>login needed</b></>
              : countdown.text
                ? <>next run in <b>{countdown.text}</b> · {countdown.atLabel}</>
                : <>schedule <b>on hold</b></>}
          </div>
          <div className="top-actions">
            <Link className="linkbtn" href="/reset">Reset password</Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {!cfg && (
        <div className="card">
          <h2>{loadErr ? 'Could not load the config' : 'No config stored yet'}</h2>
          <p className="hint">
            {loadErr
              ? <>{loadErr} Nothing here has been changed — <button className="linkbtn" type="button" onClick={() => reload()}>try again</button>.</>
              : <>Nothing has been uploaded to Vercel. Your Mac keeps running on its local config.json. Open <b>Raw JSON</b> below, paste the local file contents there, Apply, then Save to make the dashboard the source of truth.</>}
          </p>
        </div>
      )}

      <nav className="tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >{label}</button>
        ))}
      </nav>

      <div key={rev}>
        {tab === 'overview' && cfg && (
          <Overview
            cfg={cfg} loadedVersion={loadedVersion} status={status} history={history}
            cloud={cloud} authStale={!!authStale} countdown={countdown} running={running} paused={paused}
          />
        )}
        {tab === 'sources' && cfg && <Sources cfg={cfg} update={update} />}
        {tab === 'format' && cfg && <Format cfg={cfg} update={update} />}
        {tab === 'rewrite' && cfg && <Rewrite cfg={cfg} update={update} />}
        {tab === 'schedule' && cfg && <Schedule cfg={cfg} update={update} />}
        {tab === 'limits' && cfg && <Limits cfg={cfg} update={update} countdown={countdown} />}
        {tab === 'raw' && <Raw cfg={cfg} update={update} />}
      </div>

      {cfg && (dirty || msg || loadErr) && (
        <div className="savebar">
          <button className="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save config'}</button>
          {/* Only drop the dirty flag once the server copy has actually landed,
              otherwise a failed fetch would silently keep the user's edits
              while claiming they were discarded. */}
          <button className="ghost" onClick={async () => { setMsg(null); if (await reload()) setDirty(false); }} disabled={!dirty || saving}>Discard changes</button>
          {dirty && <span className="dirty">Unsaved changes</span>}
          {loadErr && <span className="err">{loadErr}</span>}
          {msg && <span className={msg.kind === 'ok' ? 'okmsg' : 'err'} style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
