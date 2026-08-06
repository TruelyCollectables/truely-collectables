#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer must run on the InstaComp Mac." >&2
  exit 2
fi

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$service_root/../.." && pwd)"
cd "$repo_root"

site_url="${INSTACOMP_SENTINEL_SITE_URL:-https://truelycollectables.com}"
tunnel_name="${INSTACOMP_SENTINEL_TUNNEL_NAME:-instacomp-ai-mac}"
tunnel_hostname="${INSTACOMP_SENTINEL_TUNNEL_HOSTNAME:-instacomp.truelycollectables.com}"
tunnel_url="https://${tunnel_hostname}"
service_label="${INSTACOMP_AI_LAUNCHD_LABEL:-com.truelycollectables.instacomp-ai}"
tunnel_label="${INSTACOMP_SENTINEL_TUNNEL_LABEL:-com.truelycollectables.instacomp-ai-tunnel}"
domain="gui/$(id -u)"
launch_agents="$HOME/Library/LaunchAgents"
cloudflared_dir="$HOME/.cloudflared"
config_file="$cloudflared_dir/instacomp-ai.yml"
tunnel_plist="$launch_agents/${tunnel_label}.plist"
env_file="$service_root/.env"
log_dir="$service_root/data/logs"
receipt_file="$service_root/data/sentinel-install-receipt.json"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/instacomp-sentinel.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM
chmod 700 "$tmp_dir"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
info() { printf '\n=== %s ===\n' "$1"; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required command missing: $1"
  fi
}

for command_name in curl launchctl plutil openssl python3 npx git ps awk sed; do
  require_command "$command_name"
done

if ! command -v cloudflared >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    info "Installing cloudflared"
    brew install cloudflared
  else
    fail "cloudflared is missing and Homebrew is unavailable"
  fi
fi
cloudflared_bin="$(command -v cloudflared)"

mkdir -p "$launch_agents" "$cloudflared_dir" "$log_dir" "$service_root/data"
chmod 700 "$cloudflared_dir"
touch "$env_file"
chmod 600 "$env_file"

read_env_value() {
  python3 - "$1" "$2" <<'PY'
import json
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
name = sys.argv[2]
if not path.is_file():
    raise SystemExit(0)
for raw in path.read_text("utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() != name:
        continue
    value = value.strip()
    try:
        if value.startswith('"'):
            print(json.loads(value))
        elif value.startswith("'"):
            print(shlex.split(value)[0] if value else "")
        else:
            print(value)
    except Exception:
        print(value.strip('"\''))
    break
PY
}

set_local_env() {
  local key="$1"
  local value="$2"
  INSTACOMP_ENV_KEY="$key" INSTACOMP_ENV_VALUE="$value" python3 - "$env_file" <<'PY'
import json
import os
import pathlib
import tempfile

path = pathlib.Path(__import__('sys').argv[1])
key = os.environ["INSTACOMP_ENV_KEY"]
value = os.environ["INSTACOMP_ENV_VALUE"]
lines = path.read_text("utf-8").splitlines() if path.exists() else []
replacement = f"{key}={json.dumps(value)}"
out = []
replaced = False
for line in lines:
    if line.lstrip().startswith(f"{key}="):
        if not replaced:
            out.append(replacement)
            replaced = True
        continue
    out.append(line)
if not replaced:
    if out and out[-1].strip():
        out.append("")
    out.append(replacement)
path.parent.mkdir(parents=True, exist_ok=True)
fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(out).rstrip() + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temp_name, 0o600)
    os.replace(temp_name, path)
finally:
    if os.path.exists(temp_name):
        os.unlink(temp_name)
PY
}

generate_secret() {
  openssl rand -hex 32
}

local_key="$(read_env_value "$env_file" INSTACOMP_AI_API_KEY)"
if [[ -z "$local_key" || ! "$local_key" =~ ^[0-9a-fA-F]{64}$ ]]; then
  local_key="$(generate_secret)"
