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

# Python normally gets the scripts directory in sys.path when a promotion file
# is executed directly. V18's in-process launcher wrapper runs Python from stdin,
# so include both the service root and scripts explicitly to preserve that exact
# import environment on Linux CI and the production Apple-silicon Mac.
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
echo "INFO Exact Registry responses that drop a required teacher variant are retried before physical admission"
echo "INFO Two final exhaustive certification rounds run directly through the V14 traversal and cannot be overwritten by version monkey-patches"

# V18 deliberately owns fixture selection instead of delegating back through
# v12.main(). That means it must install the complete inherited admission stack
# explicitly before its first live Registry lock. The original V18 runner only
# installed the outer v15/v13 wrappers, leaving raw v3 identity-lock semantics
# active and causing every real candidate to be rejected before activation.
# Keep this correction in-process so there is still exactly one V18 runner.
exec "$service_python" - "$@" <<'PY'
from __future__ import annotations

import asyncio
import sys
from typing import Any

import promote_lora_candidate_frozen_25_v18 as v18


def registry_exact_preserves_teacher_variant(registry: Any, teacher: Any) -> bool:
    """Accept an exact Registry result only when required physical identity survived.

    Registry remains the UUID/fingerprint authority. This guard does not synthesize
    or copy a variant into Registry truth; it only notices when an otherwise exact
    response has dropped a non-Base teacher variant and therefore cannot pass the
    already-installed V5/V15 physical compatibility gate. Such a response remains
    eligible for V10's narrower core/OCR retry ladder instead of terminating that
    ladder early.
    """
    if not v18.v10._registry_exact(registry):
        return False
    payload = (
        teacher.model_dump(mode="json")
        if hasattr(teacher, "model_dump")
        else dict(teacher)
    )
    return v18.v5._registry_identity_matches_teacher(payload, registry)


async def registry_match_evidence_aligned_strict(
    teacher: Any,
    item: dict[str, Any] | None,
    registry_match,
):
    """V10 retry ladder with fail-closed handling for incomplete exact results."""
    normalized = v18.v10._normalized_teacher_identity(teacher)

    first = await registry_match(normalized, None)
    if registry_exact_preserves_teacher_variant(first, normalized):
        return first

    core = v18.v10._core_registry_identity(normalized)
    second = await registry_match(core, None)
    if registry_exact_preserves_teacher_variant(second, normalized):
        return second

    vision = v18.v10._local_vision_for_item(item)
    ocr = (
        v18.v10._text(getattr(vision, "combined_text", None))
        if vision is not None
        else None
    )
    if not ocr:
        return second

    ocr_core = v18.v10._core_registry_identity(normalized, clear_manufacturer=True)
    hints = getattr(vision, "identity_hints", None)
    visible_manufacturer = (
        v18.v10._text(getattr(hints, "manufacturer", None))
        if hints is not None
        else None
    )
    if visible_manufacturer:
        ocr_core.manufacturer = visible_manufacturer

    third = await registry_match(ocr_core, ocr)
    return third


def self_test_incomplete_exact_variant_retry() -> None:
    """Regression: DeWanna #32 exact UUID with variant=None must retry, not lock."""
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    exact_id = "00000000-0000-0000-0018-000000000032"
    fingerprint = "d" * 64
    teacher = CardIdentity(
        year="2025",
        manufacturer="Panini",
        brand="Panini Prizm WNBA",
        set_name="Base",
        player="DeWanna Bonner",
        card_number="32",
        parallel="Silver Prizm",
    )
    calls: list[tuple[CardIdentity, str | None]] = []

    def exact(identity: CardIdentity, *, parallel: str | None) -> ChecklistResult:
        return ChecklistResult(
            outcome=ChecklistOutcome.EXACT_MATCH,
            identity_id=exact_id,
            identity=CardIdentity(
                year="2025",
                manufacturer="Panini",
                brand="Prizm",
                set_name="Base",
                player=identity.player,
                card_number=identity.card_number,
                parallel=parallel,
            ),
            candidate_count=1,
            source_receipts=[
                f"registry_identity:{exact_id}",
                f"registry_fingerprint:{fingerprint}",
            ],
        )

    async def registry_match(identity: CardIdentity, ocr: str | None) -> ChecklistResult:
        calls.append((identity.model_copy(deep=True), ocr))
        if len(calls) == 1:
            return exact(identity, parallel=None)
        return exact(identity, parallel=identity.parallel)

    result = asyncio.run(
        registry_match_evidence_aligned_strict(teacher, None, registry_match)
    )
    assert len(calls) == 2
    assert calls[0][0].parallel == "Silver Prizm"
    assert calls[1][0].brand is None and calls[1][0].set_name is None
    assert calls[1][0].parallel == "Silver Prizm"
    assert v18.v5._registry_variant_claim(result) == "silver"
    assert registry_exact_preserves_teacher_variant(result, teacher) is True
    print(
        "PASS V18 retries exact Registry responses that drop a required teacher variant",
        flush=True,
    )


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

    # V10 normally returns immediately for any Registry exact_match. A live
    # Frozen-25 ladder exposed an exact response for DeWanna Bonner #32 whose
    # canonical identity dropped the required Silver variant. Keep Registry as
    # authority, but retry that incomplete exact result through the same V10
    # evidence-aligned ladder instead of allowing it to poison carry-forward.
    v18.v10._registry_match_evidence_aligned = registry_match_evidence_aligned_strict

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
    if v18.v10._registry_match_evidence_aligned is not registry_match_evidence_aligned_strict:
        raise RuntimeError("V18 live contract install failed: incomplete exact Registry retry guard is not active")

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
self_test_incomplete_exact_variant_retry()

# Preserve the exact CLI contract of promote_lora_candidate_frozen_25_v18.py.
sys.argv[0] = str(v18.__file__)
raise SystemExit(v18.main())
PY