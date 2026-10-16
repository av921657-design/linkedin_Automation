#!/usr/bin/env node
/**
 * Windows Task Scheduler installer — the counterpart of install-schedule.sh /
 * install-backup-schedule.sh (which use macOS launchd).
 *
 *   node windows/install-tasks.mjs install            register/refresh BOTH jobs
 *   node windows/install-tasks.mjs install post       only the posting job
 *   node windows/install-tasks.mjs install backup     only the nightly backup
 *   node windows/install-tasks.mjs pause|resume|remove|status [post|backup|all]
 *   node windows/install-tasks.mjs install --print-xml   dump XML, register nothing
 *
 * Posting wakes follow your day-wise schedule exactly like on the Mac: the
 * `schedule` block (weekday/weekend hours in `schedule.timezone`) is read
 * through the SAME config chain the runner uses (dashboard → cache → local)
 * and translated to this machine's local clock — correct minute + weekday
 * even for foreign or half-hour zones (src/schedule.js localWakeEntries).
 * run.js re-checks every wake against the schedule anyway, so dashboard
 * hour edits apply on the next tick; re-run this installer after changing
 * HOURS or the TIMEZONE (and after any DST change) to refresh which times
 * Windows wakes for.
 *
 * StartWhenAvailable=true means a missed wake (PC asleep) runs once when it
 * comes back — same coalescing behaviour as launchd. WakeToRun=true asks
 * Windows to wake the PC from sleep for a posting slot (a locked-but-awake
 * session is enough; a logged-out PC is not — see Windows-Setup.md).
 *
 * Running this on a non-Windows machine is safe: it generates and prints the
 * XML (for inspection/testing) and skips the `schtasks` registration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT } from '../src/paths.js';
import { resolveConfig } from '../src/sync.js';
import { localWakeEntries } from '../src/schedule.js';

const TASK_POST = 'LinkedIn Automation';
const TASK_BACKUP = 'LinkedIn Automation Backup';
const BACKUP_AT = { hour: 21, minute: 30 }; // local time, daily
const XML_DIR = path.join(ROOT, 'state', 'task-xml');
const LOGS = path.join(ROOT, 'logs');

const DAY_ELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Next date+time (local) matching weekday(0-6)/hour/minute, strictly in the future. */
function nextBoundary(weekday, hour, minute, now = new Date()) {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  d.setHours(hour, minute, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}:00`;
}

const weeklyTrigger = (hour, minute, weekday) =>
  `    <CalendarTrigger>\n` +
  `      <StartBoundary>${nextBoundary(weekday, hour, minute)}</StartBoundary>\n` +
  `      <Enabled>true</Enabled>\n` +
  `      <ScheduleByWeek><DaysOfWeek><${DAY_ELS[weekday]} /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek>\n` +
  `    </CalendarTrigger>\n`;

const dailyTrigger = (hour, minute) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  const boundary = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}:00`;
  return (
    `    <CalendarTrigger>\n` +
    `      <StartBoundary>${boundary}</StartBoundary>\n` +
    `      <Enabled>true</Enabled>\n` +
    `      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n` +
    `    </CalendarTrigger>\n`
  );
};

function taskXml({ description, script, triggers }) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n` +
    `  <RegistrationInfo><Description>${esc(description)}</Description></RegistrationInfo>\n` +
    `  <Triggers>\n${triggers}  </Triggers>\n` +
    `  <Principals><Principal id="Author">\n` +
    `    <LogonType>InteractiveToken</LogonType>\n` +
    `    <RunLevel>LeastPrivilege</RunLevel>\n` +
    `  </Principal></Principals>\n` +
    `  <Settings>\n` +
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n` +
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n` +
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n` +
    `    <AllowHardTerminate>true</AllowHardTerminate>\n` +
    `    <StartWhenAvailable>true</StartWhenAvailable>\n` +
    `    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>\n` +
    `    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>\n` +
    `    <AllowStartOnDemand>true</AllowStartOnDemand>\n` +
    `    <Enabled>true</Enabled>\n` +
    `    <Hidden>false</Hidden>\n` +
    `    <RunOnlyIfIdle>false</RunOnlyIfIdle>\n` +
    `    <WakeToRun>true</WakeToRun>\n` +
    `    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>\n` +
    `    <Priority>7</Priority>\n` +
    `  </Settings>\n` +
    `  <Actions Context="Author"><Exec>\n` +
    `    <Command>${esc(process.execPath)}</Command>\n` +
    `    <Arguments>"${esc(path.join(ROOT, script))}"</Arguments>\n` +
    `    <WorkingDirectory>${esc(ROOT)}</WorkingDirectory>\n` +
    `  </Exec></Actions>\n` +
    `</Task>\n`
  );
}

