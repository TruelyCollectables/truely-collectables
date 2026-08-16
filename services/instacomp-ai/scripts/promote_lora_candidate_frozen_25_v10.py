#!/usr/bin/env python3
from __future__ import annotations

import sys
from collections import defaultdict
from types import SimpleNamespace
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v9 as v9
import promote_lora_candidate_frozen_five as base

SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v10"
RegistryMatch = Callable[[Any, str | None], Awaitable[Any]]
_V3_BUILD_FROZEN_25_LIVE = v3.build_frozen_25_live


def _text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _identity_signature(identity: Any) -> tuple[str, ...]:
    payload = identity.model_dump(mode="json") if hasattr(identity, "model_dump") else dict(identity)
    return tuple(
        base.norm(payload.get(key))
        for key in (
            "year",
            "manufacturer",
            "brand",
            "set_name",
            "subset",
            "player",
            "card_number",
            "parallel",
            "variation",
            "serial_number",
        )
    )


def _normalized_teacher_identity(teacher: Any):
    """Apply the same narrow semantic shape repair used by the LoRA runtime.

    This is intentionally not a fuzzy Registry mapper. The only rewrite is the
    already-certified candidate identity guard (for example Panini Prizm WNBA
    parallel text accidentally encoded in set_name). Registry remains the source
    of the UUID/fingerprint and the final accepted identity.
    """
    from app.candidate_identity_guard import normalize_candidate_identity_payload
    from app.models import CardIdentity

    payload = {"parsed": {"identity": teacher.model_dump(mode="json")}}
    normalized, _repaired = normalize_candidate_identity_payload(payload)
    return CardIdentity.model_validate(normalized["parsed"]["identity"])


def _core_registry_identity(teacher: Any, *, clear_manufacturer: bool = False):
    """Remove catalog-shape fields that should not prevent Registry discovery.

    Brand/set/subset are deliberately omitted from the discovery request because
    old teacher rows frequently encode product naming differently than Registry.
    Parallel/variation/serial/auto/relic remain physical type constraints. The
    Registry resolver itself only exact-locks when its hard core identifies one
    product/set and one typed identity, so removing noisy labels broadens lookup
    without broadening acceptance.
    """
    from app.models import CardIdentity

    source = teacher.model_dump(mode="json")
    return CardIdentity(
        sport=source.get("sport"),
        league=source.get("league"),
        year=source.get("year"),
        manufacturer=None if clear_manufacturer else source.get("manufacturer"),
        player=source.get("player"),
        team=source.get("team"),
        card_number=source.get("card_number"),
        parallel=source.get("parallel"),
        variation=source.get("variation"),
        serial_number=source.get("serial_number"),
        serial_run=source.get("serial_run"),
        autograph=source.get("autograph"),
        memorabilia=source.get("memorabilia"),
    )


def _registry_outcome(registry: Any) -> str:
    outcome = getattr(registry, "outcome", None)
    return str(getattr(outcome, "value", outcome) or "")


def _registry_exact(registry: Any) -> bool:
    return _registry_outcome(registry) == "exact_match"


def _registry_reasons(registry: Any) -> str:
    reasons = getattr(registry, "reasons", None) or []
    return ",".join(str(value) for value in reasons if value)[:500]


def _candidate_items_for_dataset(dataset, *, require_images: bool) -> dict[tuple[str, ...], list[dict[str, Any]]]:
    """Index the exact v3 expansion identities so Registry retries can access images."""
    index: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in base.load_rows(dataset):
        item = v3._expansion_candidate(row, require_images=require_images)
        if item is None:
            continue
        from app.models import CardIdentity

        teacher = CardIdentity.model_validate(item["identity"])
        index[_identity_signature(teacher)].append(item)
    return index


def _local_vision_for_item(item: dict[str, Any] | None):
    if not item:
        return None
    paths = item.get("images") or []
    if not paths:
        return None
    try:
        from app.config import settings
        from app.local_vision import analyze_local_vision_sync

        front = paths[0].read_bytes()
        back = paths[1].read_bytes() if len(paths) > 1 else None
        return analyze_local_vision_sync(front, back, settings)
    except Exception:
        return None


