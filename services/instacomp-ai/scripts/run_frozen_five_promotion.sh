#!/usr/bin/env bash
set -euo pipefail

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_python="$service_root/.venv/bin/python"
mode="promotion"
target="$service_root/scripts/promote_lora_candidate_frozen_five_v2.py"

# Diagnostics use the exact same protected environment, service Python and app
# import path as promotion. This prevents another split-brain launcher path.
if [[ "${1:-}" == "--diagnostic-all" ]]; then
  mode="diagnostic"
  target="$service_root/scripts/diagnose_lora_frozen_five_all.py"
  shift
fi

[[ -x "$service_python" ]] || {
  echo "InstaComp service Python is missing: $service_python" >&2
  exit 2
}
[[ -f "$target" ]] || {
  echo "Frozen-five ${mode} runner is missing: $target" >&2
  exit 2
}

# Frozen Five must use the same exact dependency pins that passed the immutable
# physical-image macOS gate. Repair an old .venv before any app import or LoRA
# activation so the owner's Mac is never used to discover dependency drift.
bash "$service_root/scripts/ensure-runtime-dependencies.sh" "$service_python"

cd "$service_root"

# The normal launchd service exports this protected file before starting Python
# because Registry/Sentinel clients intentionally read authentication values from
# os.environ. Frozen Five must use the exact same runtime contract; otherwise the
# authoritative Registry request is sent without the Mac's existing credential.
if [[ -f "$service_root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$service_root/.env"
  set +a
fi

export PYTHONPATH="$service_root${PYTHONPATH:+:$PYTHONPATH}"

self_test=0
for arg in "$@"; do
  if [[ "$arg" == "--self-test" ]]; then
    self_test=1
    break
  fi
done

# Never enable the evidence-only LoRA candidate unless the central Registry call
# can authenticate first. Do not print or otherwise expose the credential value.
if [[ -n "${INSTACOMP_AI_REGISTRY_TOKEN:-}" || -n "${INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN:-}" ]]; then
  echo "PASS Registry client authentication configured"
elif [[ "$self_test" == "1" ]]; then
  echo "INFO Registry client authentication not configured for isolated self-test"
else
  echo "Refusing Frozen Five ${mode}: Registry authentication is missing after loading $service_root/.env." >&2
  echo "Candidate runtime was not activated." >&2
  exit 2
fi

"$service_python" - <<'PY'
import importlib.util
from pathlib import Path

spec = importlib.util.find_spec("app")
if spec is None or spec.origin is None:
    raise SystemExit("InstaComp app package is not importable from the service root")
service_root = Path.cwd().resolve()
origin = Path(spec.origin).resolve()
if service_root not in origin.parents:
    raise SystemExit(f"Resolved app package is outside the service root: {origin}")
print(f"PASS InstaComp app import path: {origin}")
PY

echo "PASS Frozen Five launcher mode: $mode"
exec "$service_python" "$target" "$@"
