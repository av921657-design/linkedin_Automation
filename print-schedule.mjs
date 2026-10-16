#!/usr/bin/env node
/**
 * Prints the day-wise posting hours as JSON for install-schedule.sh to expand
 * into a day-of-week launchd calendar. It resolves the SAME config the runner
 * uses (dashboard -> cache -> local), so the generated plist matches whatever
 * the dashboard Schedule tab currently shows.
 *
 *   stdout:  {"weekday":[10,13,17,20],"weekend":[10,12,14,16,18,20],
 *             "tz":"Asia/Kolkata","macTz":"Asia/Kolkata",
 *             "entries":[{"hour":10,"minute":0,"weekday":1}, …]}
 *            `entries` are the SAME wakes translated to the Mac's local clock —
 *            use them if present (they handle posting-tz ≠ Mac-tz, including
 *            half-hour offsets and day-boundary shifts).
 *   stderr:  human logs (which origin was used, etc.)
 *
 * Usage: node print-schedule.mjs   (or: npm run schedule:print)
 */
import { resolveConfig } from './src/sync.js';
import { scheduleSlots, localWakeEntries, normalizeSchedule } from './src/schedule.js';

const log = (m) => process.stderr.write(`${m}\n`);

try {
  const { cfg, origin } = await resolveConfig(log);
  const { weekday, weekend } = scheduleSlots(cfg);
  const { tz } = normalizeSchedule(cfg);
  const macTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const entries = localWakeEntries(cfg);
  log(`read schedule from ${origin} config (posting tz ${tz}, Mac tz ${macTz}, ${entries.length} local wakes)`);
  process.stdout.write(`${JSON.stringify({ weekday, weekend, tz, macTz, entries })}\n`);
} catch (err) {
  log(`print-schedule failed: ${err.message}`);
  process.exit(1);
}
