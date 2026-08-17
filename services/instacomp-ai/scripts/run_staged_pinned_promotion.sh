#!/usr/bin/env bash
set -euo pipefail

service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_python="$service_root/.venv/bin/python"
target="$service_root/scripts/promote_lora_candidate_frozen_25_v18.py"
visual_memory_repair="$service_root/scripts/repair_trusted_visual_memory.py"
pinned_visual_memory_repair="$service_root/scripts/repair_pinned_visual_memory_v15.py"

[[ -x "$service_python" ]] || {
  echo "InstaComp service Python is missing: $service_python" >&2
  exit 2
}
[[ -f "$target" ]] || {
  echo "V18 staged promotion runner is missing: $target" >&2
  exit 2
}
[[ -f "$visual_memory_repair" ]] || {
  echo "Trusted visual-memory repair is missing: $visual_memory_repair" >&2
  exit 2
}
[[ -f "$pinned_visual_memory_repair" ]] || {
  echo "Pinned visual-memory gate is missing: $pinned_visual_memory_repair" >&2
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

export PYTHONPATH="$service_root${PYTHONPATH:+:$PYTHONPATH}"

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
  echo "Refusing V18 staged promotion: Registry authentication is missing after loading $service_root/.env." >&2
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
  echo "INFO Hydrating missing visual-pattern evidence for the reviewed supervised training set before promotion"
  "$service_python" "$visual_memory_repair" \
    --source-contains supervised_203_operator_confirmed \
    --max-repairs 250 \
    --workers 6

  echo "INFO Hydrating reviewed pinned visual evidence; V18 still requires fresh physical/Registry admission for every fixture"
  "$service_python" "$pinned_visual_memory_repair" "$@"
fi

echo "PASS pinned staged promotion launcher mode: promotion-v18-current-authoritative-two-pass"
echo "INFO Legacy Frozen Five rows are priority candidates only; none bypass current physical/Registry preflight"
echo "INFO Every selected fixture requires a current exact Registry UUID/fingerprint and physical-card compatibility"
echo "INFO Each selected candidate must then survive two exact candidate/Registry qualification passes before certification rounds"
echo "INFO For Panini Prizm, the bold black PRIZM word on the back remains authoritative for Base versus non-Base"
echo "INFO Pattern-sensitive families such as Velocity and Cracked Ice still require deterministic matching surface evidence"
echo "INFO Frozen 15/25 preserve the complete successful prior-stage fixture prefix, adapter hash, and dataset hash"
echo "INFO Registry throttle handling remains same-request fail-safe backoff; throttle is never recorded as a card miss"
echo "INFO Two final exhaustive certification rounds run directly through the V14 traversal and cannot be overwritten by version monkey-patches"

# V18 deliberately owns fixture selection instead of delegating back through
# v12.main(). That means it must install the complete inherited admission stack
# explicitly before its first live Registry lock. The original V18 runner only
# installed the outer v15/v13 wrappers, leaving raw v3 identity-lock semantics
# active and causing every real candidate to be rejected before activation.
# Keep this correction in-process so there is still exactly one V18 runner.
exec "$service_python" - "$@" <<'PY'
from __future__ import annotations

import sys
from typing import Any

import promote_lora_candidate_frozen_25_v18 as v18


def install_complete_v18_contract(target: int) -> None:
    if target not in v18.ALLOWED_STAGE_TARGETS:
        raise RuntimeError(
            f"Unsupported stage target {target}; allowed={v18.ALLOWED_STAGE_TARGETS}"
        )

    # This is the install step v12.main() used to provide implicitly. It installs
    # v10 -> v9/v7/v5 into v3, including canonical teacher/Registry matching and
    # the image-backed expansion candidate semantics V18 expects.
    v18.v12._install_contract(target)

    # Re-apply the current physical-card authority and throttle behavior after
    # the inherited stack is installed. These layers intentionally override only
    # the witness/throttle hooks, never Registry exactness or UUID/fingerprint.
    v18.v15._install_contract()
    v18.v13._install_contract()
    v18.v11._configure_stage(target)

    v18.v3.SCHEMA = v18.SCHEMA
    v18.v12.SCHEMA = v18.SCHEMA
    v18.v11.SCHEMA = v18.SCHEMA

    # Fail immediately if a future refactor again leaves raw V3 admission active.
    if v18.v3._locked_expansion is not v18.v5._locked_expansion:
        raise RuntimeError("V18 live contract install failed: V5 physical Registry lock is not active")
    if v18.v3._registry_identity_matches_teacher is not v18.v5._registry_identity_matches_teacher:
        raise RuntimeError("V18 live contract install failed: canonical teacher/Registry matcher is not active")
    if v18.v5._image_witness_conflict is not v18.v15._authoritative_prizm_back_mark_conflict:
        raise RuntimeError("V18 live contract install failed: authoritative Prizm back-mark gate is not active")
    if v18.v3._expansion_candidate is v18.v12._ORIGINAL_EXPANSION_CANDIDATE:
        raise RuntimeError("V18 live contract install failed: raw V3 expansion candidate builder is still active")

    print(
        "PASS V18 live admission stack installed: "
        "V12/V10/V9/V5 Registry+physical contract + V15 back-mark authority + V13 throttle",
        flush=True,
    )


def installed_candidate_items(dataset, *, require_images: bool) -> dict[str, dict[str, Any]]:
    # Build the actual V18 admission universe through the currently installed
    # candidate builder. The original V18 accidentally used the frozen raw V3
    # constructor, bypassing the canonical variant-marker repair used by V17.
    items: dict[str, dict[str, Any]] = {}
    for row in v18.base.load_rows(dataset):
        item = v18.v3._expansion_candidate(row, require_images=require_images)
        if item is None:
            continue
        row_id = str(item.get("row_id") or "")
        if not row_id or row_id in items:
            raise RuntimeError(
                f"V18 expansion candidate row ID is missing/duplicated: {row_id!r}"
            )
        items[row_id] = item
    if not items:
        raise RuntimeError("V18 found no image-backed training candidates")
    return items


v18._install_contract = install_complete_v18_contract
v18._candidate_items = installed_candidate_items

# Preserve the exact CLI contract of promote_lora_candidate_frozen_25_v18.py.
sys.argv[0] = str(v18.__file__)
raise SystemExit(v18.main())
PY
