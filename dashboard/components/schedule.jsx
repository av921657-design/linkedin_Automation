'use client';

import { normalizeSchedule } from '../lib/ui';
import { Select } from './controls';

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

function DayRow({ title, value, other, mpr, onChange }) {
  const posts = value.length * mpr;
  return (
    <div className="sched-row">
      <div className="sched-head">
        <h3>{title} — {value.length} hour{value.length === 1 ? '' : 's'} · {posts} post{posts === 1 ? '' : 's'}/day</h3>
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
  const setHours = (group) => (arr) => update((d) => {
    d.schedule = { ...(d.schedule || {}), [group]: arr };
  });

  return (
    <div className="panel">
      <div className="card">
        <h2>Posting schedule</h2>
        <p className="hint">
          Day-wise hours, on the hour, local to the <b>posting timezone</b> below. Pick the times the Mac should wake to post;
          posts per day = the hours you choose × <b>posts-per-run</b> (now {mpr}, set under <b>Posting &amp; limits</b>).
          Engagement (likes/comments) runs on these same wakes.
        </p>

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

        <DayRow title="Mon – Fri" value={weekday} other={weekend} mpr={mpr} onChange={setHours('weekday')} />
        <DayRow title="Sat – Sun" value={weekend} other={weekday} mpr={mpr} onChange={setHours('weekend')} />

        <p className="field-hint">
          Saving this takes effect on the <b>next scheduled tick</b> — <span className="mono">run.js</span> reads the config and only posts (and engages) when the current hour is in that day&apos;s list.
          To also change the exact times <span className="mono">launchd</span> wakes for, re-run <span className="mono">./install-schedule.sh</span> on the Mac; until then it may wake at hours you removed, where <span className="mono">run.js</span> harmlessly skips.
          Posts-per-run is edited in <b>Posting &amp; limits</b>.
        </p>
      </div>

      <div className="card">
        <h2>How the cadence is enforced</h2>
        <p className="hint">
          Two layers, same numbers: <b>launchd</b> fires a day-of-week calendar built from these hours (weekday hours on Weekday 1–5, weekend on 0 &amp; 6), and <b>run.js</b> re-checks each wake against the day&apos;s list before opening Chrome. Off-grid hours work once <span className="mono">install-schedule.sh</span> has been re-run. A manual <span className="mono">npm run post-now</span> ignores the schedule; <span className="mono">npm run dry-run</span> tests through it.
        </p>
      </div>
    </div>
  );
}
