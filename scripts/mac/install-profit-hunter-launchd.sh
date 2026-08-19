#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="$(command -v node || true)"
PLIST="$HOME/Library/LaunchAgents/com.truely.tcos-profit-hunter.plist"
LOG_DIR="$REPO_ROOT/.tcos/logs"
RUNNER="$REPO_ROOT/scripts/mac/run-profit-hunter.mjs"
ENV_FILE="$REPO_ROOT/.env.local"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required but was not found in PATH." >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Profit Hunter will not be installed without its server credentials." >&2
  exit 2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.truely.tcos-profit-hunter</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--conditions=react-server</string>
    <string>--env-file=$ENV_FILE</string>
    <string>$RUNNER</string>
    <string>--per-query=20</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$REPO_ROOT</string>

  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>19</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  </array>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/profit-hunter.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/profit-hunter.err.log</string>

  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.truely.tcos-profit-hunter"

echo "Installed: $PLIST"
echo "Schedule: 7:00, 11:00, 15:00, 19:00, 21:00 America/Denver host time"
echo "Logs: $LOG_DIR/profit-hunter.out.log and $LOG_DIR/profit-hunter.err.log"
echo "Manual test:"
echo "  cd '$REPO_ROOT' && '$NODE_BIN' --conditions=react-server --env-file='$ENV_FILE' '$RUNNER' --force --per-query=5"