async def _registry_match_evidence_aligned(
    teacher: Any,
    item: dict[str, Any] | None,
    registry_match: RegistryMatch,
):
    """Resolve a teacher row through fail-closed, increasingly evidence-led queries."""
    normalized = _normalized_teacher_identity(teacher)

    # Attempt 1: same narrow identity-shape normalization the actual candidate
    # runtime receives. This fixes semantic packaging drift without erasing any
    # teacher dimensions.
    first = await registry_match(normalized, None)
    if _registry_exact(first):
        return first

    # Attempt 2: drop noisy catalog naming (brand/set/subset) while preserving
    # physical type constraints. Registry may only exact-lock this when the hard
    # core itself has a unique product/set and typed identity.
    core = _core_registry_identity(normalized)
    second = await registry_match(core, None)
    if _registry_exact(second):
        return second

    # Attempt 3: use deterministic local OCR from the exact training images. We
    # clear manufacturer on this final discovery attempt so a stale teacher label
    # cannot veto a manufacturer that is actually visible and uniquely supported
    # by Registry candidates. Existing server enrichment remains fail-closed when
    # OCR is absent or ambiguous.
    vision = _local_vision_for_item(item)
    ocr = _text(getattr(vision, "combined_text", None)) if vision is not None else None
    if not ocr:
        return second

    ocr_core = _core_registry_identity(normalized, clear_manufacturer=True)
    hints = getattr(vision, "identity_hints", None)
    visible_manufacturer = _text(getattr(hints, "manufacturer", None)) if hints is not None else None
    if visible_manufacturer:
        ocr_core.manufacturer = visible_manufacturer

    third = await registry_match(ocr_core, ocr)
    if _registry_exact(third):
        return third

    # Return the most informative fail-closed result. No synthetic UUID, no
    # fallback identity, and no promotion admission occurs here.
    return third


async def build_frozen_25_live_v10(
    dataset,
    *,
    require_images: bool = True,
    registry_match: RegistryMatch | None = None,
):
    if registry_match is None:
        from app.checklist import checklist_gateway

        registry_match = checklist_gateway.match

    items = _candidate_items_for_dataset(dataset, require_images=require_images)

    async def evidence_aligned_match(teacher, _ignored_ocr):
        bucket = items.get(_identity_signature(teacher)) or []
        item = bucket[0] if bucket else None
        result = await _registry_match_evidence_aligned(teacher, item, registry_match)
        if not _registry_exact(result):
            player = _text(getattr(teacher, "player", None)) or "?"
            number = _text(getattr(teacher, "card_number", None)) or "?"
            reasons = _registry_reasons(result)
            suffix = f" reasons={reasons}" if reasons else ""
            print(
                f"FROZEN 25 V10 REGISTRY MISS {player} #{number}: "
                f"outcome={_registry_outcome(result) or 'unknown'}{suffix}",
                flush=True,
            )
        return result

    return await _V3_BUILD_FROZEN_25_LIVE(
        dataset,
        require_images=require_images,
        registry_match=evidence_aligned_match,
    )