fi
[[ "$local_key" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Could not create the 256-bit Mac/Vercel shared key"

archive_token="$(read_env_value "$env_file" INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN)"
if [[ -z "$archive_token" || ! "$archive_token" =~ ^[0-9a-fA-F]{64}$ ]]; then
  archive_token="$(generate_secret)"
fi
[[ "$archive_token" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Could not create the 256-bit Sentinel archive token"

set_local_env INSTACOMP_AI_HOST "127.0.0.1"
set_local_env INSTACOMP_AI_PORT "8787"
set_local_env INSTACOMP_AI_API_KEY "$local_key"
set_local_env INSTACOMP_AI_REGISTRY_URL "$site_url"
set_local_env INSTACOMP_AI_SENTINEL_ENABLED "true"
set_local_env INSTACOMP_AI_SENTINEL_INTERVAL_SECONDS "86400"
set_local_env INSTACOMP_AI_SENTINEL_CHECKPOINT_SECONDS "300"
set_local_env INSTACOMP_AI_SENTINEL_STALE_SECONDS "720"
set_local_env INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN "$archive_token"
set_local_env INSTACOMP_AI_SENTINEL_IMPORT_URL "http://sentinel:${archive_token}@127.0.0.1:8787/v1/checklist-sentinel/registry-import-relay"
set_local_env INSTACOMP_AI_SENTINEL_CENTRAL_IMPORT_URL "${site_url}/api/instacomp/checklist-sentinel/import"
pass "Mac environment written atomically"

info "Creating or reusing permanent Cloudflare tunnel"
if [[ ! -f "$cloudflared_dir/cert.pem" ]]; then
  echo "Cloudflare will open one browser authorization page. Approve the truelycollectables.com zone; the installer continues afterward."
  cloudflared tunnel login
fi

list_json="$tmp_dir/tunnels.json"
cloudflared tunnel list --output json > "$list_json"
tunnel_id="$(python3 - "$list_json" "$tunnel_name" <<'PY'
import json
import sys
items = json.load(open(sys.argv[1], encoding="utf-8"))
name = sys.argv[2]
for item in items:
    if item.get("name") == name:
        print(item.get("id") or item.get("uuid") or "")
        break
PY
)"
if [[ -z "$tunnel_id" ]]; then
  cloudflared tunnel create "$tunnel_name" >/dev/null
  cloudflared tunnel list --output json > "$list_json"
  tunnel_id="$(python3 - "$list_json" "$tunnel_name" <<'PY'
import json
import sys
items = json.load(open(sys.argv[1], encoding="utf-8"))
for item in items:
    if item.get("name") == sys.argv[2]:
        print(item.get("id") or item.get("uuid") or "")
        break
PY
)"
fi
[[ -n "$tunnel_id" ]] || fail "Named Cloudflare tunnel could not be resolved"
credentials_file="$cloudflared_dir/${tunnel_id}.json"
if [[ ! -f "$credentials_file" ]]; then
  echo "The named tunnel exists without local credentials. Recreating it safely."
  cloudflared tunnel delete -f "$tunnel_id" >/dev/null 2>&1 || true
  cloudflared tunnel create "$tunnel_name" >/dev/null
  cloudflared tunnel list --output json > "$list_json"
  tunnel_id="$(python3 - "$list_json" "$tunnel_name" <<'PY'
import json
import sys
for item in json.load(open(sys.argv[1], encoding="utf-8")):
    if item.get("name") == sys.argv[2]:
        print(item.get("id") or item.get("uuid") or "")
        break
PY
)"
  credentials_file="$cloudflared_dir/${tunnel_id}.json"
fi
[[ -n "$tunnel_id" && -f "$credentials_file" ]] || fail "Cloudflare tunnel credentials could not be created"

cat > "$config_file" <<EOF
# Managed by InstaComp AI Checklist Sentinel installer.
tunnel: ${tunnel_id}
credentials-file: ${credentials_file}

ingress:
  - hostname: ${tunnel_hostname}
    service: http://127.0.0.1:8787
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
EOF
chmod 600 "$config_file"
cloudflared tunnel --config "$config_file" ingress validate >/dev/null
if ! cloudflared tunnel route dns --overwrite-dns "$tunnel_id" "$tunnel_hostname" >/dev/null 2>&1; then
  cloudflared tunnel route dns "$tunnel_id" "$tunnel_hostname" >/dev/null 2>&1 || true
fi
pass "Named tunnel and DNS route configured"

cat > "$tunnel_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${tunnel_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${cloudflared_bin}</string>
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <string>--config</string>
    <string>${config_file}</string>
    <string>run</string>
    <string>${tunnel_id}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${log_dir}/cloudflared.log</string>
  <key>StandardErrorPath</key>
  <string>${log_dir}/cloudflared-error.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
EOF
chmod 600 "$tunnel_plist"
plutil -lint "$tunnel_plist" >/dev/null

# Stop only the obsolete quick-tunnel process. Never kill a named tunnel.
ps -ww -axo pid=,command= | awk '/[c]loudflared tunnel/ && /--url http:\/\/127\.0\.0\.1:8787/ {print $1}' > "$tmp_dir/quick-pids"
while IFS= read -r pid; do
  [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
done < "$tmp_dir/quick-pids"

launchctl bootout "$domain" "$tunnel_plist" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$tunnel_plist"
launchctl kickstart -k "${domain}/${tunnel_label}"
pass "Cloudflare tunnel LaunchAgent installed"

info "Synchronizing Vercel connection settings"
set_vercel_env() {
  local name="$1"
  local value="$2"
  local environment="$3"
  local sensitivity="$4"
  if [[ "$sensitivity" == "sensitive" ]]; then
    printf '%s' "$value" | npx vercel env add "$name" "$environment" --force --sensitive >/dev/null
  else
    printf '%s' "$value" | npx vercel env add "$name" "$environment" --force >/dev/null
  fi
}
set_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain
set_vercel_env INSTACOMP_AI_LOCAL_KEY "$local_key" production sensitive
set_vercel_env INSTACOMP_SENTINEL_ARCHIVE_TOKEN "$archive_token" production sensitive
pass "Vercel Production tunnel URL and dedicated keys synchronized"

info "Restarting InstaComp AI"
service_plist="$launch_agents/${service_label}.plist"
if [[ ! -f "$service_plist" ]]; then
  bash "$service_root/scripts/install-macos.sh"
else
  launchctl kickstart -k "${domain}/${service_label}"
fi

local_health="http://127.0.0.1:8787/health"
local_status="http://127.0.0.1:8787/v1/checklist-sentinel/status"
for ((attempt=1; attempt<=90; attempt++)); do
  if curl -fsS --max-time 3 "$local_health" >/dev/null 2>&1; then
    break
  fi
  [[ "$attempt" -lt 90 ]] || fail "InstaComp AI did not become healthy; inspect $log_dir/service-error.log"
  sleep 1
done
local_status_json="$tmp_dir/local-status.json"
curl -fsS --max-time 15 -H "X-InstaComp-AI-Key: $local_key" "$local_status" > "$local_status_json"
python3 - "$local_status_json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status.get("enabled") is True, "Sentinel is disabled"
assert status.get("schedule_seconds") == 86400, "Sentinel is not on a 24-hour schedule"
assert status.get("checkpoint_seconds") == 300, "Sentinel checkpoint is not five minutes"
assert status.get("registry_import_configured") is True, "Central archive relay is not configured"
assert status.get("freeze_protection", {}).get("stale") is False, "Sentinel heartbeat is stale"
PY
pass "Local service, scheduler, archive relay, and freeze protection healthy"

info "Deploying website Production"
npx vercel --prod --yes

info "Verifying every network hop"
for ((attempt=1; attempt<=60; attempt++)); do
  if curl -fsS --max-time 10 -H "X-InstaComp-AI-Key: $local_key" "${tunnel_url}/v1/checklist-sentinel/status" > "$tmp_dir/tunnel-status.json" 2>/dev/null; then
    break
  fi
  [[ "$attempt" -lt 60 ]] || fail "Permanent Cloudflare tunnel could not reach the Mac"
  sleep 2
done
pass "Permanent Cloudflare tunnel reaches Sentinel"

readiness_url="${site_url}/api/instacomp/internal-readiness?ts=$(date +%s)"
for ((attempt=1; attempt<=30; attempt++)); do
  if curl -fsS --max-time 30 "$readiness_url" > "$tmp_dir/readiness.json" 2>/dev/null && \
    python3 - "$tmp_dir/readiness.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
raise SystemExit(0 if payload.get("ok") is True and payload.get("reachable") is True else 1)
PY
  then
    break
  fi
  [[ "$attempt" -lt 30 ]] || fail "Vercel cannot reach the Mac through the permanent tunnel"
  sleep 3
done
pass "Vercel reaches the Mac"

archive_probe_url="${site_url}/api/instacomp/checklist-sentinel/import"
curl -fsS --max-time 60 \
  -H "x-instacomp-sentinel-archive-token: $archive_token" \
  "$archive_probe_url" > "$tmp_dir/archive-probe.json"
python3 - "$tmp_dir/archive-probe.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True, payload.get("error") or "Archive probe failed"
assert payload.get("archiveReady") is True, "Private archive is not writable"
assert payload.get("public") is False, "Sentinel archive must be private"
assert payload.get("probeRemoved") is True, "Archive health probe was not cleaned up"
PY
pass "Private central archive is writable and cleanup-safe"

proxy_status_url="${site_url}/api/instacomp/checklist-sentinel?view=status"
curl -fsS --max-time 60 \
  -H "x-instacomp-sentinel-archive-token: $archive_token" \
  "$proxy_status_url" > "$tmp_dir/proxy-status.json"
python3 - "$tmp_dir/proxy-status.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True, payload.get("error") or "Website Sentinel proxy failed"
data = payload.get("data") or {}
assert data.get("name") == "InstaComp AI Checklist Sentinel™", "Website proxy returned the wrong service"
assert data.get("freeze_protection", {}).get("stale") is False, "Website received a stale Sentinel heartbeat"
PY
pass "Website admin proxy reaches live Sentinel"

dashboard_url="${site_url}/admin/instacomp/checklist-sentinel"
dashboard_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$dashboard_url")"
case "$dashboard_code" in
  200|301|302|303|307|308) pass "Checklist Sentinel dashboard route exists" ;;
  *) fail "Checklist Sentinel dashboard returned HTTP $dashboard_code" ;;
