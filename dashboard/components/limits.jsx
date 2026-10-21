'use client';

import { useMemo } from 'react';
import { Check, Num, Select } from './controls';
import { linesToList } from '../lib/ui';

export function Limits({ cfg, update, countdown }) {
  const eng = () => cfg.engagement ?? {};
  const setEng = (patch) => update((d) => { d.engagement = { ...(d.engagement ?? {}), ...patch }; });
  const poolText = useMemo(() => (eng().pool ?? []).join('\n'), [cfg]);
  const handlesText = useMemo(() => (eng().handles ?? []).join('\n'), [cfg]);
  const keywordsText = useMemo(() => (eng().keywords ?? []).join('\n'), [cfg]);
  const enabled = eng().enabled === true;
  const hasTargets =
    (eng().handles ?? []).some((t) => typeof t === 'string' && t.trim() && !/your-handle/i.test(t)) ||
    (eng().keywords ?? []).some((t) => typeof t === 'string' && t.trim());
  const browser = cfg.browser ?? {};

  return (
    <div className="panel">
      <div className="card">
        <h2>Posting pace</h2>
        <div className="grid-3">
          <Num label="posts per day (hard cap)" get={() => cfg.post?.maxPerDay ?? 1} set={(v) => update((d) => { d.post = { ...(d.post ?? {}), maxPerDay: v ?? 1 }; })} />
          <Num label="posts per run" get={() => cfg.post?.maxPerRun ?? 1} set={(v) => update((d) => { d.post = { ...(d.post ?? {}), maxPerRun: v ?? 1 }; })} />
          <Num label="min keystroke delay (ms)" get={() => cfg.post?.minTypeDelayMs ?? 12} set={(v) => update((d) => { d.post = { ...(d.post ?? {}), minTypeDelayMs: v ?? 12 }; })} />
          <Num label="max keystroke delay (ms)" get={() => cfg.post?.maxTypeDelayMs ?? 40} set={(v) => update((d) => { d.post = { ...(d.post ?? {}), maxTypeDelayMs: v ?? 40 }; })} />
        </div>
        <p className="hint"><b>Posts per day</b> is the ceiling for the whole day, counted in the posting timezone on the Schedule tab — a published post or video spends one of them, a failed attempt spends nothing. Extra posting hours act as retries for the day's item, not as extra items; a Telegram topic that arrives after the cap is held to the next day. Keystroke delays make typing look human; keep posts-per-run at 1.</p>
      </div>

      <div className="card">
        <h2>Engage other people's posts <span className={`pill ${enabled ? (hasTargets ? 'warn' : 'fail') : 'off'}`}>{enabled ? (hasTargets ? 'refused by the profile rule' : 'off — and it has no targets') : 'off'}</span></h2>
        <p className="hint"><b>Switched off by your own rule</b> (19 Oct 2026): liking and commenting means opening other people&apos;s profile pages and your feed, and the only LinkedIn page this automation may open is the post composer. Turning this on changes nothing on LinkedIn — every wake logs a refusal and moves on. The controls are kept for the day you lift that rule yourself, with <span className="mono">LINKEDIN_POLICY_OVERRIDE=1</span> in the terminal that starts the run. When it does run, it works on every scheduled posting wake (see the Schedule tab), independent of your own posting: it scans the handles&apos; recent activity and/or your auto-refreshed feed, picks the best post you have <b>not</b> engaged yet, likes it and leaves a short comment. Each post is touched only once, ever.</p>
        <div style={{ marginBottom: 8 }}>
          <Check label="enabled" get={() => eng().enabled === true} set={(v) => setEng({ enabled: v })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>handles — one per line (linkedin.com/in/&lt;name&gt; or just &lt;name&gt;)</label>
            <textarea rows={3} value={handlesText} placeholder={'e.g. iraj-janali\nhttps://www.linkedin.com/in/someone'} onChange={(e) => setEng({ handles: linesToList(e.target.value) })} />
          </div>
          <div className="field">
            <label>keywords — one per line (filters the home feed)</label>
            <textarea rows={3} value={keywordsText} placeholder={'e.g.\nfounder\nGST\nhiring'} onChange={(e) => setEng({ keywords: linesToList(e.target.value) })} />
          </div>
        </div>
        <p className="hint">Set handles, keywords, or both. Handles scan those people's recent posts; keywords refresh your feed and keep matching posts. If both are set, a post must come from a handle <i>or</i> the feed and match a keyword. AI comments use the free model from the <b>Article rewrite → AI engine</b> card; without a key, your fallback pool is used.</p>
        <div className="grid-3">
          <Select label="pick which post" get={() => eng().pickStrategy ?? 'top'} set={(v) => setEng({ pickStrategy: v })} options={[['top', 'most engaged'], ['recent', 'most recent'], ['topRecent', 'most engaged of newest 10']]} />
          <Select label="comment style" get={() => eng().commentMode ?? 'ai'} set={(v) => setEng({ commentMode: v })} options={[['ai', 'AI — tailored'], ['pool', 'pool — random from list'], ['fixed', 'fixed — always same'], ['none', 'none — like only']]} />
          <Num label="posts per run" get={() => eng().maxPerRun ?? 1} set={(v) => setEng({ maxPerRun: v ?? 1 })} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Check label="like the post" get={() => eng().like !== false} set={(v) => setEng({ like: v })} />
        </div>
        {eng().commentMode === 'fixed' && (
          <>
            <h3>Comment text ({String(eng().text ?? '').length}/700)</h3>
            <textarea rows={3} value={eng().text ?? ''} onChange={(e) => setEng({ text: e.target.value })} />
          </>
        )}
        {(eng().commentMode === 'pool' || eng().commentMode === 'ai') && (
          <>
            <h3>{eng().commentMode === 'ai' ? 'Fallback pool (used if the AI key is unavailable) — one per line' : 'Comment pool — one per line, picked at random'} ({(eng().pool ?? []).length} saved)</h3>
            <textarea rows={4} value={poolText} onChange={(e) => setEng({ pool: linesToList(e.target.value) })} />
          </>
        )}
        <div className="grid-3" style={{ marginTop: 8 }}>
          <Num label="feed refresh scrolls" get={() => eng().feedScrolls ?? 6} set={(v) => setEng({ feedScrolls: v ?? 6 })} />
          <Num label="min pause (ms)" get={() => eng().minDelayMs ?? 3000} set={(v) => setEng({ minDelayMs: v ?? 3000 })} />
          <Num label="max pause (ms)" get={() => eng().maxDelayMs ?? 12000} set={(v) => setEng({ maxDelayMs: v ?? 12000 })} />
        </div>
        <p className="hint">Keep pauses ≥ a few seconds and comments short (≤700 chars) — that reads human.</p>
      </div>

      <div className="card">
        <h2>Retries</h2>
        <div className="grid-2">
          <Num label="max attempts per candidate" get={() => cfg.limits?.maxRetriesPerCandidate ?? 3} set={(v) => update((d) => { d.limits = { ...(d.limits ?? {}), maxRetriesPerCandidate: v ?? 3 }; })} />
        </div>
        <p className="hint">After the last attempt the item is parked in failed/ for manual review.</p>
      </div>

      <div className="card">
        <h2>Browser on the Mac <span className="pill off">read-only here</span></h2>
        <p className="hint">The automation's Chrome setup. It runs only on the Mac, so change it in Raw JSON (and restart the runner) — not from a form.</p>
        <div className="kv-grid">
          <div className="kv"><span>profile dir</span><b className="mono">{browser.profileDir || 'chrome-profile'}</b></div>
          <div className="kv"><span>channel</span><b className="mono">{browser.channel || 'chrome'}</b></div>
          <div className="kv"><span>headless</span><b className="mono">{String(Boolean(browser.headless))}</b></div>
          <div className="kv"><span>locale</span><b className="mono">{browser.locale || 'en-US'}</b></div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Keep headless false — headless Chrome is far more detectable.</p>
      </div>

      <div className="card">
        <h2>Runs on the Mac <span className="pill off">read-only here</span></h2>
        <p className="hint">
          <b>Posting hours are set per day on the Schedule tab</b> — weekday vs weekend. launchd on the Mac wakes at those hours (next in {countdown.text || '—'}); run.js re-checks each wake against the day's list, and off-schedule wakes skip posting and engagement without opening Chrome. The Chrome profile and the LinkedIn login stay on the Mac and can't be edited from a web page. If a run reports AUTH_REQUIRED, run <span className="mono">npm run login</span> there. After you change hours, re-run <span className="mono">./install-schedule.sh</span> on the Mac so launchd wakes for any new hour.
        </p>
      </div>
    </div>
  );
}