def _self_test_registry_retry_ladder() -> None:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    exact_id = "00000000-0000-0000-0010-000000000001"
    fingerprint = "a" * 64

    def exact(identity: CardIdentity) -> ChecklistResult:
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
                parallel="Prizms Silver",
            ),
            candidate_count=1,
            source_receipts=[
                f"registry_identity:{exact_id}",
                f"registry_fingerprint:{fingerprint}",
            ],
        )

    calls: list[tuple[CardIdentity, str | None]] = []

    async def core_match(identity: CardIdentity, ocr: str | None) -> ChecklistResult:
        calls.append((identity.model_copy(deep=True), ocr))
        # Prove the raw noisy product labels do not survive the core retry.
        if identity.brand is None and identity.set_name is None and identity.manufacturer == "Panini":
            return exact(identity)
        return ChecklistResult(
            outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
            reasons=["catalog_shape_conflict"],
        )

    noisy = CardIdentity(
        year="2025",
        manufacturer="Panini",
        brand="Panini Prizm WNBA - stale catalog wording",
        set_name="Wrong Set Packaging",
        player="Test Player",
        card_number="99",
        parallel="Silver Prizm",
    )
    import asyncio

    result = asyncio.run(_registry_match_evidence_aligned(noisy, None, core_match))
    assert result.outcome == ChecklistOutcome.EXACT_MATCH
    assert len(calls) == 2
    assert calls[0][0].brand is not None
    assert calls[1][0].brand is None and calls[1][0].set_name is None
    assert calls[1][0].parallel == "Silver Prizm"

    previous = globals()["_local_vision_for_item"]
    try:
        globals()["_local_vision_for_item"] = lambda _item: SimpleNamespace(
            combined_text="TEST PLAYER 99 PANINI",
            identity_hints=SimpleNamespace(manufacturer="Panini"),
        )
        calls.clear()

        async def ocr_match(identity: CardIdentity, ocr: str | None) -> ChecklistResult:
            calls.append((identity.model_copy(deep=True), ocr))
            if ocr and identity.manufacturer == "Panini" and identity.brand is None:
                return exact(identity)
            return ChecklistResult(
                outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                reasons=["missing_manufacturer"],
            )

        missing_manufacturer = noisy.model_copy(update={"manufacturer": None})
        result = asyncio.run(
            _registry_match_evidence_aligned(
                missing_manufacturer,
                {"images": [SimpleNamespace()]},
                ocr_match,
            )
        )
        assert result.outcome == ChecklistOutcome.EXACT_MATCH
        assert len(calls) == 3
        assert calls[2][1] == "TEST PLAYER 99 PANINI"
        assert calls[2][0].manufacturer == "Panini"

        calls.clear()

        async def ambiguous_match(identity: CardIdentity, ocr: str | None) -> ChecklistResult:
            calls.append((identity.model_copy(deep=True), ocr))
            return ChecklistResult(
                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                reasons=["multiple_registry_candidates"],
            )

        result = asyncio.run(
            _registry_match_evidence_aligned(
                missing_manufacturer,
                {"images": [SimpleNamespace()]},
                ambiguous_match,
            )
        )
        assert result.outcome != ChecklistOutcome.EXACT_MATCH
        assert result.identity_id is None
        assert len(calls) == 3
    finally:
        globals()["_local_vision_for_item"] = previous

    # Acceptance still requires authoritative UUID + fingerprint and teacher
    # variant compatibility after discovery succeeds.
    item = {
        "identity": noisy.model_dump(mode="json"),
        "marker": "silver",
        "metadata_registry_id": None,
        "metadata_fingerprint": None,
    }
    locked = v3._locked_expansion(item, exact(noisy))
    assert locked is not None
    no_fingerprint = exact(noisy)
    no_fingerprint.source_receipts = [f"registry_identity:{exact_id}"]
    assert v3._locked_expansion(item, no_fingerprint) is None

    print("PASS v10 strips noisy teacher product labels only for Registry discovery")
    print("PASS v10 preserves physical parallel/type constraints during core discovery")
    print("PASS v10 retries missing/stale manufacturer with deterministic image OCR")
    print("PASS v10 ambiguous Registry results remain fail-closed with no synthetic UUID")
    print("PASS v10 still requires Registry UUID, fingerprint, and teacher variant compatibility")


def _install_contract_fix() -> None:
    v9._install_contract_fix()
    v3.SCHEMA = SCHEMA
    v3.build_frozen_25_live = build_frozen_25_live_v10


def self_test() -> int:
    assert v9.self_test() == 0
    _install_contract_fix()
    _self_test_registry_retry_ladder()
    print("PASS Frozen 25 v10 preserves every v9/v7/v6/v5 fail-closed gate")
    print("PASS Frozen 25 v10 preflight uses evidence-aligned Registry discovery before activation")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
