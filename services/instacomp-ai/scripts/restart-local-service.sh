#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.tcos.instacomp-ai.service"
DOMAIN="gui/$(id -u)"
LOG="$SERVICE_ROOT/data/logs/settings-restart.log"

mkdir -p "$(dirname "$LOG")"
/bin/sleep 1
printf '%s Restart requested from cockpit\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"

if /bin/launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  /bin/launchctl kickstart -k "$DOMAIN/$LABEL" >> "$LOG" 2>&1
  exit 0
fi

printf '%s LaunchAgent is not installed; automatic restart skipped\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
exit 2
