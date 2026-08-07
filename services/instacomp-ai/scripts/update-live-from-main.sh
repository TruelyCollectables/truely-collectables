#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This updater is only allowed on the InstaComp Mac runtime." >&2
  exit 2
fi

for command in git bash curl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
expected_service_root="$repo_root/services/instacomp-ai"

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

before="$(git -C "$repo_root" rev-parse HEAD)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
receipt_dir="$service_root/data/runtime-updates"
backup_dir="$service_root/backups/runtime-source-$timestamp"
mkdir -p "$receipt_dir" "$backup_dir"
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

"$python_bin" -m pytest -q \
  "$service_root/tests/test_ocr_registry_hard_facts.py" \
  "$service_root/tests/test_local_vision.py" \
  "$service_root/tests/test_ollama.py"

fingerprint="$(cd "$service_root" && "$python_bin" - <<'PY'
from app.runtime_identity import runtime_source_fingerprint
print(runtime_source_fingerprint())
PY
)"

port="${INSTACOMP_AI_PORT:-8787}"
health="$(curl --fail --silent --show-error --max-time 20 "http://127.0.0.1:${port}/health")"
HEALTH_JSON="$health" EXPECTED_FINGERPRINT="$fingerprint" UPDATED_COMMIT="$updated" BEFORE_COMMIT="$before" RECEIPT_PATH="$receipt_dir/$timestamp.json" \
  "$python_bin" - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

health = json.loads(os.environ["HEALTH_JSON"])
expected = os.environ["EXPECTED_FINGERPRINT"]
actual = str(health.get("runtime_source_fingerprint") or "")
if health.get("ok") is not True:
    raise SystemExit("Updated Mac health is not ready")
if actual != expected:
    raise SystemExit(f"Runtime fingerprint mismatch: expected {expected}, got {actual or 'missing'}")
receipt = {
    "schema": "tcos.instacomp.macRuntimeUpdate.v1",
    "completedAt": datetime.now(timezone.utc).isoformat(),
    "beforeCommit": os.environ["BEFORE_COMMIT"],
    "updatedCommit": os.environ["UPDATED_COMMIT"],
    "runtimeSourceFingerprint": actual,
    "health": {
        "ok": health.get("ok"),
        "app": health.get("app"),
        "version": health.get("version"),
        "database": health.get("database"),
        "checklist": health.get("checklist"),
        "ollama": health.get("ollama"),
    },
}
path = Path(os.environ["RECEIPT_PATH"])
path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, indent=2))
PY

trap - ERR
echo "InstaComp Mac runtime updated and fingerprint-verified at $updated."
