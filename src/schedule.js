/**
 * Day-wise posting schedule. Pure helpers, no fs/network — the runner, the
 * install script and the `print-schedule` helper all share this one module.
 *
 * Shape (config.json `schedule` block):
 *   {
 *     "timezone": "Asia/Kolkata",   // IANA zone the Mac's clock is judged in
 *     "weekday":  [10, 13, 17, 20],  // Mon–Fri posting hours, local to tz (0–23)
 *     "weekend":  [10, 12, 14, 16, 18, 20]  // Sat–Sun posting hours
 *   }
 *
 * "Weekend" is Saturday + Sunday; everything else is "weekday". Posts per day
 * = that day's slot count x post.maxPerRun. If only the legacy `schedule.hours`
 * list is present it is used for BOTH groups; if no schedule block exists we
 * fall back to the historical every-2h 10:00–20:00 grid so an old config behaves
 * exactly as before.
 */

const DEFAULT_TZ = 'Asia/Kolkata';
const DEFAULT_GRID = [10, 12, 14, 16, 18, 20];

/**
 * Normalise an hour list. Returns null only when the input is not an array at
 * all (so the caller can fall back); a PRESENT-but-empty array returns [] — that
 * means "no hours for this group", deliberately, not a silent default.
 */
function norm(arr) {
  if (!Array.isArray(arr)) return null;
  const set = new Set();
  for (const raw of arr) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 23) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Normalise any config (or none) into { tz, weekday:[], weekend:[] }. */
export function normalizeSchedule(cfg) {
  const s = (cfg && cfg.schedule) || {};
  const tz = typeof s.timezone === 'string' && s.timezone ? s.timezone : DEFAULT_TZ;
  const legacy = norm(s.hours);
  const useLegacy = legacy && legacy.length ? legacy : null;
  return {
    tz,
    weekday: norm(s.weekday) ?? useLegacy ?? [...DEFAULT_GRID],
    weekend: norm(s.weekend) ?? useLegacy ?? [...DEFAULT_GRID],
  };
}

/** Which group a given instant falls in, evaluated in the schedule's timezone. */
export function isWeekend(date, tz = DEFAULT_TZ) {
  // en-US weekday short → index; formatted in tz so "today" is the local day.
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date || new Date());
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
  const day = idx === undefined ? (date || new Date()).getDay() : idx;
  return day === 0 || day === 6;
}

/** The posting hours for the day `date` falls on, in tz. */
export function slotsForDate(cfg, date = new Date()) {
  const { tz, weekday, weekend } = normalizeSchedule(cfg);
  return isWeekend(date, tz) ? weekend : weekday;
}

/** True when `date` sits inside a scheduled posting hour for its day. */
export function isSlot(cfg, date = new Date()) {
  const { tz } = normalizeSchedule(cfg);
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date);
  const hour = Number(h) % 24;
  return slotsForDate(cfg, date).includes(hour);
}

/** Sorted union of every hour used on any day — what launchd must wake for. */
export function unionSlots(cfg) {
  const { weekday, weekend } = normalizeSchedule(cfg);
  return [...new Set([...weekday, ...weekend])].sort((a, b) => a - b);
}

/** The two hour-lists, for the install script to turn into launchd dicts. */
export function scheduleSlots(cfg) {
  const { weekday, weekend } = normalizeSchedule(cfg);
  return { weekday, weekend };
}

/**
 * Next scheduled slot from `from`, scanning today then up to 6 more days.
 * Returns { hoursFromNow, hour, dayOffset, label } or null if nothing set.
 * dayOffset 0 = today, 1 = tomorrow, …; label is display-ready.
 */
export function nextSlot(cfg, from = new Date()) {
  const { tz } = normalizeSchedule(cfg);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(from);
  const g = (t) => Number(parts.find((x) => x.type === t)?.value || 0) % (t === 'hour' ? 24 : 61);
  const cur = g('hour') + g('minute') / 60 + g('second') / 3600;

  const pad = (n) => String(n).padStart(2, '0');
  // Today: the first slot still ahead of the clock.
  for (const hh of slotsForDate(cfg, from)) {
    if (hh > cur) return { hoursFromNow: hh - cur, hour: hh, dayOffset: 0, label: `${pad(hh)}:00 today` };
  }
  // Otherwise the first slot of the next day that has any.
  for (let d = 1; d <= 6; d++) {
    const day = new Date(from.getTime() + d * 86400000);
    const slots = slotsForDate(cfg, day);
    if (slots.length) {
      const hh = slots[0];
      const when = d === 1 ? 'tomorrow' : `in ${d} days`;
      return { hoursFromNow: d * 24 - cur + hh, hour: hh, dayOffset: d, label: `${pad(hh)}:00 ${when}` };
    }
  }
  return null;
}

const WD_IDX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** UTC offset of `tz` at `instant` (ms): its wall clock read as UTC minus true UTC. */
function zoneOffsetMs(tz, instant) {
  const t = instant instanceof Date ? instant.getTime() : Number(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(t);
  const g = (t2) => Number(parts.find((x) => x.type === t2)?.value || 0);
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return asUTC - Math.floor(t / 1000) * 1000;
}

/** Instant (epoch ms) at which `tz`'s wall clock reads Y-M-D H:00. */
function wallToInstant(tz, y, m, d, h) {
  const guess = Date.UTC(y, m - 1, d, h, 0, 0);
  let inst = guess - zoneOffsetMs(tz, guess);
  inst = guess - zoneOffsetMs(tz, inst); // refine once for DST edges
  return inst;
}

/**
 * The launchd calendar the Mac actually needs: each configured (tz wall-clock
 * hour, tz weekday) converted to Mac-LOCAL (Hour, Minute, Weekday). Identical
 * to the raw hours when tz is the Mac's own zone; otherwise the offset (and
 * any half-hour zones / day-boundary crossings) is applied. DST caveat: the
 * mapping is computed for the NEXT occurrence of each weekday — re-run the
 * installer after a DST change in either zone to keep wakes exact.
 */
export function localWakeEntries(cfg, now = new Date()) {
  const { tz, weekday, weekend } = normalizeSchedule(cfg);
  const today = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const g = (t) => Number(today.find((x) => x.type === t)?.value || 0);
  const entries = [];
  const seen = new Set();
  for (const [hours, days] of [[weekday, [1, 2, 3, 4, 5]], [weekend, [0, 6]]]) {
    for (const wantDay of days) {
      for (const H of hours) {
        // find the next tz-calendar-date whose weekday matches
        for (let add = 0; add <= 13; add++) {
          const date = new Date(Date.UTC(g('year'), g('month') - 1, g('day') + add));
          const y = date.getUTCFullYear();
          const m = date.getUTCMonth() + 1;
          const d = date.getUTCDate();
          const wd = WD_IDX[new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
            .format(wallToInstant(tz, y, m, d, 12))];
          if (wd !== wantDay) continue;
          let inst = wallToInstant(tz, y, m, d, H);
          if (inst < now.getTime() - 60000) inst = wallToInstant(tz, y, m, d + 7, H);
          const local = new Date(inst); // Mac's own zone (the process default)
          const key = `${local.getHours()}:${local.getMinutes()}:${local.getDay()}`;
          if (!seen.has(key)) {
            seen.add(key);
            entries.push({ hour: local.getHours(), minute: local.getMinutes(), weekday: local.getDay() });
          }
          break;
        }
      }
    }
  }
  return entries.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
}
