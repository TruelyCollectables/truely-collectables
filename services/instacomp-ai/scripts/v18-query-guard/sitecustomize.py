from __future__ import annotations

import os
import sys
from typing import Any


def _text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


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
    _self_test_card_number_restore()
    if v10._registry_match_evidence_aligned is not guarded_registry_match_evidence_aligned:
        raise RuntimeError("V18 staged Registry query guard did not remain installed")
    print(
        "PASS V18 staged Registry query guard installed: teacher card_number is preserved across every V10 retry",
        flush=True,
    )


if (
    os.getenv("INSTACOMP_V18_STAGED_QUERY_GUARD", "") == "1"
    and sys.argv
    and sys.argv[0] == "-"
):
    try:
        _install_v18_card_number_guard()
    except BaseException as error:
        print(
            f"FATAL V18 staged Registry query guard failed to install: {type(error).__name__}: {error}",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2) from error
