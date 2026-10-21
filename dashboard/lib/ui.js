/** Shared pure helpers for the dashboard UI (no React). The client components
 *  and page all import from here so there is one source of truth. */

export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Newline/comma separated text → clean hashtag list (leading # stripped). */
export const linesToTags = (s) =>
  String(s ?? '').split(/[\n,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean);

/** One-per-line text → trimmed strings (for handles, keywords, comment pool). */
export const linesToList = (s) => String(s ?? '').split('\n').map((t) => t.trim()).filter(Boolean);

export const RESULT_PILL = { posted: 'ok', nothing: '', failed: 'fail', error: 'fail', 'auth-paused': 'warn', 'daily-cap': '', 'waiting-for-plan': '', 'no-match': 'warn', retrying: 'warn', busy: '', held: '' };
export const RESULT_LABEL = { posted: 'posted', nothing: 'idle', failed: 'failed', error: 'error', 'auth-paused': 'paused', 'daily-cap': "day's cap reached", 'waiting-for-plan': 'waiting for its hour', 'no-match': 'no match', retrying: 'retrying', busy: 'another run', held: 'held' };

/* ---------- the day's question (run.js → status.daily) ---------- */

export const DAILY_LABEL = {
  asked: 'asked you on Telegram',
  'not-asked': 'did not ask',
  'already-asked': 'already asked today',
  'no-match': 'nothing fresh to ask',
  waiting: 'searching',
  preview: 'dry run — would have asked',
};
export const DAILY_PILL = { asked: 'ok', 'not-asked': 'warn', 'no-match': 'warn', waiting: 'warn', 'already-asked': '', preview: '' };

/** One plain-language sentence about why today's post was or wasn't asked about. */
export function dailyNote(daily, tz = 'Asia/Kolkata') {
  if (!daily || !daily.result) return '';
  const label = DAILY_LABEL[daily.result] || daily.result;
  if (daily.result === 'not-asked') return `${label}: ${daily.why || 'no reason reported'}`;
  if (daily.result === 'no-match') return `${label} — everything the web feeds returned is already on your page, or nothing was fresh enough.`;
  if (daily.result === 'already-asked') return `${label} — the answer is still wanted from you on Telegram.`;
  const bits = [];
  if (daily.topic) bits.push(`topic “${daily.topic}”`);
  if (Number.isFinite(daily.candidates)) bits.push(`${daily.candidates} candidate(s)`);
  if (daily.answerBy) bits.push(`answer by ${stamp(daily.answerBy, tz)}`);
  return bits.length ? `${label} — ${bits.join(', ')}` : label;
}

export const SLOTS = [10, 12, 14, 16, 18, 20];

/* ---------- the newsletter calendar (mirrors src/newsletter.js on the Mac) ---------- */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const NL_EVENTS_DEFAULT = [
  { name: 'Morning issue', days: [...WEEKDAYS], hour: 9, on: true },
  { name: 'Evening issue', days: [...WEEKDAYS], hour: 18, on: true },
];

/** One row per issue: the weekdays it runs on, the hour it lands, whether it is on. */
export function eventsOf(nl) {
  // An old config that names only day/days is one row at draftHour, not the
  // default calendar — the Mac runner reads it that way, so the editor must too.
  const legacy = (Array.isArray(nl?.days) && nl.days.length ? nl.days : nl?.day ? [nl.day] : null)
    ?.map((x) => String(x).slice(0, 3)).filter((d) => WEEKDAYS.includes(d));
  const raw = Array.isArray(nl?.events) && nl.events.length ? nl.events
    : legacy?.length ? [{ name: 'Issue', days: legacy, hour: Number(nl?.draftHour) || 8 }]
      : NL_EVENTS_DEFAULT;
  const list = raw.slice(0, 6).map((e, i) => {
    const days = WEEKDAYS.filter((d) => (Array.isArray(e?.days) ? e.days : []).map((x) => String(x).slice(0, 3)).includes(d));
    return {
      name: String(e?.name ?? '').trim() || `Issue ${i + 1}`,
      days: days.length ? days : [...WEEKDAYS],
      hour: Math.min(23, Math.max(0, Math.round(Number(e?.hour)) || (NL_EVENTS_DEFAULT[i]?.hour ?? 9))),
      on: e?.on !== false,
    };
  });
  return list.sort((a, b) => a.hour - b.hour);
}

/** "twice a day", "every day", "twice a week" — the cadence in a reader's words. */
export function cadenceWords(nl) {
  const ev = eventsOf(nl).filter((e) => e.on);
  if (!ev.length) return 'no set day';
  if (ev.every((e) => e.days.length === 7)) {
    if (ev.length === 1) return 'every day';
    return ev.length === 2 ? 'twice a day' : `${ev.length} times a day`;
  }
  const perWeek = ev.reduce((a, e) => a + e.days.length, 0);
  const label = dayRange([...new Set(ev.flatMap((e) => e.days))]);
  if (perWeek === 7) return 'every day';
  if (perWeek === 1) return `once a week (${label})`;
  if (perWeek === 2) return `twice a week (${label})`;
  if (perWeek <= 6) return `${['', '', '', 'three', 'four', 'five', 'six'][perWeek]} times a week (${label})`;
  return `${perWeek} issues a week (${label})`;
}

/** "Mon to Fri", "Tue & Fri". */
export function dayRange(days) {
  const list = WEEKDAYS.filter((d) => (days ?? []).includes(d));
  if (list.length === 7) return 'every day';
  if (list.length === 1) return list[0];
  if (list.join('+') === 'Mon+Tue+Wed+Thu+Fri') return 'weekdays';
  if (list.join('+') === 'Sat+Sun') return 'weekends';
  const head = list.slice(0, -1);
  return head.length ? `${head.join(', ')} & ${list.at(-1)}` : list.join(' & ');
}


export const NL_LABEL = {
  drafted: 'drafted',
  'awaiting-approval': 'waiting on your yes',
  approved: 'approved',
  held: 'on hold',
  drafting: 'being researched',
};
export const NL_PILL = { drafted: '', 'awaiting-approval': 'warn', approved: 'ok', held: 'warn', drafting: 'warn' };

/** What the weekly tick actually did. `waiting` is either a status word or the
 *  runner's own reason sentence, so an unlisted value is still readable. */
export function newsletterNote(nl) {
  if (!nl) return 'This week has not been reported by the Mac yet.';
  if (nl.enabled === false) return 'Switched off in the config, so no issue was researched or asked about.';
  const bits = [];
  if (nl.drafted) bits.push(`drafted ${nl.drafted}`);
  if (nl.offered === true) bits.push('asked on Telegram');
  else if (nl.offered === false) bits.push(`it could not be sent (${nl.blocked || 'no Telegram'})`);
  if (nl.published?.result) bits.push(nl.published.result === 'posted' ? 'published to LinkedIn' : `publish attempt: ${nl.published.result}`);
  if (nl.error) bits.push(`it hit an error (${nl.error})`);
  const state = NL_LABEL[nl.waiting] ? `The current issue is ${NL_LABEL[nl.waiting]}` : nl.waiting ? `This issue: ${nl.waiting}` : 'Nothing new yet';
  return bits.length ? `${state} — ${bits.join(', ')}.` : `${state}.`;
}

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
