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
echo "INFO Missing Registry canonical variant text is treated as omission only when the existing physical gates support the teacher variant"
echo "INFO Historical row-local Registry UUID/fingerprint receipts are advisory for fresh V18 selection; current exact Registry truth wins"
echo "INFO Certified carry-forward fixtures still require the exact prior-stage current Registry UUID/fingerprint manifest signature"
echo "INFO Two final exhaustive certification rounds run directly through the V14 traversal and cannot be overwritten by version monkey-patches"

exec "$service_python" - "$@" <<'PY'
from __future__ import annotations

import sys
from types import SimpleNamespace
from typing import Any

import promote_lora_candidate_frozen_25_v9 as v9
import promote_lora_candidate_frozen_25_v18 as v18

# Capture the raw V3 lock before any repeated V18 contract installation. V5 calls
# this hook only after its physical-card gate has passed.
_RAW_V3_LOCK = v18.v5._original_locked_expansion


def registry_identity_matches_teacher_allow_omission(
    teacher: dict[str, Any], registry: Any
) -> bool:
    """Keep exact player/card identity while treating only missing variant as omission."""
    locked = getattr(registry, "identity", None)
    if locked is None:
        return False
    payload = locked.model_dump(mode="json") if hasattr(locked, "model_dump") else dict(locked)
    if v18.base.norm(payload.get("player")) != v18.base.norm(teacher.get("player")):
        return False
    if (
        v18.base.norm(payload.get("card_number")).lstrip("#")
        != v18.base.norm(teacher.get("card_number")).lstrip("#")
    ):
        return False

    teacher_marker = v18.v5._teacher_variant_claim(teacher)
    registry_marker = v18.v5._registry_variant_claim(registry)
    if teacher_marker is None:
        return True
    if teacher_marker == "base":
        return registry_marker in {None, "base"}
    if registry_marker is None:
        return True
    return registry_marker == teacher_marker


def physical_conflict_allow_registry_omission(
    item: dict[str, Any], registry: Any
) -> tuple[bool, str | None, str | None, str | None]:
    """Use V15 unchanged unless Registry omitted only the canonical variant field."""
    teacher_marker = v18.v5._teacher_variant_claim(item["identity"])
    registry_marker = v18.v5._registry_variant_claim(registry)

    # Explicit Registry variant truth keeps the exact proven V15/V9 behavior.
    if registry_marker is not None or teacher_marker in {None, "base"}:
        return v18.v15._authoritative_prizm_back_mark_conflict(item, registry)

    image_marker = v18.v5._image_parallel_probe(item)
    if v18.v15._fixture_is_prizm(item, registry):
        back_mark = v18.v15._prizm_back_mark_probe(item)
        if back_mark is not True:
            return (
                True,
                "base" if back_mark is False else None,
                teacher_marker,
                None,
            )

        # The back PRIZM mark proves non-Base. Pattern-sensitive families still
        # require their deterministic front-surface witness.
        if teacher_marker in v9._PATTERN_SENSITIVE_VARIANTS:
            return (
                image_marker != teacher_marker,
                image_marker,
                teacher_marker,
                None,
            )

        # Ordinary Prizm parallels (for example Silver) do not need a synthetic
        # front-surface label, but a positive contradictory image witness rejects.
        if image_marker is not None and image_marker != teacher_marker:
            return True, image_marker, teacher_marker, None
        return False, image_marker, teacher_marker, None

    # Outside Prizm, omission is usable only when deterministic image evidence
    # positively proves the same teacher variant.
    return (
        image_marker != teacher_marker,
        image_marker,
        teacher_marker,
        None,
    )


def current_authority_candidate(item: dict[str, Any]) -> dict[str, Any]:
    """Make historical row-local Registry receipts advisory for V18 fresh locks."""
    value = dict(item)
    value["historical_metadata_registry_id"] = item.get("metadata_registry_id")
    value["historical_metadata_fingerprint"] = item.get("metadata_fingerprint")
    value["metadata_registry_id"] = None
    value["metadata_fingerprint"] = None
    return value


def diagnostic_raw_registry_lock(item: dict[str, Any], registry: Any):
    """Preserve the raw V3 lock and explain any remaining live-only rejection."""
    locked = _RAW_V3_LOCK(item, registry)
    if locked is not None:
        return locked

    identity = item.get("identity") or {}
    outcome = v18.v10._registry_outcome(registry)
    registry_id = v18.v3.legacy._valid_uuid(getattr(registry, "identity_id", None))
    fingerprint = v18.v3._registry_fingerprint(registry)
    identity_ok = v18.v3._registry_identity_matches_teacher(identity, registry)
    print(
        f"V18 REGISTRY LOCK REJECT {identity.get('player')} #{identity.get('card_number')}: "
        f"outcome={outcome!r} registry_uuid={registry_id!r} "
        f"fingerprint_present={fingerprint is not None} identity_compatible={identity_ok}",
        flush=True,
    )
    return None


