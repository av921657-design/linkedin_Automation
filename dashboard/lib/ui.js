/** Shared pure helpers for the dashboard UI (no React). The client components
 *  and page all import from here so there is one source of truth. */

export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Newline/comma separated text → clean hashtag list (leading # stripped). */
export const linesToTags = (s) =>
  String(s ?? '').split(/[\n,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean);

/** One-per-line text → trimmed strings (for handles, keywords, comment pool). */
export const linesToList = (s) => String(s ?? '').split('\n').map((t) => t.trim()).filter(Boolean);

export const RESULT_PILL = { posted: 'ok', nothing: '', failed: 'fail', error: 'fail', 'auth-paused': 'warn' };
export const RESULT_LABEL = { posted: 'posted', nothing: 'idle', failed: 'failed', error: 'error', 'auth-paused': 'paused' };

export const SLOTS = [10, 12, 14, 16, 18, 20];

/* ---------- day-wise schedule (mirrors src/schedule.js on the Mac) ---------- */

// null only when not an array; a present-but-empty array returns [] meaning
// "no hours for this group" on purpose (not a silent fallback to the default).
function cleanHours(arr) {
  if (!Array.isArray(arr)) return null;
  const set = new Set();
  for (const raw of arr) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 23) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Any config → { tz, weekday[], weekend[] }, honouring legacy `hours`, else defaults. */
export function normalizeSchedule(cfg) {
  const s = (cfg && cfg.schedule) || {};
  const tz = typeof s.timezone === 'string' && s.timezone ? s.timezone : 'Asia/Kolkata';
  const legacy = cleanHours(s.hours);
  const useLegacy = legacy && legacy.length ? legacy : null;
  return {
    tz,
    weekday: cleanHours(s.weekday) ?? useLegacy ?? [...SLOTS],
    weekend: cleanHours(s.weekend) ?? useLegacy ?? [...SLOTS],
  };
}

/** Weekday index (0 = Sunday … 6 = Saturday) for an instant, in `tz`. */
export function zonedWeekday(date = new Date(), tz = 'Asia/Kolkata') {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date);
  const i = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
  return i === undefined ? date.getDay() : i;
}

export const isWeekend = (date = new Date(), tz = 'Asia/Kolkata') => {
  const d = zonedWeekday(date, tz);
  return d === 0 || d === 6;
};

/** The posting hours for the day `date` falls on, in the schedule's tz. */
export function slotsForDate(cfg, date = new Date()) {
  const { tz, weekday, weekend } = normalizeSchedule(cfg);
  return isWeekend(date, tz) ? weekend : weekday;
}

/** Every hour used on any day — the set launchd must wake for. */
export function unionSlots(cfg) {
  const { weekday, weekend } = normalizeSchedule(cfg);
  return [...new Set([...weekday, ...weekend])].sort((a, b) => a - b);
}

/** Next scheduled slot from `from` (today, else the next day that has any). */
export function nextSlot(cfg, from = new Date()) {
  const { tz } = normalizeSchedule(cfg);
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(from);
  const g = (t) => Number(p.find((x) => x.type === t)?.value || 0) % (t === 'hour' ? 24 : 61);
  const cur = g('hour') + g('minute') / 60 + g('second') / 3600;
  const pad = (n) => String(n).padStart(2, '0');
  for (const hh of slotsForDate(cfg, from)) {
    if (hh > cur) return { hoursFromNow: hh - cur, hour: hh, dayOffset: 0, label: `${pad(hh)}:00 today` };
  }
  for (let d = 1; d <= 6; d++) {
    const slots = slotsForDate(cfg, new Date(from.getTime() + d * 86400000));
    if (slots.length) {
      const hh = slots[0];
      const when = d === 1 ? 'tomorrow' : `in ${d} days`;
      return { hoursFromNow: d * 24 - cur + hh, hour: hh, dayOffset: d, label: `${pad(hh)}:00 ${when}` };
    }
  }
  return null;
}

export const TYPE_LABEL = {
  folder: 'Queue folder', linkedin: 'LinkedIn profile', x: 'X / Twitter', instagram: 'Instagram',
  facebook: 'Facebook page', substack: 'Substack', medium: 'Medium', article: 'Blog / RSS',
};

/* ---------- schedule-timezone time helpers (default: India Standard Time) ---------- */

/** Compact zone label for headers: "Asia/Kolkata" → "Kolkata", "UTC" → "UTC". */
export function tzLabel(tz = 'Asia/Kolkata') {
  const s = String(tz || 'Asia/Kolkata');
  return (s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s).replace(/_/g, ' ');
}

export function zonedParts(date = new Date(), tz = 'Asia/Kolkata') {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const g = (t) => Number(p.find((x) => x.type === t)?.value || 0);
  return {
    h: g('hour') % 24, m: g('minute'), s: g('second'),
    day: new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date),
  };
}

/** Fractional hour-of-day in `tz` for an ISO timestamp, clamped into the visible 0–24 window. */
export function zonedFrac(iso, tz = 'Asia/Kolkata') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = Number(dt.find((x) => x.type === 'hour')?.value || 0) % 24;
  const m = Number(dt.find((x) => x.type === 'minute')?.value || 0);
  return Math.min(23.98, Math.max(0.05, h + m / 60));
}

/** "2026-10-14T09:12:00Z" → "2026-10-14 14:42" in `tz`, for tables and captions.
 *  Formatting matters: a bare string slice would show UTC while the rail beside
 *  it is drawn in the schedule's zone. */
export function stamp(iso, tz = 'Asia/Kolkata') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(',', '');
}
