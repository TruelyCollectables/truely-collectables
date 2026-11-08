from __future__ import annotations

from typing import Any

from . import ollama as ollama_module


def _text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalized_card_number(value: object) -> str:
    return "".join(str(value or "").strip().lstrip("#").casefold().split())


def _candidate_card_number(payload: dict[str, Any]) -> str | None:
    identity_source = payload.get("identity")
    identity = identity_source if isinstance(identity_source, dict) else payload
    return _text(identity.get("card_number") or identity.get("cardNumber"))


def _looks_like_leading_ocr_truncation(candidate: object, hint: object) -> bool:
    """Return True only when OCR appears to have dropped a short leading prefix.

    The Production regression is ``122`` -> ``22``. This deliberately does not
    protect arbitrary model/OCR disagreement: a model guess of ``1`` versus a
    strong physical OCR read of ``118`` must still resolve to ``118`` through the
    existing hard-evidence merge.
    """
    candidate_number = _normalized_card_number(candidate)
    hint_number = _normalized_card_number(hint)
    if not candidate_number or not hint_number or candidate_number == hint_number:
        return False
    missing = len(candidate_number) - len(hint_number)
    return 1 <= missing <= 2 and candidate_number.endswith(hint_number)


def install_card_number_evidence_guard() -> None:
    """Protect only a leading-truncated OCR hint from corrupting card identity.

    Deterministic OCR remains a hard identity witness everywhere it already was.
    The narrow exception is when a non-empty candidate card number and the local
    OCR hint have the exact suffix relationship produced by a dropped leading
    character (for example ``122`` -> ``22``). In that case preserve the fuller
    candidate for Registry verification while retaining the shorter OCR read in
    evidence and recording the disagreement.

    This does not make the model authoritative. Non-truncation conflicts still use
    the established deterministic OCR result, missing candidate numbers are still
    filled from OCR, and Registry UUID/fingerprint exact-match remains mandatory.
    """
    if getattr(ollama_module, "_instacomp_card_number_evidence_guard_installed", False):
        return

    original = ollama_module.merge_local_vision_payload

    def guarded_merge_local_vision_payload(payload: dict, local_vision):
        candidate_number = _candidate_card_number(payload)
        merged = original(payload, local_vision)
        if candidate_number is None or local_vision is None:
            return merged

        hints = getattr(local_vision, "identity_hints", None)
        hint_number = _text(getattr(hints, "card_number", None)) if hints is not None else None
        if not _looks_like_leading_ocr_truncation(candidate_number, hint_number):
            return merged

        root = dict(merged)
        identity = dict(root.get("identity") or {})
        identity["card_number"] = candidate_number
        identity.pop("cardNumber", None)
        root["identity"] = identity

        evidence = dict(root.get("evidence") or {})
        uncertainty = [str(value) for value in evidence.get("uncertainty") or [] if value]
        note = (
            "card_number_conflict: fuller explicit candidate "
            f"{candidate_number!r} preserved over leading-truncated deterministic OCR "
            f"hint {hint_number!r}; OCR retained as evidence for Registry verification"
        )
        if note not in uncertainty:
            uncertainty.append(note)
        evidence["uncertainty"] = uncertainty
        root["evidence"] = evidence
        return root

    ollama_module.merge_local_vision_payload = guarded_merge_local_vision_payload
    ollama_module._instacomp_card_number_evidence_guard_installed = True
