#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$SERVICE_ROOT/data/logs"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"
USER_DOMAIN="gui/$(id -u)"
SERVICE_PLIST="$PLIST_DIR/com.tcos.instacomp-ai.service.plist"
SYNC_PLIST="$PLIST_DIR/com.tcos.instacomp-ai.checklist-sync.plist"

mkdir -p \
  "$PLIST_DIR" \
  "$LOG_DIR" \
  "$SERVICE_ROOT/backups" \
  "$SERVICE_ROOT/data/checklists/mirror" \
  "$SERVICE_ROOT/data/images" \
  "$SERVICE_ROOT/data/registry" \
  "$SERVICE_ROOT/data/receipts" \
  "$SERVICE_ROOT/data/quarantine"

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
  chmod 600 .env
  echo "Created $SERVICE_ROOT/.env. Configure the Google Drive source and backup paths before the first live mission."
fi

chmod +x \
  scripts/run-local.sh \
  scripts/run-checklist-sync.sh \
  scripts/create-full-backup.sh \
  scripts/launch-cockpit.sh \
  scripts/install-desktop-app.sh

cat > "$SERVICE_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tcos.instacomp-ai.service</string>
  <key>ProgramArguments</key><array><string>$SERVICE_ROOT/scripts/run-local.sh</string></array>
  <key>WorkingDirectory</key><string>$SERVICE_ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/service.stdout.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/service.stderr.log</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST

cat > "$SYNC_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tcos.instacomp-ai.checklist-sync</string>
  <key>ProgramArguments</key><array><string>$SERVICE_ROOT/scripts/run-checklist-sync.sh</string></array>
  <key>WorkingDirectory</key><string>$SERVICE_ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/checklist-sync.stdout.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/checklist-sync.stderr.log</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST

/usr/bin/plutil -lint "$SERVICE_PLIST" >/dev/null
/usr/bin/plutil -lint "$SYNC_PLIST" >/dev/null

/bin/launchctl bootout "$USER_DOMAIN/com.tcos.instacomp-ai.service" 2>/dev/null || true
/bin/launchctl bootout "$USER_DOMAIN/com.tcos.instacomp-ai.checklist-sync" 2>/dev/null || true
/bin/launchctl bootstrap "$USER_DOMAIN" "$SERVICE_PLIST"
/bin/launchctl bootstrap "$USER_DOMAIN" "$SYNC_PLIST"
/bin/launchctl kickstart -k "$USER_DOMAIN/com.tcos.instacomp-ai.service"
/bin/launchctl kickstart -k "$USER_DOMAIN/com.tcos.instacomp-ai.checklist-sync" || true

"$SERVICE_ROOT/scripts/install-desktop-app.sh"

service_ready=false
for _ in $(/usr/bin/seq 1 60); do
  if /usr/bin/curl --fail --silent --max-time 2 http://127.0.0.1:8787/health >/dev/null 2>&1; then
    service_ready=true
    break
  fi
  /bin/sleep 0.5
done

echo
echo "InstaComp AI Mac installation completed."
echo "Protected system folder: $SERVICE_ROOT"
echo "Desktop launcher: $HOME/Desktop/InstaComp AI.app"
echo "Command cockpit: http://127.0.0.1:8787/control"
echo "Logs: $LOG_DIR"
if [[ "$service_ready" == true ]]; then
  echo "Local service status: READY"
else
  echo "Local service status: NOT READY — inspect $LOG_DIR/service.stderr.log" >&2
fi
