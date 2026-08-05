#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The InstaComp AI installer requires macOS." >&2
  exit 2
fi

for command in python3 curl launchctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 3
  fi
done

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
domain="gui/$(id -u)"
launch_agents="$HOME/Library/LaunchAgents"
plist="$launch_agents/${label}.plist"
log_dir="$service_root/data/logs"

mkdir -p "$launch_agents" "$log_dir" "$service_root/backups" "$service_root/data/images"

if [[ ! -f "$service_root/.env" ]]; then
  if [[ -f "$service_root/.env.example" ]]; then
    cp "$service_root/.env.example" "$service_root/.env"
    chmod 600 "$service_root/.env"
    echo "Created $service_root/.env from the safe template. Configure Registry credentials before real scans."
  else
    touch "$service_root/.env"
    chmod 600 "$service_root/.env"
  fi
fi

python3 -m venv "$service_root/.venv"
python_bin="$service_root/.venv/bin/python"
"$python_bin" -m pip install --upgrade pip
"$python_bin" -m pip install -r "$service_root/requirements.txt"

cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$service_root/scripts/run-local.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$service_root</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$log_dir/service.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir/service-error.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
EOF
chmod 600 "$plist"
plutil -lint "$plist" >/dev/null

launchctl bootout "$domain" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$plist"
launchctl kickstart -k "${domain}/${label}"

bash "$service_root/scripts/install-desktop-app.sh"

port="$(cd "$service_root" && "$python_bin" - <<'PY'
from app.config import settings
print(settings.port)
PY
)"
health_url="http://127.0.0.1:${port}/health"
control_url="http://127.0.0.1:${port}/control"
for _ in $(seq 1 60); do
  if curl --silent --fail --max-time 2 "$health_url" >/dev/null 2>&1; then
    echo "InstaComp AI local service is ready: $health_url"
    echo "Open the Desktop app and finish setup at $control_url"
    exit 0
  fi
  sleep 1
done

echo "The LaunchAgent was installed, but the service did not become ready." >&2
echo "Review $log_dir/service-error.log and run the local System Doctor." >&2
exit 1