esac

INSTACOMP_RECEIPT_PATH="$receipt_file" \
INSTACOMP_RECEIPT_TUNNEL_ID="$tunnel_id" \
INSTACOMP_RECEIPT_TUNNEL_HOST="$tunnel_hostname" \
INSTACOMP_RECEIPT_DASHBOARD="${site_url}/admin/instacomp/checklist-sentinel" \
python3 - "$local_status_json" <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path
status = json.load(open(__import__('sys').argv[1], encoding="utf-8"))
receipt = {
    "schemaVersion": "instacomp.sentinel.install-receipt.v1",
    "ok": True,
    "installedAt": datetime.now(timezone.utc).isoformat(),
    "tunnelId": os.environ["INSTACOMP_RECEIPT_TUNNEL_ID"],
    "tunnelHostname": os.environ["INSTACOMP_RECEIPT_TUNNEL_HOST"],
    "dashboard": os.environ["INSTACOMP_RECEIPT_DASHBOARD"],
    "scheduleHours": status.get("schedule_hours"),
    "checkpointSeconds": status.get("checkpoint_seconds"),
    "registryArchiveConfigured": status.get("registry_import_configured"),
    "freezeProtection": status.get("freeze_protection"),
    "secretsIncluded": False,
}
path = Path(os.environ["INSTACOMP_RECEIPT_PATH"])
path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
path.chmod(0o600)
PY

printf '\n===============================================\n'
printf 'INSTAComp AI Checklist Sentinel™: READY\n'
printf 'Dashboard: %s/admin/instacomp/checklist-sentinel\n' "$site_url"
printf 'Mac service: automatic at login/reboot\n'
printf 'Tunnel: permanent named Cloudflare tunnel\n'
printf 'Schedule: every 24 hours\n'
printf 'Checkpoint: every 5 minutes\n'
printf 'Central source archive: enabled and SHA-verified\n'
printf '===============================================\n'
