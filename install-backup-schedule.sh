#!/usr/bin/env bash
# Daily encrypted backup schedule (launchd), separate from the posting job.
#   ./install-backup-schedule.sh          install/refresh (default 21:30 local)
#   ./install-backup-schedule.sh pause|resume|status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.av921657-design.linkedin-automation-backup"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

BACKUP_HOUR=21
BACKUP_MINUTE=30

write_plist() {
  local node_bin
  node_bin="$(command -v node)"
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
    <string>$ROOT/backup.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$BACKUP_HOUR</integer>
    <key>Minute</key><integer>$BACKUP_MINUTE</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$ROOT/logs/launchd-backup.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/logs/launchd-backup.err.log</string>
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
    echo "Backup job installed: daily at $(printf '%02d:%02d' "$BACKUP_HOUR" "$BACKUP_MINUTE") local time."
    echo "Prerequisite: one-time passphrase -> npm run backup:setup (and OneDrive running)."
    ;;
  pause)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    echo "Backup schedule paused."
    ;;
  resume)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "Already loaded."
    else
      launchctl bootstrap "$DOMAIN" "$PLIST_DST"
      echo "Backup schedule resumed."
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
