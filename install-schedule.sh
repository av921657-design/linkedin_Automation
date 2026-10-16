#!/usr/bin/env bash
# Manage the launchd schedule (posting window, local time).
#   ./install-schedule.sh          install/refresh the job (applies window edits)
#   ./install-schedule.sh pause    stop the schedule (posts won't run)
#   ./install-schedule.sh resume   re-enable the schedule
#   ./install-schedule.sh status   show whether the job is loaded
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.av921657-design.linkedin-automation"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

# Posting hours are DAY-WISE, read from your config `schedule`
# (weekday = Mon-Fri, weekend = Sat-Sun, in `schedule.timezone`) via
# print-schedule.mjs, which resolves the same config the runner uses
# (dashboard -> cache -> local) and translates the posting-timezone hours to
# this Mac's local clock (exact Minute + Weekday, even for half-hour zones).
# After changing hours or the timezone in the dashboard, re-run
# ./install-schedule.sh so launchd wakes for the new set (and after any DST
# change in either zone). The WINDOW_* numbers below are only a fallback if
# the schedule can't be read.
WINDOW_START=10
WINDOW_STEP=2
WINDOW_END=20

write_plist() {
  local node_bin sched calendar_entries h
  node_bin="$(command -v node)"

  # Resolve the day-wise hours and expand them into per-(hour,weekday) dicts.
  # Preferred: print-schedule.mjs's `entries` — the configured posting-timezone
  # hours already translated to THIS Mac's local clock (correct Hour/Minute/
  # Weekday even when the posting timezone differs from the Mac's, including
  # half-hour offsets and day-boundary shifts). Fallback: raw weekday/weekend
  # hours on the hour (posting tz assumed = Mac tz).
  sched="$("$node_bin" "$ROOT/print-schedule.mjs" 2>/dev/null || true)"
  calendar_entries="$(printf '%s' "$sched" | "$node_bin" -e '
    let raw = "";
    process.stdin.on("data", (d) => raw += d).on("end", () => {
      let j = {};
      try { j = JSON.parse(raw || "{}"); } catch (e) {}
      const dict = (h, m, d) => "    <dict><key>Hour</key><integer>" + h +
        "</integer><key>Minute</key><integer>" + m +
        "</integer><key>Weekday</key><integer>" + d + "</integer></dict>\n";
      let out = "";
      if (Array.isArray(j.entries) && j.entries.length) {
        for (const e of j.entries) out += dict(Number(e.hour), Number(e.minute) || 0, Number(e.weekday));
      } else {
        const arr = (a, fb) => Array.isArray(a)
          ? a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23) : fb;
        const wd = arr(j.weekday, [10, 12, 14, 16, 18, 20]);
        const we = arr(j.weekend, [10, 12, 14, 16, 18, 20]);
        for (const h of wd) for (const d of [1, 2, 3, 4, 5]) out += dict(h, 0, d);
        for (const h of we) for (const d of [0, 6]) out += dict(h, 0, d);
      }
      process.stdout.write(out);
    });
  ' 2>/dev/null || true)"

  # Ultimate fallback (no node / unreadable schedule): the old every-2h grid, daily.
  if [ -z "$calendar_entries" ]; then
    for h in $(seq "$WINDOW_START" "$WINDOW_STEP" "$WINDOW_END"); do
      calendar_entries+="    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>
"
    done
  fi

  cat > "$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$ROOT/run.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <array>
$calendar_entries  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>$ROOT/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/logs/launchd.err.log</string>
</dict>
</plist>
EOF
}

case "${1:-install}" in
  install)
    mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"
    write_plist
    plutil -lint "$PLIST_DST" >/dev/null
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST_DST"
    echo "Installed. Posting follows your day-wise schedule (weekday + weekend hours, local time), read from the config the runner uses."
    echo "Change hours in the dashboard, then re-run ./install-schedule.sh to refresh which hours launchd wakes for."
    echo "run.js re-checks each wake against the day's hours anyway, so edits apply on the next tick even before this is re-run."
    echo "Next: make sure you've done the one-time login (npm run login)."
    ;;
  pause)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    echo "Schedule paused. Run ./install-schedule.sh resume to re-enable."
    ;;
  resume)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "Schedule already loaded."
    else
      launchctl bootstrap "$DOMAIN" "$PLIST_DST"
      echo "Schedule resumed."
    fi
    ;;
  status)
    launchctl list | grep "$LABEL" && echo "-> loaded" || echo "-> not loaded"
    ;;
  *)
    echo "Usage: $0 [install|pause|resume|status]"
    exit 1
    ;;
esac