/** Posting wake entries: config-translated, with the same fallbacks the Mac plist uses. */
async function postEntries(log) {
  try {
    const { cfg, origin } = await resolveConfig(log);
    const entries = localWakeEntries(cfg);
    if (entries.length) {
      log(`[win] posting wakes from ${origin} config: ${entries.length} weekly slots`);
      return entries;
    }
    log('[win] schedule resolved but produced no wakes (all day-groups empty?) — nothing scheduled.');
    return [];
  } catch (err) {
    log(`[win] could not read config schedule (${err.message}) — falling back to every-2h 10:00–20:00 daily.`);
    const out = [];
    for (let h = 10; h <= 20; h += 2) for (let wd = 0; wd < 7; wd++) out.push({ hour: h, minute: 0, weekday: wd });
    return out;
  }
}

function schtasks(args) {
  return execFileSync('schtasks', args, { encoding: 'utf8' }).trim();
}

async function install(which, printXml) {
  fs.mkdirSync(XML_DIR, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  const isWin = process.platform === 'win32';
  const jobs = [];

  if (which === 'all' || which === 'post') {
    const entries = await postEntries(console.log);
    if (!entries.length) {
      console.log('Posting schedule is empty in the config — the posting task was NOT registered.');
    } else {
      jobs.push({
        name: TASK_POST,
        file: path.join(XML_DIR, 'post.xml'),
        xml: taskXml({
          description: 'LinkedIn Automation — day-wise posting run (run.js self-gates; missed wakes run on resume).',
          script: 'run.js',
          triggers: entries.map((e) => weeklyTrigger(e.hour, e.minute, e.weekday)).join(''),
        }),
      });
      console.log(`Posting task: ${entries.length} weekly wakes (this machine's local clock): ` +
        entries.map((e) => `${DAY_ELS[e.weekday].slice(0, 3)} ${pad(e.hour)}:${pad(e.minute)}`).join(', '));
    }
  }
  if (which === 'all' || which === 'backup') {
    jobs.push({
      name: TASK_BACKUP,
      file: path.join(XML_DIR, 'backup.xml'),
      xml: taskXml({
        description: 'LinkedIn Automation — nightly encrypted backup to OneDrive (backup.js).',
        script: 'backup.js',
        triggers: dailyTrigger(BACKUP_AT.hour, BACKUP_AT.minute),
      }),
    });
    console.log(`Backup task: daily at ${pad(BACKUP_AT.hour)}:${pad(BACKUP_AT.minute)} local.`);
  }

  for (const j of jobs) {
    fs.writeFileSync(j.file, j.xml);
    if (printXml) {
      console.log(`\n--- ${j.name} (${j.file}) ---\n${j.xml}`);
      continue;
    }
    if (!isWin) {
      console.log(`(not Windows — XML written for inspection; run this file on the PC to register "${j.name}")`);
      continue;
    }
    schtasks(['/Create', '/TN', j.name, '/XML', j.file, '/F']);
    console.log(`✔ Registered "${j.name}" in Task Scheduler.`);
  }
  if (!printXml && isWin && jobs.length) {
    console.log('Check: node windows/install-tasks.mjs status   — and the one-time `npm run login`.');
  }
}

function perTask(which, fn) {
  const names =
    which === 'post' ? [TASK_POST] : which === 'backup' ? [TASK_BACKUP] : [TASK_POST, TASK_BACKUP];
  for (const n of names) console.log(`${n}: ${fn(n)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'install';
  const which = (args[1] && ['post', 'backup', 'all'].includes(args[1])) ? args[1] : 'all';
  const printXml = args.includes('--print-xml');

  if (cmd === 'install') return install(which, printXml);

  if (process.platform !== 'win32') {
    console.log('Task Scheduler commands (pause/resume/status/remove) only run on Windows.');
    return;
  }
  switch (cmd) {
    case 'pause':
      return perTask(which, (n) => schtasks(['/Change', '/TN', n, '/DISABLE']));
    case 'resume':
      return perTask(which, (n) => schtasks(['/Change', '/TN', n, '/ENABLE']));
    case 'remove':
      return perTask(which, (n) => schtasks(['/Delete', '/TN', n, '/F']));
    case 'status':
      return perTask(which, (n) => {
        try {
          return schtasks(['/Query', '/TN', n, '/FO', 'LIST']).split(/\r?\n/)
            .filter((l) => /^(TaskName|Status|Next Run Time|Last Run Time)/i.test(l))
            .join(' | ');
        } catch {
          return 'NOT REGISTERED';
        }
      });
    default:
      console.log('Usage: node windows/install-tasks.mjs [install|pause|resume|status|remove] [post|backup|all] [--print-xml]');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
});
