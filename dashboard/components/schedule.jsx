'use client';

import { normalizeSchedule } from '../lib/ui';
import { Check, Select } from './controls';

// Zones most people pick, always at the top of the list; the browser's full
// IANA list (Intl.supportedValuesOf) is appended below them.
const COMMON_TZ = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Asia/Riyadh', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Istanbul',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Australia/Sydney', 'UTC',
];

function tzOptions(current) {
  let all = [];
  try {
    all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch { /* older browser — curated list only */ }
  const zones = [...new Set([current, ...COMMON_TZ, ...all].filter(Boolean))].sort();
  return zones.map((z) => [z, z.replace(/_/g, ' ')]);
}

const PRESETS = {
  'every 2h · 10–20': [10, 12, 14, 16, 18, 20],
  '9 / 12 / 15 / 18': [9, 12, 15, 18],
  'spread · 10,13,17,20': [10, 13, 17, 20],
  'mornings': [9, 11, 13],
  'clear': [],
};

/** Row of 0–23 hour toggles; clicking flips the hour in the group's list. */
function HourPicker({ value, onChange }) {
  const set = new Set(value);
  return (
    <div className="hours" role="group" aria-label="posting hours">
      {Array.from({ length: 24 }, (_, h) => {
        const on = set.has(h);
        return (
          <button
            type="button"
            key={h}
            aria-pressed={on}
            className={`hourbtn ${on ? 'on' : ''}`}
            onClick={() => {
              const n = new Set(set);
              if (n.has(h)) n.delete(h); else n.add(h);
              onChange([...n].sort((a, b) => a - b));
            }}
          >{String(h).padStart(2, '0')}</button>
        );
      })}
    </div>
  );
}

function DayRow({ title, value, other, mpr, cap, autopilot, onChange }) {
  const posts = Math.min(value.length * mpr, cap);
  return (
    <div className="sched-row">
      <div className="sched-head">
        <h3>
          {title} — {value.length} hour{value.length === 1 ? '' : 's'} · {autopilot ? (value.length ? `best hour chosen, ${cap} post${cap === 1 ? '' : 's'}/day` : 'no wakes') : `${posts} post${posts === 1 ? '' : 's'}/day`}
        </h3>
        <div className="presets">
          {Object.entries(PRESETS).map(([label, arr]) => (
            <button key={label} type="button" className="preset" onClick={() => onChange(arr)}>{label}</button>
          ))}
          <button type="button" className="preset" onClick={() => onChange(other)}>copy the other day</button>
        </div>
      </div>
      <HourPicker value={value} onChange={onChange} />
    </div>
  );
}

export function Schedule({ cfg, update }) {
  const { tz, weekday, weekend } = normalizeSchedule(cfg);
  const mpr = cfg.post?.maxPerRun ?? 1;
  const cap = cfg.post?.maxPerDay ?? 1;
  const autopilot = cfg.schedule?.autopilot === true;
  const setHours = (group) => (arr) => update((d) => {
    d.schedule = { ...(d.schedule || {}), [group]: arr };
  });
  const setAutopilot = (v) => update((d) => { d.schedule = { ...(d.schedule || {}), autopilot: v }; });

  return (
    <div className="panel">
      <div className="card">
        <h2>Posting schedule</h2>
        <p className="hint">
          Day-wise hours, on the hour, local to the <b>posting timezone</b> below. These are the times the PC is <b>awake and able to post</b>.
          With <b>autopilot</b> on, you do not have to choose among them: <span className="mono">src/besttime.js</span> ranks today&apos;s hours by how much of a
          professional audience is online (commute, lunch, end-of-day peaks; Tue–Thu strongest, Saturday weakest), then raises an hour that this
          account&apos;s own posts have measurably performed well in, and the day&apos;s single post waits for that winner. Every later wake that day retries until it is out.
          Turn autopilot off to post at the earliest configured hour, as before. The hour only fires once your Telegram answer has arrived (see
          <b> Telegram approval</b>); until then the wake asks and waits instead of publishing. Likes and comments on other people&apos;s posts are off —
          the automation no longer opens LinkedIn profiles.
        </p>
        <div style={{ marginBottom: 8 }}>
          <Check label="autopilot — pick the best-reach hour by itself" get={() => autopilot} set={setAutopilot} />
        </div>

        <Select
          label="posting timezone"
          get={() => tz}
          set={(v) => update((d) => { d.schedule = { ...(d.schedule || {}), timezone: v }; })}
          options={tzOptions(tz)}
        />
        <p className="field-hint">
          All hours below are wall-clock time in this zone, wherever the Mac physically sits.
          <span className="mono">run.js</span> judges every wake in this zone; <span className="mono">install-schedule.sh</span> converts the wakes to the Mac&apos;s own clock.
          If the zone observes DST, re-run <span className="mono">./install-schedule.sh</span> after a DST change so the wake times stay exact.
        </p>

        <DayRow title="Mon – Fri" value={weekday} other={weekend} mpr={mpr} cap={cap} autopilot={autopilot} onChange={setHours('weekday')} />
        <DayRow title="Sat – Sun" value={weekend} other={weekday} mpr={mpr} cap={cap} autopilot={autopilot} onChange={setHours('weekend')} />

        <p className="field-hint">
          Saving this takes effect on the <b>next scheduled tick</b> — <span className="mono">run.js</span> reads the config and only posts (and engages) when the current hour is in that day&apos;s list.
          Removing an hour does not lose the day&apos;s post if the winner was there: any later hour acts as a retry. But a winner with no wake after it can slip to the next day, so keep at least two hours on any day you want covered.
          To also change the exact times <span className="mono">launchd</span> wakes for, re-run <span className="mono">./install-schedule.sh</span> on the Mac; until then it may wake at hours you removed, where <span className="mono">run.js</span> harmlessly skips.
          The daily ceiling and posts-per-run are edited in <b>Posting &amp; limits</b> (cap is now {cap}/day).
        </p>
      </div>

      <div className="card">
        <h2>How the cadence is enforced</h2>
        <p className="hint">
          Three layers, same numbers: <b>launchd</b> fires a day-of-week calendar built from these hours (weekday hours on Weekday 1–5, weekend on 0 &amp; 6); <b>run.js</b> re-checks each wake against that day&apos;s list and then against the day&apos;s published count in the ledger, so a spent day costs no page load; and <b>autopilot</b> decides which of the surviving hours the post goes out in.
          Off-grid hours work once <span className="mono">install-schedule.sh</span> has been re-run. A manual <span className="mono">npm run post-now</span> ignores the schedule <i>and</i> the plan, but never the daily cap; <span className="mono">npm run dry-run</span> tests through both.
          The reason each wake chose (or waited) is pushed to the <b>Activity</b> list.
        </p>
      </div>
    </div>
  );
}
