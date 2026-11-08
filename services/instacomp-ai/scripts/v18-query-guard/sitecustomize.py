from __future__ import annotations

import asyncio
import os
import sys
from functools import wraps
from typing import Any


def _text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _is_v18_promotion_stdin(argv: list[str]) -> bool:
    """Activate only for the final V18 stdin runner, never generic bootstrap probes."""
    if not argv or argv[0] != "-":
        return False
    return any(
        arg == "--self-test"
        or arg == "--stage-target"
        or arg.startswith("--stage-target=")
        for arg in argv[1:]
    )


def _with_card_number(identity: Any, card_number: str):
    """Return the same identity with only the already-known card number restored."""
    if _text(getattr(identity, "card_number", None)):
        return identity
    if hasattr(identity, "model_copy"):
        return identity.model_copy(update={"card_number": card_number})

    from app.models import CardIdentity

    payload = dict(identity)
    payload["card_number"] = card_number
    return CardIdentity.model_validate(payload)


def _self_test_activation_scope() -> None:
    assert _is_v18_promotion_stdin(["-"]) is False
    assert _is_v18_promotion_stdin(["-", "/tmp/requirements.txt"]) is False
    assert _is_v18_promotion_stdin(["-", "--self-test"]) is True
    assert _is_v18_promotion_stdin(["-", "--stage-target", "10"]) is True
    assert _is_v18_promotion_stdin(["-", "--stage-target=25"]) is True
    print(
        "PASS V18 staged Registry query guard activation scope excludes bootstrap Python probes",
        flush=True,
    )


def _self_test_card_number_restore() -> None:
    from app.models import CardIdentity

    missing = CardIdentity(
        year="2025",
        manufacturer="Panini",
        brand="Prizm",
        player="Guard Test",
        card_number=None,
        parallel="Silver Prizm",
    )
    repaired = _with_card_number(missing, "32")
    assert repaired.card_number == "32"
    assert repaired.player == "Guard Test"
    assert repaired.parallel == "Silver Prizm"
    print(
        "PASS V18 staged Registry query guard self-test: missing retry card_number restores only the teacher number",
        flush=True,
    )


def _install_v18_card_number_guard() -> None:
    import promote_lora_candidate_frozen_25_v10 as v10

    if getattr(v10, "_v18_card_number_guard_installed", False):
        return

    original = v10._registry_match_evidence_aligned

    async def guarded_registry_match_evidence_aligned(
        teacher: Any,
        item: dict[str, Any] | None,
        registry_match,
    ):
        item_identity = (item or {}).get("identity") or {}
        teacher_number = _text(getattr(teacher, "card_number", None)) or _text(
            item_identity.get("card_number")
        )

        # The training row's card number is a hard fact. If a normalization layer
        # ever drops it, restore only that exact value before V10 builds any retry.
        if teacher_number and not _text(getattr(teacher, "card_number", None)):
            teacher = _with_card_number(teacher, teacher_number)
            print(
                f"V18 REGISTRY TEACHER REPAIR: restored card_number={teacher_number!r}",
                flush=True,
            )

        async def preserve_card_number(identity: Any, ocr: str | None):
            current_number = _text(getattr(identity, "card_number", None))
            if teacher_number and not current_number:
                identity = _with_card_number(identity, teacher_number)
                current_number = teacher_number
                print(
                    "V18 REGISTRY QUERY REPAIR: "
                    f"restored card_number={teacher_number!r} before Registry lookup",
                    flush=True,
                )

            result = await registry_match(identity, ocr)
            if v10._registry_outcome(result) == "input_incomplete":
                reasons = v10._registry_reasons(result)
                print(
                    "V18 REGISTRY INPUT INCOMPLETE: "
                    f"teacher_card_number={teacher_number!r} "
                    f"query_card_number={current_number!r} reasons={reasons!r}",
                    flush=True,
                )
            return result

        return await original(teacher, item, preserve_card_number)

    guarded_registry_match_evidence_aligned._v18_card_number_guard = True
    v10._registry_match_evidence_aligned = guarded_registry_match_evidence_aligned
    v10._v18_card_number_guard_installed = True
    _self_test_activation_scope()
    _self_test_card_number_restore()
    if v10._registry_match_evidence_aligned is not guarded_registry_match_evidence_aligned:
        raise RuntimeError("V18 staged Registry query guard did not remain installed")
    print(
        "PASS V18 staged Registry query guard installed: teacher card_number is preserved across every V10 retry",
        flush=True,
    )


