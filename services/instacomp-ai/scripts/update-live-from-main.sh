#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This updater is only allowed on the InstaComp Mac runtime." >&2
  exit 2
fi

for command in git bash curl python3 npx; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
expected_service_root="$repo_root/services/instacomp-ai"
env_file="$service_root/.env"
site_url="${INSTACOMP_SENTINEL_SITE_URL:-https://truelycollectables.com}"
tunnel_hostname="${INSTACOMP_SENTINEL_TUNNEL_HOSTNAME:-instacomp.truelycollectables.com}"
tunnel_url="https://${tunnel_hostname}"

if [[ -z "$repo_root" || "$service_root" != "$expected_service_root" ]]; then
  echo "Refusing update: InstaComp service is not running from the expected repository layout." >&2
  exit 2
fi

origin="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/TruelyCollectables/truely-collectables|https://github.com/TruelyCollectables/truely-collectables.git|git@github.com:TruelyCollectables/truely-collectables.git)
    ;;
  *)
    echo "Refusing update: unexpected Git origin '$origin'." >&2
    exit 2
    ;;
esac

branch="$(git -C "$repo_root" branch --show-current)"
if [[ "$branch" != "main" ]]; then
  echo "Refusing update: live Mac checkout must be on main, found '$branch'." >&2
  exit 2
fi

if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing update: tracked working tree changes are present. No files were changed." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi

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

repair_vercel_root_directory() {
  local project_link="$repo_root/.vercel/project.json"
  local project_id=""
  local org_id=""
  local project_before="$receipt_dir/$timestamp-vercel-project-before.json"
  local project_after="$receipt_dir/$timestamp-vercel-project-after.json"
  local endpoint=""

  [[ -f "$project_link" ]] || {
    echo "Refusing Vercel root repair: $project_link is missing. Run 'npx vercel link' from the repository root first." >&2
    return 2
  }

  read -r project_id org_id < <(
    python3 - "$project_link" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = json.loads(path.read_text("utf-8"))
project_id = str(payload.get("projectId") or "").strip()
org_id = str(payload.get("orgId") or "").strip()
if not project_id or not org_id:
    raise SystemExit(2)
print(project_id, org_id)
PY
  )

  [[ "$project_id" == prj_* && ( "$org_id" == team_* || "$org_id" == user_* ) ]] || {
    echo "Refusing Vercel root repair: linked project identifiers are missing or malformed." >&2
    return 2
  }

  endpoint="/v9/projects/${project_id}?teamId=${org_id}"
  npx vercel api "$endpoint" > "$project_before"

  local root_check_status=0
  ROOT_CHECK_FILE="$project_before" python3 - <<'PY' || root_check_status=$?
import json
import os
import pathlib

payload = json.loads(pathlib.Path(os.environ["ROOT_CHECK_FILE"]).read_text("utf-8"))
root = payload.get("rootDirectory")
if root in (None, ""):
    raise SystemExit(0)
text = str(root).strip()
if text in {".", "./"} or text.rstrip("/") in {".", "./"}:
    raise SystemExit(10)
raise SystemExit(20)
PY
  case "$root_check_status" in
    0)
      echo "PASS  Vercel Root Directory already points at the repository root."
      return 0
      ;;
    10)
      echo "Repairing invalid Vercel Root Directory './' to the supported empty repository root."
      ;;
    *)
      echo "Refusing automatic Vercel root repair: Root Directory is not an empty root or the known './' misconfiguration." >&2
      return 2
      ;;
  esac

  npx vercel api "$endpoint" -X PATCH -F rootDirectory= > "$project_after"
  ROOT_CHECK_FILE="$project_after" python3 - <<'PY'
import json
import os
import pathlib

payload = json.loads(pathlib.Path(os.environ["ROOT_CHECK_FILE"]).read_text("utf-8"))
root = payload.get("rootDirectory")
if root not in (None, ""):
    raise SystemExit(f"Vercel Root Directory repair did not clear the invalid value: {root!r}")
PY
  echo "PASS  Vercel Root Directory repaired to repository root."
}

before="$(git -C "$repo_root" rev-parse HEAD)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
receipt_dir="$service_root/data/runtime-updates"
backup_dir="$service_root/backups/runtime-source-$timestamp"
mkdir -p "$receipt_dir" "$backup_dir"
cp "$service_root/app/main.py" "$backup_dir/main.py"
cp "$service_root/app/local_vision.py" "$backup_dir/local_vision.py"
cp "$service_root/app/ollama.py" "$backup_dir/ollama.py"
printf '%s\n' "$before" > "$backup_dir/before-commit.txt"

