#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This updater is only allowed on the InstaComp Mac runtime." >&2
  exit 2
fi

for command_name in git bash curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 2
  }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
expected_service_root="$repo_root/services/instacomp-ai"
env_file="$service_root/.env"
site_url="${INSTACOMP_SENTINEL_SITE_URL:-https://truelycollectables.com}"
port="${INSTACOMP_AI_PORT:-8787}"

if [[ -z "$repo_root" || "$service_root" != "$expected_service_root" ]]; then
  echo "Refusing update: InstaComp service is not running from the expected repository layout." >&2
  exit 2
fi

origin="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/TruelyCollectables/truely-collectables|https://github.com/TruelyCollectables/truely-collectables.git|git@github.com:TruelyCollectables/truely-collectables.git) ;;
  *) echo "Refusing update: unexpected Git origin '$origin'." >&2; exit 2 ;;
esac

[[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
  echo "Refusing update: live Mac checkout must be on main." >&2
  exit 2
}

if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing update: tracked working tree changes are present." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi

read_env_value() {
  python3 - "$env_file" "$1" <<'PY'
import json, pathlib, shlex, sys
path, name = pathlib.Path(sys.argv[1]), sys.argv[2]
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
        print(value.strip("\"'"))
    break
PY
}

checkout_before="$(git -C "$repo_root" rev-parse HEAD)"
before="${INSTACOMP_UPDATE_ROLLBACK_COMMIT:-$checkout_before}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
receipt_dir="$service_root/data/runtime-updates"
backup_dir="$service_root/backups/runtime-source-$timestamp"
mkdir -p "$receipt_dir" "$backup_dir"
for file in app/main.py app/local_vision.py app/ollama.py; do
  cp "$service_root/$file" "$backup_dir/$(basename "$file")"
done
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
git -C "$repo_root" merge-base --is-ancestor "$checkout_before" "$remote_main" || {
  echo "Refusing update: local main cannot fast-forward to origin/main." >&2
  exit 2
}
git -C "$repo_root" merge --ff-only origin/main
updated="$(git -C "$repo_root" rev-parse HEAD)"

if [[ "$updated" != "$checkout_before" && "${INSTACOMP_UPDATE_REEXECED:-0}" != "1" ]]; then
  trap - ERR
  echo "Updater fast-forwarded to $updated; restarting from the updated source before verification."
  exec env \
    INSTACOMP_UPDATE_REEXECED=1 \
    INSTACOMP_UPDATE_ROLLBACK_COMMIT="$before" \
    bash "$service_root/scripts/update-live-from-main.sh"
fi

bash "$service_root/scripts/install-macos.sh"
python_bin="$service_root/.venv/bin/python"
[[ -x "$python_bin" ]] || { echo "Updated Python runtime is missing." >&2; exit 2; }
"$python_bin" -m pytest -q "$service_root/tests"

local_key="$(read_env_value INSTACOMP_AI_API_KEY)"
registry_token="$(read_env_value INSTACOMP_AI_REGISTRY_TOKEN)"
archive_token="$(read_env_value INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN)"
[[ "$local_key" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Mac API key is missing or invalid." >&2; exit 2; }
[[ "$registry_token" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Registry token is missing or invalid." >&2; exit 2; }
[[ "$archive_token" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Archive token is missing or invalid." >&2; exit 2; }

retry_json_probe() {
  local label="$1"
  local output_file="$2"
  local attempts="$3"
  local require_reachable="$4"
  shift 4

  local error_file="${output_file}.curl-error"
  local attempt
  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    : > "$error_file"
    if curl -fsS --max-time 30 "$@" > "$output_file" 2> "$error_file" && \
      PROBE_FILE="$output_file" REQUIRE_REACHABLE="$require_reachable" "$python_bin" - <<'PY'
import json, os
payload = json.load(open(os.environ["PROBE_FILE"], encoding="utf-8"))
ok = payload.get("ok") is True
if os.environ.get("REQUIRE_REACHABLE") == "true":
    ok = ok and payload.get("reachable") is True
raise SystemExit(0 if ok else 1)
PY
    then
      rm -f "$error_file"
      return 0
    fi

    if (( attempt < attempts )); then
      sleep 3
      continue
    fi

    echo "$label failed after $attempts attempts." >&2
    if [[ -s "$error_file" ]]; then
      cat "$error_file" >&2
    fi
    rm -f "$error_file"
    return 1
  done
}

health_file="$receipt_dir/$timestamp-local-health.json"
retry_json_probe \
  "Local InstaComp health" \
  "$health_file" \
  20 \
  false \
  "http://127.0.0.1:${port}/health"

readiness_file="$receipt_dir/$timestamp-cloudflare-readiness.json"
retry_json_probe \
  "Cloudflare Production readiness" \
  "$readiness_file" \
  30 \
  true \
  "$site_url/api/instacomp/internal-readiness?ts=$(date +%s)"

registry_probe="$receipt_dir/$timestamp-production-registry.json"
retry_json_probe \
  "Cloudflare Registry credential probe" \
  "$registry_probe" \
  20 \
  false \
  -H 'content-type: application/json' \
  -H "x-tcos-instacomp-service-token: $registry_token" \
  --data '{"cardNumber":"__INSTACOMP_AUTH_PROBE__"}' \
  "$site_url/api/instacomp/checklist-lookup"

sentinel_probe="$receipt_dir/$timestamp-production-sentinel.json"
retry_json_probe \
  "Cloudflare Sentinel credential probe" \
  "$sentinel_probe" \
  20 \
  false \
  -H "x-instacomp-sentinel-archive-token: $archive_token" \
  "$site_url/api/instacomp/checklist-sentinel?view=status&ts=$(date +%s)"

RECEIPT_PATH="$receipt_dir/$timestamp.json" BEFORE="$before" UPDATED="$updated" \
HEALTH_FILE="$health_file" READINESS_FILE="$readiness_file" \
REGISTRY_FILE="$registry_probe" SENTINEL_FILE="$sentinel_probe" "$python_bin" - <<'PY'
import json, os
from datetime import datetime, timezone
from pathlib import Path
health = json.load(open(os.environ["HEALTH_FILE"], encoding="utf-8"))
readiness = json.load(open(os.environ["READINESS_FILE"], encoding="utf-8"))
registry = json.load(open(os.environ["REGISTRY_FILE"], encoding="utf-8"))
sentinel = json.load(open(os.environ["SENTINEL_FILE"], encoding="utf-8"))
assert registry.get("ok") is True, "Cloudflare Registry credential was rejected"
assert sentinel.get("ok") is True, "Cloudflare Sentinel credential was rejected"
receipt = {
    "schema": "tcos.instacomp.macRuntimeUpdate.v3",
    "completedAt": datetime.now(timezone.utc).isoformat(),
    "beforeCommit": os.environ["BEFORE"],
    "updatedCommit": os.environ["UPDATED"],
    "localHealthReady": health.get("ok") is True,
    "cloudflareReadinessReady": readiness.get("ok") is True,
    "registryCredentialAccepted": registry.get("ok") is True,
    "sentinelCredentialAccepted": sentinel.get("ok") is True,
    "secretsIncluded": False,
}
path = Path(os.environ["RECEIPT_PATH"])
path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
path.chmod(0o600)
print(json.dumps(receipt, indent=2))
PY

trap - ERR
echo "InstaComp Mac runtime updated and verified through Cloudflare at $updated."
