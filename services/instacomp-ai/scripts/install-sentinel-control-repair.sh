#!/usr/bin/env bash
set -euo pipefail

parse_tunnel_id() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

path, wanted_name = sys.argv[1:3]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)

if payload is None:
    items = []
elif isinstance(payload, list):
    items = payload
elif isinstance(payload, dict):
    if isinstance(payload.get("result"), list):
        items = payload["result"]
    elif isinstance(payload.get("tunnels"), list):
        items = payload["tunnels"]
    elif payload.get("name") or payload.get("id") or payload.get("uuid"):
        items = [payload]
    else:
        items = []
else:
    items = []

for item in items:
    if not isinstance(item, dict):
        continue
    if str(item.get("name") or "") == wanted_name:
        print(item.get("id") or item.get("uuid") or "")
        break
PY
}

if [[ "${1:-}" == "--self-test" ]]; then
  test_dir="$(mktemp -d "${TMPDIR:-/tmp}/instacomp-tunnel-parser.XXXXXX")"
  trap 'rm -rf "$test_dir"' EXIT
  printf 'null\n' > "$test_dir/null.json"
  printf '[{"id":"abc","name":"instacomp-ai-mac"}]\n' > "$test_dir/list.json"
  printf '{"result":[{"uuid":"def","name":"instacomp-ai-mac"}]}\n' > "$test_dir/wrapped.json"
  [[ -z "$(parse_tunnel_id "$test_dir/null.json" instacomp-ai-mac)" ]]
  [[ "$(parse_tunnel_id "$test_dir/list.json" instacomp-ai-mac)" == "abc" ]]
  [[ "$(parse_tunnel_id "$test_dir/wrapped.json" instacomp-ai-mac)" == "def" ]]
  echo "Cloudflare tunnel parser self-test passed"
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This repair must run on the InstaComp Mac." >&2
  exit 2
fi

for command_name in cloudflared python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command missing: $command_name" >&2
    exit 3
  fi
done

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installer="$service_root/scripts/install-sentinel-control.sh"
tunnel_name="${INSTACOMP_SENTINEL_TUNNEL_NAME:-instacomp-ai-mac}"
cloudflared_dir="$HOME/.cloudflared"

[[ -f "$installer" ]] || {
  echo "Sentinel installer not found: $installer" >&2
  exit 4
}

mkdir -p "$cloudflared_dir"
chmod 700 "$cloudflared_dir"

if [[ ! -f "$cloudflared_dir/cert.pem" ]]; then
  echo "Cloudflare authorization is required once. Approve the truelycollectables.com zone in the browser."
  cloudflared tunnel login
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/instacomp-sentinel-repair.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
list_json="$tmp_dir/tunnels.json"

list_tunnels() {
  cloudflared tunnel list --output json > "$list_json"
}

list_tunnels
tunnel_id="$(parse_tunnel_id "$list_json" "$tunnel_name")"

if [[ -z "$tunnel_id" ]]; then
  echo "No named tunnel exists yet; creating $tunnel_name."
  cloudflared tunnel create "$tunnel_name"
  list_tunnels
  tunnel_id="$(parse_tunnel_id "$list_json" "$tunnel_name")"
fi

if [[ -z "$tunnel_id" ]]; then
  echo "Cloudflare created no resolvable tunnel ID. Raw JSON follows:" >&2
  cat "$list_json" >&2
  exit 5
fi

credentials_file="$cloudflared_dir/${tunnel_id}.json"
if [[ ! -f "$credentials_file" ]]; then
  echo "Tunnel $tunnel_id exists without local credentials; recreating it on this Mac."
  cloudflared tunnel delete -f "$tunnel_id" >/dev/null 2>&1 || true
  cloudflared tunnel create "$tunnel_name"
  list_tunnels
  tunnel_id="$(parse_tunnel_id "$list_json" "$tunnel_name")"
  credentials_file="$cloudflared_dir/${tunnel_id}.json"
fi

[[ -n "$tunnel_id" && -f "$credentials_file" ]] || {
  echo "Cloudflare tunnel credentials were not created." >&2
  exit 6
}

echo "Cloudflare tunnel parser repaired; continuing the audited installer."
exec bash "$installer"