rollback() {
  local status=$?
  trap - ERR
  echo "Update failed; restoring previous tracked runtime $before." >&2
  git -C "$repo_root" reset --hard "$before" >/dev/null 2>&1 || true
  bash "$service_root/scripts/install-macos.sh" >/dev/null 2>&1 || true
  exit "$status"
}
trap rollback ERR

git -C "$repo_root" fetch --prune origin main
remote_main="$(git -C "$repo_root" rev-parse origin/main)"
if ! git -C "$repo_root" merge-base --is-ancestor "$before" "$remote_main"; then
  echo "Refusing update: local main cannot fast-forward to origin/main." >&2
  exit 2
fi

git -C "$repo_root" merge --ff-only origin/main
updated="$(git -C "$repo_root" rev-parse HEAD)"

bash "$service_root/scripts/install-macos.sh"

python_bin="$service_root/.venv/bin/python"
if [[ ! -x "$python_bin" ]]; then
  echo "Updated service did not produce an executable Python runtime." >&2
  exit 2
fi

"$python_bin" -m pytest -q "$service_root/tests"

local_key="$(read_env_value "$env_file" INSTACOMP_AI_API_KEY)"
registry_token="$(read_env_value "$env_file" INSTACOMP_AI_REGISTRY_TOKEN)"
archive_token="$(read_env_value "$env_file" INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN)"
if [[ ! "$local_key" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Refusing key repair: INSTACOMP_AI_API_KEY is missing or is not a 256-bit hex key. Run install-sentinel-control.sh once to create it safely." >&2
  exit 2
fi
if [[ ! "$registry_token" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Refusing Registry auth repair: INSTACOMP_AI_REGISTRY_TOKEN is missing or is not a 256-bit hex key." >&2
  exit 2
fi
if [[ ! "$archive_token" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Refusing key repair: INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN is missing or invalid. Run install-sentinel-control.sh once to create it safely." >&2
  exit 2
fi

fingerprint="$(cd "$service_root" && "$python_bin" - <<'PY'
from app.runtime_identity import runtime_source_fingerprint
print(runtime_source_fingerprint())
PY
)"

port="${INSTACOMP_AI_PORT:-8787}"
health="$(curl --fail --silent --show-error --max-time 20 "http://127.0.0.1:${port}/health")"
runtime_identity="$(curl --fail --silent --show-error --max-time 20 "http://127.0.0.1:${port}/v1/runtime-identity")"
local_sentinel_status="$(curl --fail --silent --show-error --max-time 20 -H "X-InstaComp-AI-Key: $local_key" "http://127.0.0.1:${port}/v1/checklist-sentinel/status")"
HEALTH_JSON="$health" RUNTIME_IDENTITY_JSON="$runtime_identity" SENTINEL_STATUS_JSON="$local_sentinel_status" EXPECTED_FINGERPRINT="$fingerprint" UPDATED_COMMIT="$updated" BEFORE_COMMIT="$before" RECEIPT_PATH="$receipt_dir/$timestamp.json" \
  "$python_bin" - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

health = json.loads(os.environ["HEALTH_JSON"])
runtime_identity = json.loads(os.environ["RUNTIME_IDENTITY_JSON"])
sentinel_status = json.loads(os.environ["SENTINEL_STATUS_JSON"])
expected = os.environ["EXPECTED_FINGERPRINT"]
actual = str(runtime_identity.get("runtime_source_fingerprint") or "")
if health.get("ok") is not True:
    raise SystemExit("Updated Mac health is not ready")
if actual != expected:
    raise SystemExit(f"Runtime fingerprint mismatch: expected {expected}, got {actual or 'missing'}")
if sentinel_status.get("name") != "InstaComp AI Checklist Sentinel™":
    raise SystemExit("Local Sentinel rejected the configured InstaComp AI key")
receipt = {
    "schema": "tcos.instacomp.macRuntimeUpdate.v2",
    "completedAt": datetime.now(timezone.utc).isoformat(),
    "beforeCommit": os.environ["BEFORE_COMMIT"],
    "updatedCommit": os.environ["UPDATED_COMMIT"],
    "runtimeSourceFingerprint": actual,
    "runtimeIdentity": runtime_identity,
    "health": {
        "ok": health.get("ok"),
        "app": health.get("app"),
        "version": health.get("version"),
        "database": health.get("database"),
        "checklist": health.get("checklist"),
        "ollama": health.get("ollama"),
    },
    "sentinelKeyAcceptedLocally": True,
    "sentinelKeyAcceptedThroughProduction": False,
}
path = Path(os.environ["RECEIPT_PATH"])
path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, indent=2))
PY

echo "Synchronizing the existing Mac key to Vercel Production without rotating it."
set_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain
set_vercel_env INSTACOMP_AI_LOCAL_KEY "$local_key" production sensitive
set_vercel_env INSTACOMP_SERVICE_TOKEN "$registry_token" production sensitive
set_vercel_env INSTACOMP_SENTINEL_ARCHIVE_TOKEN "$archive_token" production sensitive

sync_optional_teacher_env() {
  local name="$1"
  local value=""
  value="$(read_env_value "$env_file" "$name")"
  if [[ -z "$value" ]]; then
    return 0
  fi
  set_vercel_env "$name" "$value" production sensitive
  echo "PASS  Synced configured teacher credential $name to Vercel Production."
}

for teacher_env in \
  GEMINI_API_KEY \
  GOOGLE_GEMINI_API_KEY \
  ANTHROPIC_API_KEY \
  XAI_API_KEY \
  GROQ_API_KEY \
  PERPLEXITY_API_KEY \
  OPENAI_API_KEY
do
  sync_optional_teacher_env "$teacher_env"
done

repair_vercel_root_directory
npx vercel --prod --yes --cwd "$repo_root"

registry_probe_file="$service_root/data/runtime-updates/$timestamp-production-registry.json"
registry_probe_url="${site_url}/api/instacomp/checklist-lookup"
for ((attempt=1; attempt<=30; attempt++)); do
  if curl --fail --silent --show-error --max-time 30 \
    -H "content-type: application/json" \
    -H "x-tcos-instacomp-service-token: $registry_token" \
    --data '{"cardNumber":"__INSTACOMP_AUTH_PROBE__"}' \
    "$registry_probe_url" > "$registry_probe_file" 2>/dev/null && \
    REGISTRY_PROBE_FILE="$registry_probe_file" "$python_bin" - <<'PY'
import json
import os
from pathlib import Path

payload = json.loads(Path(os.environ["REGISTRY_PROBE_FILE"]).read_text("utf-8"))
if payload.get("ok") is not True:
    raise SystemExit(1)
PY
  then
    break
  fi
  [[ "$attempt" -lt 30 ]] || {
    echo "Production Registry rejected the preserved Mac Registry credential." >&2
    exit 2
  }
  sleep 3
done
echo "PASS  Permanent Mac Registry credential accepted through Production."

proxy_status_file="$service_root/data/runtime-updates/$timestamp-production-sentinel.json"
proxy_status_url="${site_url}/api/instacomp/checklist-sentinel?view=status&ts=$(date +%s)"
for ((attempt=1; attempt<=30; attempt++)); do
  if curl --fail --silent --show-error --max-time 30 \
    -H "x-instacomp-sentinel-archive-token: $archive_token" \
    "$proxy_status_url" > "$proxy_status_file" 2>/dev/null && \
    PROXY_STATUS_FILE="$proxy_status_file" RECEIPT_PATH="$receipt_dir/$timestamp.json" "$python_bin" - <<'PY'
import json
import os
from pathlib import Path

proxy_path = Path(os.environ["PROXY_STATUS_FILE"])
receipt_path = Path(os.environ["RECEIPT_PATH"])
payload = json.loads(proxy_path.read_text("utf-8"))
data = payload.get("data") if isinstance(payload, dict) else None
if payload.get("ok") is not True or not isinstance(data, dict):
    raise SystemExit(1)
if data.get("name") != "InstaComp AI Checklist Sentinel™":
    raise SystemExit(1)
receipt = json.loads(receipt_path.read_text("utf-8"))
receipt["sentinelKeyAcceptedThroughProduction"] = True
receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
PY
  then
    break
  fi
  [[ "$attempt" -lt 30 ]] || {
    echo "Production still cannot authenticate to the Mac with the synchronized InstaComp AI key." >&2
    exit 2
  }
  sleep 3
done

echo "PASS  Mac key accepted locally and through the Production Sentinel proxy."

trap - ERR
echo "InstaComp Mac runtime updated, key-synchronized, and fingerprint-verified at $updated."
