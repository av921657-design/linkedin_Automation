'use client';

import { DayRail } from './dayrail';
import { RESULT_PILL, RESULT_LABEL, DAILY_PILL, NL_LABEL, NL_PILL, dailyNote, newsletterNote, stamp } from '../lib/ui';

export function Overview({ cfg, loadedVersion, status, history, cloud, authStale, countdown, running, paused }) {
  const rows = history.slice(0, 12);
  const railNow = { h: countdown.hNow, m: countdown.mNow, s: countdown.sNow };
  const eng = status?.engagement;
  // Every timestamp on this page is wall-clock in the posting timezone.
  const at = (iso) => stamp(iso, countdown.tz);
  return (
    <div className="panel">
      <section className="rail-card" aria-label="Schedule">
        <div>
          {paused ? (
            <>
              <div className="count-num idle">Login needed</div>
              <div className="count-lbl">the Mac paused itself</div>
              <p className="hint" style={{ marginTop: 10 }}>
                Run <span className="mono">npm run login</span> on the Mac and sign in to LinkedIn once. Posting resumes automatically.
              </p>
            </>
          ) : countdown.text ? (
            <>
              <div className="count-num">{countdown.text}</div>
              <div className="count-lbl">{running ? 'inside a run window' : 'until next run'} · {countdown.atLabel}</div>
              <p className="hint" style={{ marginTop: 10, color: 'var(--muted)' }}>
                {countdown.group === 'weekend' ? 'Weekend' : 'Weekday'} schedule · {countdown.today?.length || 0} run{countdown.today?.length === 1 ? '' : 's'} today.{' '}
                {running
                  ? 'A run may be posting right now — results appear the moment it finishes.'
                  : 'The runner wakes on your Mac, pulls this config, posts, and reports back.'}
              </p>
            </>
          ) : (
            <>
              <div className="count-num idle">No schedule</div>
              <div className="count-lbl">all run slots are disabled</div>
            </>
          )}
        </div>
        <div>
          <DayRail cfg={cfg} history={history} now={railNow} countdown={countdown} />
        </div>
      </section>

      <div className="stats">
        <div className="stat accent"><div className="n">{status?.counts?.postedTotal ?? '—'}</div><div className="l">posts delivered, all time</div></div>
        <div className="stat"><div className="n">{status?.counts?.maxPerDay ? `${status.counts.postedToday ?? 0}/${status.counts.maxPerDay}` : '—'}</div><div className="l">used of today&apos;s cap</div></div>
        <div className="stat"><div className="n">{status?.counts?.queue ?? '—'}</div><div className="l">queue folders pending</div></div>
        <div className="stat"><div className="n">{status?.counts?.failedDir ?? '—'}</div><div className="l">parked in failed/</div></div>
        <div className="stat"><div className="n">{cloud?.ledgerPosted ?? '—'}</div><div className="l">in the cloud ledger</div></div>
      </div>

      <div className="card">
        <h2>Last run {status && <span className={`pill ${RESULT_PILL[status.result] || ''}`}>{status.dryRun ? 'dry-run' : RESULT_LABEL[status.result] || status.result}</span>}</h2>
        {status ? (
          <p className="hint" style={{ fontSize: 13 }}>
            <span className="mono">{at(status.at)}</span> · {status.candidate || 'no candidate'} · config v{status.configVersion || '?'}
            {eng && (
              <>
                <br />
                {eng.liked || eng.commented ? (
                  <span className="pill ok">
                    engaged {[eng.liked && 'liked', eng.commented && 'commented'].filter(Boolean).join(' + ')}
                    {eng.author ? ` · @${eng.author}` : ''}{' '}
                    {eng.postUrl ? <a href={eng.postUrl} target="_blank" rel="noreferrer">view</a> : null}
                  </span>
                ) : eng.attempted ? (
                  <span className="pill warn" title={eng.error || ''}>engagement found nothing · run itself is fine</span>
                ) : null}
              </>
            )}
            {status.daily && (
              <>
                <br />
                <span className={`pill ${DAILY_PILL[status.daily.result] || ''}`} title={status.daily.requestId || ''}>
                  {dailyNote(status.daily, countdown.tz)}
                </span>
              </>
            )}
            {status.newsletter && (
              <>
                <br />
                <span className={`pill ${NL_PILL[status.newsletter.waiting] || ''}`}>
                  {NL_LABEL[status.newsletter.waiting] || (status.newsletter.enabled === false ? 'newsletter off' : 'newsletter')}
                </span>{' '}
                <span style={{ fontSize: 13 }}>{newsletterNote(status.newsletter)}</span>
              </>
            )}
            {status.error && <><br /><span className="err">{status.error}</span></>}
          </p>
        ) : (
          <p className="hint">The Mac hasn't reported a run yet. It pushes this after every scheduled tick once <span className="mono">state/dashboard.json</span> is set up locally.</p>
        )}
        {authStale && <p className="hint" style={{ color: 'var(--amber)' }}>Config changed since the last run — it applies automatically at the next scheduled tick.</p>}
      </div>

      <div className="card">
        <h2>Recovery copies</h2>
        <p className="serif-note">Both of these only matter on the day the Mac doesn't wake up.</p>
        <div className="grid-2">
          <div>
            <p className="hint" style={{ fontSize: 13 }}>
              <b>Cloud ledger:</b>{' '}
              {cloud?.ledgerSavedAt
                ? <><span className="pill ok">ok</span> {cloud.ledgerPosted} posts · saved {at(cloud.ledgerSavedAt)}</>
                : <span className="pill warn">never pushed</span>}
            </p>
            <p className="hint">The ledger is what prevents double-posts. A new Mac restores it with <span className="mono">npm run recover</span>.</p>
          </div>
          <div>
            <p className="hint" style={{ fontSize: 13 }}>
              <b>Encrypted backup:</b>{' '}
              {cloud?.backup?.ok
                ? <><span className="pill ok">ok</span> {at(cloud.backup.at)} · {cloud.backup.sizeMB} MB</>
                : cloud?.backup
                  ? <><span className="pill fail">failed</span> {cloud.backup.error || 'unknown error'}</>
                  : <span className="pill warn">none reported</span>}
            </p>
            <p className="hint">Daily archive of queue/, state/, newsletter-issues/, config and the browser profile → OneDrive (AES-encrypted).</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Recent runs</h2>
        {rows.length === 0 ? <p className="hint">Nothing yet — the first report lands after the next scheduled tick.</p> : (
          <table className="hist">
            <thead><tr><th>when ({countdown.tzLabel})</th><th>result</th><th>candidate</th><th>detail</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{at(r.at)}</td>
                  <td><span className={`pill ${RESULT_PILL[r.result] || ''}`}>{r.dryRun ? 'dry' : RESULT_LABEL[r.result] || r.result}</span></td>
                  <td className="mono">{r.candidate || '—'}</td>
                  <td className="hint">{[r.error || r.source || '', r.daily ? dailyNote(r.daily, countdown.tz) : '', r.plan?.reason ? `plan · ${r.plan.reason}` : '', r.engagement?.liked || r.engagement?.commented ? `${[r.engagement.liked && 'liked', r.engagement.commented && 'commented'].filter(Boolean).join('+')}` : ''].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Notes</h2>
        <p className="hint">
          Each day the machine researches the public web (Web research tab), messages you the findings on Telegram, and writes plus
          publishes the one you pick — <b>nothing goes up without your answer</b>. Once a week it offers something bigger instead: the
          AI newsletter, with the version ladder and its infographic (<b>Weekly newsletter</b> tab), and it answers to its own{' '}
          <span className="mono">/nl yes</span>. It never opens a LinkedIn profile page: the only
          LinkedIn page it visits is the post composer, on your account, after a yes. The one exception is content you drop into{' '}
          <span className="mono">queue/</span> yourself, which needs no asking.
        </p>
        <p className="hint">
          The automation on your Mac pulls this config at the start of every scheduled run (launchd, day-wise — see the <b>Schedule</b> tab) and pushes results back after.
          If the Mac is offline, it falls back to the last cached copy, then to its local config.json — posting never depends on the dashboard being reachable.
          Login session, credentials and the LinkedIn browser profile stay on the Mac and are never uploaded here.
        </p>
      </div>
    </div>
  );
}
