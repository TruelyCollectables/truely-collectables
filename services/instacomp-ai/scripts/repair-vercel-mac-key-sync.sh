#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This repair must run on the InstaComp Mac." >&2
  exit 2
fi

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$service_root/../.." && pwd)"
env_file="$service_root/.env"
tunnel_url="${INSTACOMP_AI_REPAIR_TUNNEL_URL:-https://instacomp.truelycollectables.com}"
site_url="${INSTACOMP_AI_REPAIR_SITE_URL:-https://truelycollectables.com}"

for command_name in python3 npx curl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command missing: $command_name" >&2
    exit 2
  }
done

[[ -f "$env_file" ]] || {
  echo "InstaComp local .env was not found: $env_file" >&2
  exit 2
}

local_key="$(python3 - "$env_file" <<'PY'
import json
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
for raw in path.read_text('utf-8').splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key.strip() != 'INSTACOMP_AI_API_KEY':
        continue
    value = value.strip()
    try:
        if value.startswith('"'):
            print(json.loads(value))
        elif value.startswith("'"):
            print(shlex.split(value)[0] if value else '')
        else:
            print(value)
    except Exception:
        print(value.strip('"\''))
    break
PY
)"

if [[ ! "$local_key" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Refusing to rotate or invent a key: the Mac's existing INSTACOMP_AI_API_KEY is missing or not a 256-bit hex secret." >&2
  exit 2
fi

cd "$repo_root"

# Prove the current Mac key works through the permanent tunnel before changing
# Vercel. This keeps the Mac as the authority and avoids replacing a working
# local credential with an unknown remote value.
tmp_status="$(mktemp "${TMPDIR:-/tmp}/instacomp-key-repair.XXXXXX")"
trap 'rm -f "$tmp_status"' EXIT INT TERM
curl -fsS --max-time 30 \
  -H "X-InstaComp-AI-Key: $local_key" \
  "$tunnel_url/v1/deal-hunter/status" \
  > "$tmp_status"
python3 - "$tmp_status" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding='utf-8'))
assert payload.get('mac_evaluation_key_configured') is True, 'Mac API key is not configured.'
print('PASS  Existing Mac key authenticates through the permanent tunnel')
PY

# Synchronize only the website-side copy of the existing Mac key. Do not rotate
# the local key, registry token, archive token, or unrelated service secrets.
printf '%s' "$local_key" | npx vercel env add INSTACOMP_AI_LOCAL_KEY production --force --sensitive >/dev/null
printf 'PASS  Vercel Production INSTACOMP_AI_LOCAL_KEY synchronized from the Mac\n'

# Redeploy so the Production runtime receives the corrected encrypted env value.
npx vercel --prod --yes >/dev/null
printf 'PASS  Production redeployed with synchronized key\n'

# The readiness route uses the Production env and calls the Mac. Health itself is
# public on the Mac, so also require the protected Deal Hunter route through the
# direct tunnel above; together they prove both reachability and authentication.
for ((attempt=1; attempt<=40; attempt++)); do
  code="$(curl -sS -o "$tmp_status" -w '%{http_code}' --max-time 20 "$site_url/api/instacomp/internal-readiness" || true)"
  if [[ "$code" == "200" ]] && python3 - "$tmp_status" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding='utf-8'))
raise SystemExit(0 if payload.get('ok') is True and payload.get('reachable') is True else 1)
PY
  then
    printf 'PASS  Vercel reaches the physical Mac after key synchronization\n'
    printf 'INSTAComp Mac/Vercel shared-key repair: COMPLETE\n'
    exit 0
  fi
  sleep 3
done

echo "Production readiness did not become healthy after key synchronization." >&2
cat "$tmp_status" >&2 || true
exit 1