def _evidence_aligned_diagnostic_for_fixture(
    item: dict[str, Any],
    *,
    raw_diagnostic_match=None,
):
    """Resolve candidate output through the same fail-closed V10 path as preflight.

    V14 historically sent the LoRA suggestion straight to the raw diagnostic
    endpoint. Fresh V18 preflight, however, uses V10's evidence-aligned sequence:
    narrow normalized identity, catalog-noise-free core identity, then deterministic
    local-image OCR. A card could therefore lock authoritatively in preflight and
    be mislabeled as a UUID regression seconds later only because qualification
    used a weaker request path.

    This adapter starts from the candidate identity, not the teacher identity.
    It never copies a parallel/variation or Registry UUID from the training row.
    V10 may only reshape the request exactly as it already does during preflight,
    and the existing V14 Registry gate still requires the exact locked UUID and
    fingerprint after the lookup returns.
    """
    import promote_lora_candidate_frozen_25_v10 as v10
    import promote_lora_candidate_frozen_25_v13 as v13

    async def diagnostic(candidate_identity: Any, _candidate_visible_text: str | None):
        matcher = raw_diagnostic_match
        if matcher is None:
            from app.checklist import checklist_gateway

            matcher = getattr(checklist_gateway, "match_with_diagnostics", None)
        if not callable(matcher):
            raise RuntimeError("Authoritative Registry diagnostic gateway is not installed")

        last_diagnostics: dict[str, Any] = {}

        async def registry_only(identity: Any, ocr: str | None):
            nonlocal last_diagnostics
            registry, diagnostics = await matcher(identity, ocr)
            last_diagnostics = dict(diagnostics) if isinstance(diagnostics, dict) else {}
            return registry

        # Preserve v13's exact-same-request throttle semantics here too. A throttle
        # is infrastructure flow control, never evidence that the card changed.
        guarded_registry = v13._retrying_registry_match(registry_only)
        registry = await v10._registry_match_evidence_aligned(
            candidate_identity,
            item,
            guarded_registry,
        )
        diagnostics = dict(last_diagnostics)
        diagnostics["v18_registry_lookup_mode"] = "candidate_evidence_aligned_v10"
        return registry, diagnostics

    return diagnostic


