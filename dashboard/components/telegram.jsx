'use client';

import { useMemo } from 'react';
import { Check, Num } from './controls';

/** Chat ids accept spaces, commas or newlines — one long line is easier to type on a phone. */
const parseIds = (s) =>
  String(s ?? '')
    .split(/[\s,]+/)
    .map((t) => Number(t))
    .filter((n) => Number.isInteger(n) && n !== 0);

export function Telegram({ cfg, update }) {
  const tg = () => cfg.telegram ?? {};
  const setTg = (p) => update((d) => { d.telegram = { ...(d.telegram ?? {}), ...p }; });
  const setApproval = (p) =>
    update((d) => { d.telegram = { ...(d.telegram ?? {}), approval: { ...(d.telegram?.approval ?? {}), ...p } }; });
  const ap = () => tg().approval ?? {};
  const idsText = useMemo(() => (tg().allowedChatIds ?? []).join('\n'), [cfg]);
  const enabled = tg().enabled === true;
  const hasIds = (tg().allowedChatIds ?? []).length > 0;
  const confirming = ap().enabled !== false;

  return (
    <div className="panel">
      <div className="card">
        <h2>
          Your yes before anything posts{' '}
          <span className={`pill ${enabled ? (hasIds ? 'on' : 'warn') : 'off'}`}>
            {enabled ? (hasIds ? 'active' : 'needs your chat id') : 'off'}
          </span>
        </h2>
        <p className="hint">
          This machine researches the web (Web research tab) and messages you what it found. <b>Nothing is published until you
          answer</b> — reply with a number, <span className="mono">yes</span>, or <span className="mono">no</span>. You can also
          message a topic any time and get a menu for it the same way. The bot token itself is <b>not</b> stored here — it lives on
          the machine in <span className="mono">state/telegram.token</span> (set it with <span className="mono">npm run telegram:setup</span>).
          While this switch is off nothing is asked, and because a yes is now mandatory, nothing auto-publishes either.
        </p>
        <div style={{ marginBottom: 8 }}>
          <Check label="ask me on Telegram" get={() => enabled} set={(v) => setTg({ enabled: v })} />
        </div>
        <h3>Your chat ids — one per line, or separated by commas ({(tg().allowedChatIds ?? []).length} saved)</h3>
        <textarea
          rows={2}
          value={idsText}
          placeholder={'e.g.\n123456789\n-987654321 (groups are negative)'}
          onChange={(e) => setTg({ allowedChatIds: parseIds(e.target.value) })}
        />
        <p className="hint">
          Easiest way to fill this in: on the PC run <span className="mono">npm run telegram:setup -- --check</span> after messaging
          your bot <span className="mono">/start</span> — it reads the number Telegram sees you under and prints the exact
          <span className="mono"> --allow </span> command. Only numbers on this list are answered — the first one is who the daily
          question goes to, and anyone else who messages is ignored.
        </p>
      </div>

      <div className="card">
        <h2>
          The confirmation step{' '}
          <span className={`pill ${confirming ? 'on' : 'off'}`}>{confirming ? 'waiting for your answer' : 'off — research results never post'}</span>
        </h2>
        <div className="grid-3">
          <Num label="hours to wait for my answer" get={() => ap().answerHours ?? 4} set={(v) => setApproval({ answerHours: v ?? 4 })} />
          <Num label="nudge me after (hours)" get={() => ap().remindAfterHours ?? 1.5} set={(v) => setApproval({ remindAfterHours: v ?? 1.5 })} />
          <Num label="days an offer is re-asked" get={() => ap().holdDays ?? 2} set={(v) => setApproval({ holdDays: v ?? 2 })} />
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Num label="candidates per menu" get={() => ap().maxCandidates ?? 5} set={(v) => setApproval({ maxCandidates: v ?? 5 })} />
          <Num label="article text kept per candidate" get={() => ap().bodyChars ?? 6000} set={(v) => setApproval({ bodyChars: v ?? 6000 })} />
        </div>
        <p className="hint">
          No answer by the deadline and the offer rolls to tomorrow's first awake hour with something fresher — it is re-asked for
          this many days, then dropped without publishing. Say <span className="mono">no</span> and that content is never posted; say
          nothing and it is never posted either. One confirmed post still spends the day's single slot.
        </p>
        <div style={{ marginTop: 4 }}>
          <Check label="require a confirmation before publishing (turning this off stops research posts entirely)" get={() => confirming} set={(v) => setApproval({ enabled: v })} />
        </div>
      </div>

      <div className="card">
        <h2>The delivery window</h2>
        <div className="grid-3">
          <Num label="post within (minutes)" get={() => tg().windowMinutes ?? 120} set={(v) => setTg({ windowMinutes: v ?? 120 })} />
          <Num label="earliest start after (minutes)" get={() => tg().minLeadMinutes ?? 10} set={(v) => setTg({ minLeadMinutes: v ?? 10 })} />
          <Num label="time kept for the run (minutes)" get={() => tg().reserveMinutes ?? 20} set={(v) => setTg({ reserveMinutes: v ?? 20 })} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Check
            label="start at a normal posting hour when one fits"
            get={() => tg().useScheduledSlots !== false}
            set={(v) => setTg({ useScheduledSlots: v })}
          />
        </div>
        <p className="hint">
          The deadline is measured from the moment your message arrives. With the checkbox on, an approved post waits for the next
          hour from your Schedule tab that still leaves room for it; with it off, it posts as soon as the earliest-start delay passes.
          A video upload takes minutes, so keep the reserve.
        </p>
      </div>

      <div className="card">
        <h2>What counts as fresh</h2>
        <div className="grid-2">
          <Num label="search only this far back (hours)" get={() => tg().freshnessHours ?? 24} set={(v) => setTg({ freshnessHours: v ?? 24 })} />
          <Num label="never publish older than (hours)" get={() => tg().maxAgeHours ?? 168} set={(v) => setTg({ maxAgeHours: v ?? 168 })} />
        </div>
        <p className="hint">
          The first number narrows the search. The second is the hard cut on what may actually be published — votes and comments
          take days to build, so a strong post from 4 days ago still gets a chance while a months-old one never does.
        </p>
      </div>

      <div className="card">
        <h2>How the menu is ranked</h2>
        <div className="grid-3">
          <Num label="topic match" step={0.05} get={() => tg().weights?.relevance ?? 0.55} set={(v) => setTg({ weights: { ...(tg().weights ?? {}), relevance: v ?? 0.55 } })} />
          <Num label="trending" step={0.05} get={() => tg().weights?.trending ?? 0.3} set={(v) => setTg({ weights: { ...(tg().weights ?? {}), trending: v ?? 0.3 } })} />
          <Num label="recency" step={0.05} get={() => tg().weights?.recency ?? 0.15} set={(v) => setTg({ weights: { ...(tg().weights ?? {}), recency: v ?? 0.15 } })} />
        </div>
        <p className="hint">
          The same three weights rank web findings (votes and comments stand in for reactions here). A match floor stays in force
          whatever you set, so a vague topic cannot launder an unrelated viral post onto your profile.
        </p>
      </div>

      <div className="card">
        <h2>Before it goes live</h2>
        <p className="hint">
          Saving this tab is enough to switch the feature on for the runner — it reads this cloud config every run. The machine
          still needs the ticker registered (<span className="mono">npm run schedule:win:topics</span> on Windows,{' '}
          <span className="mono">./install-schedule.sh topics</span> on macOS), which refuses to install while the switch is off.
          Check what is waiting on an answer with <span className="mono">npm run topics:status</span>.
        </p>
      </div>
    </div>
  );
}
