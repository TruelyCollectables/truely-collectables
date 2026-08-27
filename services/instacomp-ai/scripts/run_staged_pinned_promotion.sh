#!/usr/bin/env bash
set -euo pipefail

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_python="$service_root/.venv/bin/python"
target="$service_root/scripts/promote_lora_candidate_frozen_25_v20.py"
visual_memory_repair="$service_root/scripts/repair_trusted_visual_memory.py"
pinned_visual_memory_repair="$service_root/scripts/repair_pinned_visual_memory_v15.py"

[[ -x "$service_python" ]] || {
  echo "InstaComp service Python is missing: $service_python" >&2
  exit 2
}
[[ -f "$target" ]] || {
  echo "V20 staged promotion runner is missing: $target" >&2
  exit 2
}
[[ -f "$visual_memory_repair" ]] || {
  echo "Trusted visual-memory repair is missing: $visual_memory_repair" >&2
  exit 2
}
[[ -f "$pinned_visual_memory_repair" ]] || {
  echo "Pinned visual-memory repair is missing: $pinned_visual_memory_repair" >&2
  exit 2
}

bash "$service_root/scripts/ensure-runtime-dependencies.sh" "$service_python"
cd "$service_root"

if [[ -f "$service_root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$service_root/.env"
  set +a
fi

export PYTHONPATH="$service_root:$service_root/scripts${PYTHONPATH:+:$PYTHONPATH}"

self_test=0
for arg in "$@"; do
  if [[ "$arg" == "--self-test" ]]; then
    self_test=1
    break
  fi
done

if [[ -n "${INSTACOMP_AI_REGISTRY_TOKEN:-}" || -n "${INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN:-}" ]]; then
  echo "PASS Registry client authentication configured"
elif [[ "$self_test" == "1" ]]; then
  echo "INFO Registry client authentication not configured for isolated self-test"
else
  echo "Refusing V20 staged promotion: Registry authentication is missing after loading $service_root/.env." >&2
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

if [[ "$self_test" == "0" ]]; then
  echo "INFO Hydrating deterministic visual-pattern evidence before V20 preflight"
  "$service_python" "$visual_memory_repair" \
    --source-contains supervised_203_operator_confirmed \
    --max-repairs 250 \
    --workers 6

  echo "INFO Hydrating reviewed pinned visual evidence; V20 still requires fresh Registry and physical admission"
  "$service_python" "$pinned_visual_memory_repair" "$@"
fi

echo "PASS pinned staged promotion launcher mode: promotion-v20-registry-ready-reserve"
echo "INFO V20 preserves V19's direct LoRA, physical-card, UUID, fingerprint, and throttle gates"
echo "INFO V20 never strips year/brand/setName from Registry requests"
echo "INFO Registry-incomplete rows are skipped locally before HTTP and cannot consume the call budget"
echo "INFO Registry-ready rows with historical exact receipts are ranked early, but historical receipts remain advisory only"
echo "INFO V20 requires a locked reserve before candidate activation so fresh qualification rejects can be backfilled"
echo "INFO Candidate qualification and both final rounds use the same V20 Registry/physical lock"
echo "INFO Panini Prizm Base/non-Base remains governed by the printed back PRIZM mark"
echo "INFO Velocity and Cracked Ice still require deterministic matching surface evidence"
echo "INFO Frozen 15/25 preserve exact certified prior-stage UUID/fingerprint fixture prefixes"

exec "$service_python" "$target" "$@"