def _aggregate_single_fixture_rounds(
    number: int,
    fixtures: list[dict[str, Any]],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for item, result in zip(fixtures, results, strict=True):
        cases.extend(result.get("cases") or [])
        if str(result.get("failure_mode") or "") == "infrastructure":
            return {
                "round": number,
                "passed": False,
                "cases": cases,
                "failure_mode": "infrastructure",
                "failure_count": len(failures) + int(result.get("failure_count") or 1),
                "failures": failures + list(result.get("failures") or []),
                "error": str(result.get("error") or "V18 Registry qualification infrastructure failure"),
            }
        if result.get("passed") is not True:
            current = list(result.get("failures") or [])
            if not current:
                case = item.get("case") or (None, None, None)
                current = [
                    {
                        "key": case[0] if len(case) > 0 else None,
                        "player": case[1] if len(case) > 1 else None,
                        "card_number": case[2] if len(case) > 2 else None,
                        "error": str(result.get("error") or "deterministic candidate/Registry mismatch"),
                    }
                ]
            failures.extend(current)

    passed = not failures and len(cases) == len(fixtures)
    aggregate: dict[str, Any] = {
        "round": number,
        "passed": passed,
        "cases": cases,
        "failure_mode": None if passed else "deterministic_card_failures",
        "failure_count": len(failures),
        "failures": failures,
    }
    if failures:
        aggregate["error"] = (
            f"{len(failures)} deterministic card failure(s): "
            + "; ".join(
                f"{failure.get('player')} #{failure.get('card_number')}: {failure.get('error')}"
                for failure in failures
            )
        )
    return aggregate


def _install_v18_round_registry_alignment() -> None:
    import promote_lora_candidate_frozen_25_v14 as v14

    if getattr(v14, "_v18_evidence_aligned_round_registry_installed", False):
        return

    original = v14.run_round_exhaustive

    @wraps(original)
    async def evidence_aligned_run_round(
        number: int,
        fixtures: list[dict[str, Any]],
        adapter_sha: str,
        **kwargs,
    ) -> dict[str, Any]:
        # V14's own isolated tests inject a diagnostic matcher deliberately. Keep
        # that explicit dependency injection untouched. Live V18 calls do not.
        if kwargs.get("diagnostic_match_fn") is not None or not fixtures:
            return await original(number, fixtures, adapter_sha, **kwargs)

        results: list[dict[str, Any]] = []
        for item in fixtures:
            per_fixture_kwargs = dict(kwargs)
            per_fixture_kwargs["diagnostic_match_fn"] = _evidence_aligned_diagnostic_for_fixture(item)
            result = await original(
                number,
                [item],
                adapter_sha,
                **per_fixture_kwargs,
            )
            results.append(result)
            if str(result.get("failure_mode") or "") == "infrastructure":
                break

        # Infrastructure aborts may stop before every fixture. Aggregate only the
        # fixtures actually attempted; deterministic card failures continue the
        # exhaustive sweep across the complete stage.
        attempted = fixtures[: len(results)]
        aggregate = _aggregate_single_fixture_rounds(number, attempted, results)
        if aggregate.get("failure_mode") == "infrastructure":
            return aggregate
        if len(results) != len(fixtures):
            raise RuntimeError("V18 qualification round ended without an infrastructure receipt")
        return aggregate

    v14.run_round_exhaustive = evidence_aligned_run_round
    v14._v18_evidence_aligned_round_registry_installed = True
    if v14.run_round_exhaustive is not evidence_aligned_run_round:
        raise RuntimeError("V18 evidence-aligned round Registry guard did not remain installed")
    if v14.run_round_exhaustive.__name__ != "run_round_exhaustive":
        raise RuntimeError("V18 round Registry guard changed the certified V14 traversal identity")
    print(
        "PASS V18 qualification/certification Registry alignment installed: V14 candidate rounds use V10 evidence-aligned lookups",
        flush=True,
    )


def _self_test_evidence_aligned_diagnostic() -> None:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult
    import promote_lora_candidate_frozen_five as frozen_base

    expected_uuid = "bc4c041e-881e-4974-95f4-74ad1e9c2f55"
    expected_fp = "a" * 64
    item = {
        "identity": {
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Prizm WNBA",
            "set_name": "Prizm WNBA",
            "player": "DeWanna Bonner",
            "card_number": "32",
            "parallel": "Silver Prizm",
        },
        "images": [],
    }
    calls: list[dict[str, Any]] = []

    async def incomplete_then_exact(identity: Any, ocr: str | None):
        payload = identity.model_dump(mode="json")
        calls.append({"identity": payload, "ocr": ocr})
        if len(calls) == 1:
            return (
                ChecklistResult(
                    outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                    reasons=["missing_or_uncertain_visible_set_identity_evidence"],
                ),
                {"registry_status": "input_incomplete"},
            )
        locked = CardIdentity(
            year="2025",
            manufacturer="Panini",
            brand="Prizm",
            player="DeWanna Bonner",
            card_number="32",
            parallel="Silver Prizm",
        )
        return (
            ChecklistResult(
                outcome=ChecklistOutcome.EXACT_MATCH,
                identity_id=expected_uuid,
                identity=locked,
                candidate_count=1,
                source_receipts=[
                    f"registry_identity:{expected_uuid}",
                    f"registry_fingerprint:{expected_fp}",
                ],
            ),
            {
                "registry_status": "exact_match",
                "registry_identity_id": expected_uuid,
                "registry_fingerprint_sha256": expected_fp,
            },
        )

    candidate = CardIdentity(
        year="2025",
        manufacturer="Panini",
        brand="Prizm WNBA Retail",
        set_name="Prizm WNBA Retail",
        player="DeWanna Bonner",
        card_number="32",
        parallel="Silver Prizm",
    )
    registry, diagnostics = asyncio.run(
        _evidence_aligned_diagnostic_for_fixture(
            item,
            raw_diagnostic_match=incomplete_then_exact,
        )(candidate, "candidate-visible-text")
    )
    assert registry.identity_id == expected_uuid
    assert diagnostics["v18_registry_lookup_mode"] == "candidate_evidence_aligned_v10"
    assert len(calls) == 2
    assert calls[0]["identity"]["card_number"] == "32"
    assert calls[1]["identity"]["card_number"] == "32"
    assert calls[1]["identity"]["brand"] is None
    assert calls[1]["identity"]["set_name"] is None
    assert calls[1]["identity"]["parallel"] == "Silver Prizm"
    case = (
        "dewanna-32-silver",
        "DeWanna Bonner",
        "32",
        "silver",
        expected_uuid,
        expected_fp,
    )
    frozen_base.registry_gate(registry.model_dump(mode="json"), case)

    async def wrong_uuid(identity: Any, _ocr: str | None):
        locked = CardIdentity(
            year="2025",
            manufacturer="Panini",
            brand="Prizm",
            player="DeWanna Bonner",
            card_number="32",
            parallel=getattr(identity, "parallel", None),
        )
        wrong = "00000000-0000-0000-0000-000000000999"
        return (
            ChecklistResult(
                outcome=ChecklistOutcome.EXACT_MATCH,
                identity_id=wrong,
                identity=locked,
                candidate_count=1,
                source_receipts=[
                    f"registry_identity:{wrong}",
                    f"registry_fingerprint:{expected_fp}",
                ],
            ),
            {"registry_status": "exact_match", "registry_identity_id": wrong},
        )

    wrong_registry, _ = asyncio.run(
        _evidence_aligned_diagnostic_for_fixture(
            item,
            raw_diagnostic_match=wrong_uuid,
        )(candidate, None)
    )
    try:
        frozen_base.registry_gate(wrong_registry.model_dump(mode="json"), case)
        raise AssertionError("V18 evidence-aligned qualification accepted a wrong Registry UUID")
    except RuntimeError:
        pass

    print(
        "PASS V18 qualification Registry regression: input-incomplete raw candidate lookup retries through V10 without weakening exact UUID/fingerprint gates",
        flush=True,
    )


if (
    os.getenv("INSTACOMP_V18_STAGED_QUERY_GUARD", "") == "1"
    and _is_v18_promotion_stdin(sys.argv)
):
    try:
        _install_v18_card_number_guard()
        _install_v18_round_registry_alignment()
        _self_test_evidence_aligned_diagnostic()
    except BaseException as error:
        print(
            f"FATAL V18 staged Registry query guard failed to install: {type(error).__name__}: {error}",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2) from error
