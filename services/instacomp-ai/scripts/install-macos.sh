#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$SERVICE_ROOT/data/logs"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"

mkdir -p "$PLIST_DIR" "$LOG_DIR" "$SERVICE_ROOT/data/backups" "$SERVICE_ROOT/data/registry" "$SERVICE_ROOT/data/receipts" "$SERVICE_ROOT/data/quarantine"

if [[ -z "$PYTHON_BIN" ]]; then
  echo "python3 is required" >&2
  exit 1
fi

cd "$SERVICE_ROOT"
if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

chmod +x scripts/run-local.sh scripts/run-checklist-sync.sh scripts/create-full-backup.sh

cat > "$PLIST_DIR/com.tcos.instacomp-ai.service.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tcos.instacomp-ai.service</string>
  <key>ProgramArguments</key><array><string>$SERVICE_ROOT/scripts/run-local.sh</string></array>
  <key>WorkingDirectory</key><string>$SERVICE_ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/service.stdout.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/service.stderr.log</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST

cat > "$PLIST_DIR/com.tcos.instacomp-ai.checklist-sync.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tcos.instacomp-ai.checklist-sync</string>
  <key>ProgramArguments</key><array><string>$SERVICE_ROOT/scripts/run-checklist-sync.sh</string></array>
  <key>WorkingDirectory</key><string>$SERVICE_ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/checklist-sync.stdout.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/checklist-sync.stderr.log</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST

launchctl bootout "gui/$(id -u)/com.tcos.instacomp-ai.service" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.tcos.instacomp-ai.checklist-sync" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DIR/com.tcos.instacomp-ai.service.plist"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DIR/com.tcos.instacomp-ai.checklist-sync.plist"
launchctl kickstart -k "gui/$(id -u)/com.tcos.instacomp-ai.service"
launchctl kickstart -k "gui/$(id -u)/com.tcos.instacomp-ai.checklist-sync"

echo "InstaComp AI installed."
echo "Control panel: http://127.0.0.1:8787/control"
echo "Logs: $LOG_DIR"
echo "Folder: $SERVICE_ROOT"
