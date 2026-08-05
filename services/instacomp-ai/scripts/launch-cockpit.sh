#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The InstaComp AI desktop launcher requires macOS." >&2
  exit 2
fi

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="$service_root/.venv/bin/python"
port="8787"
if [[ -x "$python_bin" ]]; then
  port="$(cd "$service_root" && "$python_bin" - <<'PY'
from app.config import settings
print(settings.port)
PY
)"
fi
base_url="http://127.0.0.1:${port}"
health_url="${base_url}/health"
control_url="${base_url}/control"
label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
domain="gui/$(id -u)"
log_dir="$service_root/data/logs"
mkdir -p "$log_dir"

healthy() {
  curl --silent --fail --max-time 2 "$health_url" >/dev/null 2>&1
}

if ! curl --silent --fail --max-time 2 "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  if [[ -d "/Applications/Ollama.app" ]]; then
    open -gja "/Applications/Ollama.app" || true
  elif command -v ollama >/dev/null 2>&1; then
    nohup ollama serve >>"$log_dir/ollama.log" 2>&1 </dev/null &
  fi
fi

if ! healthy; then
  if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
    launchctl kickstart -k "${domain}/${label}" || true
  else
    plist="$HOME/Library/LaunchAgents/${label}.plist"
    if [[ -f "$plist" ]]; then
      launchctl bootstrap "$domain" "$plist" 2>/dev/null || true
      launchctl kickstart -k "${domain}/${label}" || true
    else
      nohup bash "$service_root/scripts/run-local.sh" >>"$log_dir/service.log" 2>&1 </dev/null &
    fi
  fi
fi

for _ in $(seq 1 60); do
  if healthy; then
    open "$control_url"
    exit 0
  fi
  sleep 1
done

message="InstaComp AI did not become ready. Check $log_dir/service.log and run System Doctor."
echo "$message" >&2
osascript -e "display notification \"$message\" with title \"InstaComp AI\"" 2>/dev/null || true
exit 1
