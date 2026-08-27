#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "LoRA candidate rollback is only allowed on macOS." >&2
  exit 2
fi
service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$service_root/.env"
service_python="$service_root/.venv/bin/python"
[[ -x "$service_python" ]] || service_python="$(command -v python3)"

if [[ -f "$env_file" ]]; then
  "$service_python" - "$env_file" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text("utf-8").splitlines()
out = []
found = False
for raw in lines:
    stripped = raw.strip()
    if stripped.startswith("INSTACOMP_AI_LORA_CANDIDATE_ENABLED="):
        out.append("INSTACOMP_AI_LORA_CANDIDATE_ENABLED=false")
        found = True
    else:
        out.append(raw)
if not found:
    out.append("INSTACOMP_AI_LORA_CANDIDATE_ENABLED=false")
path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
PY
  chmod 600 "$env_file"
fi

label="com.truelycollectables.instacomp-ai-lora-candidate"
domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/${label}.plist"
launchctl bootout "$domain" "$plist" >/dev/null 2>&1 || true
rm -f "$plist"

main_label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
if launchctl print "$domain/$main_label" >/dev/null 2>&1; then
  launchctl kickstart -k "$domain/$main_label"
fi

echo "LoRA runtime candidate disabled. Existing adapter files, trusted lessons, images, Registry data, and inventory were not changed."
