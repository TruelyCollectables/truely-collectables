#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "LoRA candidate activation is only allowed on the InstaComp Mac runtime." >&2
  exit 2
fi

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
[[ "$service_root" == "$repo_root/services/instacomp-ai" ]] || {
  echo "Refusing activation outside the expected repository layout." >&2
  exit 2
}
[[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
  echo "Refusing activation: the live Mac checkout must be on main." >&2
  exit 2
}
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing activation with tracked working-tree changes." >&2
  exit 2
fi

adapter_input="${1:-}"
if [[ -z "$adapter_input" ]]; then
  echo "Usage: $0 <validated-adapter-directory>" >&2
  exit 2
fi
adapter="$(cd "$(dirname "$adapter_input")" 2>/dev/null && pwd)/$(basename "$adapter_input")"
[[ -d "$adapter" ]] || {
  echo "Validated adapter directory was not found: $adapter" >&2
  exit 2
}

service_python="$service_root/.venv/bin/python"
[[ -x "$service_python" ]] || {
  echo "InstaComp service virtual environment is missing. Run scripts/install-macos.sh first." >&2
  exit 2
}

lora_python="$service_root/.venv-lora/bin/python"
if [[ ! -x "$lora_python" ]]; then
  echo "Creating isolated LoRA runtime..."
  "$service_python" -m venv "$service_root/.venv-lora"
  lora_python="$service_root/.venv-lora/bin/python"
fi
runtime_version="$($lora_python - <<'PY' 2>/dev/null || true
from importlib.metadata import version
print(version("mlx-vlm"))
PY
)"
if [[ "$runtime_version" != "0.6.8" ]]; then
  echo "Installing certified isolated MLX-VLM 0.6.8 runtime..."
  "$lora_python" -m pip install --upgrade -r "$service_root/requirements-lora-runtime.txt"
fi

preflight="$($lora_python "$service_root/scripts/run_lora_candidate_server.py" --adapter "$adapter" --preflight-only)"
printf '%s\n' "$preflight"

port="${INSTACOMP_AI_LORA_CANDIDATE_PORT:-8791}"
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1024 && "$port" -le 65535 ]] || {
  echo "Invalid candidate port: $port" >&2
  exit 2
}
url="http://127.0.0.1:${port}"
env_file="$service_root/.env"
mkdir -p "$service_root/data/logs" "$service_root/data/lora-candidate"
touch "$env_file"
chmod 600 "$env_file"

"$service_python" - "$env_file" "$adapter" "$url" "$port" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
updates = {
    "INSTACOMP_AI_LORA_CANDIDATE_ENABLED": "true",
    "INSTACOMP_AI_LORA_CANDIDATE_ADAPTER_PATH": sys.argv[2],
    "INSTACOMP_AI_LORA_CANDIDATE_URL": sys.argv[3],
    "INSTACOMP_AI_LORA_CANDIDATE_PORT": sys.argv[4],
}
lines = path.read_text("utf-8").splitlines() if path.is_file() else []
seen = set()
out = []
for raw in lines:
    stripped = raw.strip()
    key = stripped.split("=", 1)[0].strip() if "=" in stripped and not stripped.startswith("#") else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(raw)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
PY
chmod 600 "$env_file"

label="com.truelycollectables.instacomp-ai-lora-candidate"
domain="gui/$(id -u)"
launch_agents="$HOME/Library/LaunchAgents"
plist="$launch_agents/${label}.plist"
mkdir -p "$launch_agents"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$lora_python</string>
    <string>$service_root/scripts/run_lora_candidate_server.py</string>
    <string>--adapter</string><string>$adapter</string>
    <string>--port</string><string>$port</string>
  </array>
  <key>WorkingDirectory</key><string>$service_root</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$service_root/data/logs/lora-candidate.log</string>
  <key>StandardErrorPath</key><string>$service_root/data/logs/lora-candidate-error.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF
chmod 600 "$plist"
plutil -lint "$plist" >/dev/null
launchctl bootout "$domain" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$plist"
launchctl kickstart -k "$domain/$label"

sidecar_health=""
for _ in $(seq 1 120); do
  if sidecar_health="$(curl --silent --fail --max-time 2 "$url/health" 2>/dev/null)"; then
    break
  fi
  sleep 1
done
[[ -n "$sidecar_health" ]] || {
  echo "LoRA candidate sidecar did not become ready. See data/logs/lora-candidate-error.log." >&2
  exit 2
}

main_label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
if launchctl print "$domain/$main_label" >/dev/null 2>&1; then
  launchctl kickstart -k "$domain/$main_label"
else
  bash "$service_root/scripts/install-macos.sh"
fi

main_port="$($service_python - <<'PY'
from app.config import settings
print(settings.port)
PY
)"
main_health=""
for _ in $(seq 1 90); do
  if main_health="$(curl --silent --fail --max-time 2 "http://127.0.0.1:${main_port}/health" 2>/dev/null)"; then
    break
  fi
  sleep 1
done
[[ -n "$main_health" ]] || {
  echo "InstaComp main service did not become ready after candidate activation." >&2
  exit 2
}

receipt="$service_root/data/lora-candidate/activation-$(date -u +%Y%m%dT%H%M%SZ).json"
PREFLIGHT_JSON="$preflight" SIDECAR_HEALTH_JSON="$sidecar_health" MAIN_HEALTH_JSON="$main_health" RECEIPT="$receipt" ADAPTER="$adapter" COMMIT="$(git -C "$repo_root" rev-parse HEAD)" \
  "$service_python" - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

preflight = json.loads(os.environ["PREFLIGHT_JSON"])
sidecar = json.loads(os.environ["SIDECAR_HEALTH_JSON"])
main = json.loads(os.environ["MAIN_HEALTH_JSON"])
if preflight.get("promotion_candidate") is not True or preflight.get("automatic_promotion") is not False:
    raise SystemExit("candidate preflight was not promotion-eligible")
if sidecar.get("ok") is not True or sidecar.get("validation_eligible") is not True:
    raise SystemExit("candidate sidecar health is not eligible")
if main.get("ok") is not True:
    raise SystemExit("main InstaComp health is not ready")
receipt = {
    "schema_version": "tcos.instacomp-ai.lora-candidate-activation.v1",
    "activated_at": datetime.now(timezone.utc).isoformat(),
    "commit": os.environ["COMMIT"],
    "adapter": os.environ["ADAPTER"],
    "adapter_weights_sha256": preflight.get("adapter_weights_sha256"),
    "validation_receipt": preflight.get("validation_receipt"),
    "validation_eligible": True,
    "runtime_candidate_enabled": True,
    "registry_remains_identity_authority": True,
    "automatic_promotion": False,
    "nothing_published": True,
}
path = Path(os.environ["RECEIPT"])
path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, indent=2))
PY

echo "LoRA candidate is enabled as evidence-only. Roll back with: bash services/instacomp-ai/scripts/disable-lora-candidate-macos.sh"