def self_test_v18_current_authority_overlay() -> None:
    item = {
        "row_id": "dewanna-32",
        "identity": {
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Prizm",
            "set_name": "Base",
            "player": "DeWanna Bonner",
            "card_number": "32",
            "parallel": "Silver Prizm",
        },
        "metadata_registry_id": "00000000-0000-0000-0018-000000000031",
        "metadata_fingerprint": "a" * 64,
    }

    def registry(parallel: str | None):
        return SimpleNamespace(
            identity={
                "year": "2025",
                "manufacturer": "Panini",
                "brand": "Prizm",
                "set_name": "Base",
                "player": "DeWanna Bonner",
                "card_number": "32",
                "parallel": parallel,
            }
        )

    assert registry_identity_matches_teacher_allow_omission(item["identity"], registry(None))
    assert not registry_identity_matches_teacher_allow_omission(
        item["identity"], registry("Prizms Ice")
    )

    previous_back = v18.v15._prizm_back_mark_probe_override
    previous_image = v18.v5._image_parallel_probe_override
    try:
        v18.v15._prizm_back_mark_probe_override = lambda _item: True
        v18.v5._image_parallel_probe_override = lambda _item: "silver"
        conflict, image, teacher, reg = physical_conflict_allow_registry_omission(
            item, registry(None)
        )
        assert conflict is False and image == "silver" and teacher == "silver" and reg is None

        v18.v15._prizm_back_mark_probe_override = lambda _item: False
        conflict, image, teacher, reg = physical_conflict_allow_registry_omission(
            item, registry(None)
        )
        assert conflict is True and image == "base" and teacher == "silver" and reg is None

        v18.v15._prizm_back_mark_probe_override = lambda _item: True
        ice = dict(item)
        ice["identity"] = {**item["identity"], "parallel": "Cracked Ice Prizm"}
        v18.v5._image_parallel_probe_override = lambda _item: None
        conflict, image, teacher, reg = physical_conflict_allow_registry_omission(
            ice, registry(None)
        )
        assert conflict is True and image is None and teacher == "ice" and reg is None
    finally:
        v18.v15._prizm_back_mark_probe_override = previous_back
        v18.v5._image_parallel_probe_override = previous_image

    current = current_authority_candidate(item)
    assert current["metadata_registry_id"] is None
    assert current["metadata_fingerprint"] is None
    assert current["historical_metadata_registry_id"] == item["metadata_registry_id"]
    assert current["historical_metadata_fingerprint"] == item["metadata_fingerprint"]

    # Fresh selection may move to current Registry truth, but an already-certified
    # stage prefix cannot: V18's manifest signature still fails hard on UUID drift.
    locked = {
        "row_id": "dewanna-32",
        "case": (
            "registry-current-32",
            "DeWanna Bonner",
            "32",
            "silver",
            "00000000-0000-0000-0018-000000000032",
            "b" * 64,
        ),
    }
    expected = {
        "row_id": "dewanna-32",
        "player": "DeWanna Bonner",
        "card_number": "32",
        "registry_identity_id": "00000000-0000-0000-0018-000000000031",
        "registry_fingerprint_sha256": "a" * 64,
    }
    try:
        v18._require_carry_forward_lock(locked, expected)
        raise AssertionError("V18 accepted carry-forward UUID/fingerprint drift")
    except RuntimeError:
        pass

    print(
        "PASS V18 fresh selection uses current Registry truth while certified carry-forward signatures remain exact",
        flush=True,
    )


def install_complete_v18_contract(target: int) -> None:
    if target not in v18.ALLOWED_STAGE_TARGETS:
        raise RuntimeError(
            f"Unsupported stage target {target}; allowed={v18.ALLOWED_STAGE_TARGETS}"
        )

    # Restore the last-known-good inherited V18 admission stack first.
    v18.v12._install_contract(target)
    v18.v15._install_contract()
    v18.v13._install_contract()
    v18.v11._configure_stage(target)

    # Overlay only the two V18 current-authority rules required by the live data:
    # missing variant text is not a contradiction, and historical row-local
    # Registry receipts do not overrule a fresh exact current Registry lock.
    v18.v3._registry_identity_matches_teacher = registry_identity_matches_teacher_allow_omission
    v9._image_witness_conflict_hardened = physical_conflict_allow_registry_omission
    v18.v5._image_witness_conflict = physical_conflict_allow_registry_omission
    v18.v5._original_locked_expansion = diagnostic_raw_registry_lock

    v18.v3.SCHEMA = v18.SCHEMA
    v18.v12.SCHEMA = v18.SCHEMA
    v18.v11.SCHEMA = v18.SCHEMA

    if v18.v3._locked_expansion is not v18.v5._locked_expansion:
        raise RuntimeError("V18 live contract install failed: V5 physical Registry lock is not active")
    if v18.v3._registry_identity_matches_teacher is not registry_identity_matches_teacher_allow_omission:
        raise RuntimeError("V18 live contract install failed: current-authority Registry matcher is not active")
    if v18.v5._image_witness_conflict is not physical_conflict_allow_registry_omission:
        raise RuntimeError("V18 live contract install failed: omitted-variant physical gate is not active")
    if v18.v5._original_locked_expansion is not diagnostic_raw_registry_lock:
        raise RuntimeError("V18 live contract install failed: Registry lock diagnostics are not active")
    if v18.v3._expansion_candidate is v18.v12._ORIGINAL_EXPANSION_CANDIDATE:
        raise RuntimeError("V18 live contract install failed: raw V3 expansion candidate builder is still active")

    print(
        "PASS V18 live admission stack installed: "
        "last-known-good V12/V10/V9/V5 + V15 back-mark + V13 throttle + current-authority overlay",
        flush=True,
    )


def installed_candidate_items(dataset, *, require_images: bool) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for row in v18.base.load_rows(dataset):
        item = v18.v3._expansion_candidate(row, require_images=require_images)
        if item is None:
            continue
        item = current_authority_candidate(item)
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
self_test_v18_current_authority_overlay()

sys.argv[0] = str(v18.__file__)
raise SystemExit(v18.main())
PY
