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


def install_card_number_evidence_guard() -> None:
    """Prevent a partial OCR hint from overwriting an explicit model card number.

    Deterministic OCR remains visible evidence and may still fill card_number when
    the model returned no number. It must not, however, replace a non-empty model
    read before the authoritative Registry sees both pieces of evidence. The real
    Frozen 25 Mac failure that motivated this guard was Sonia Citron #122: Apple
    Vision exposed only ``22`` and the previous merge treated that hint as a hard
    field, changing the candidate to #22 before Registry verification.

    This guard does not trust the model as final identity. It preserves the model's
    explicit candidate value, retains the conflicting OCR in evidence, and leaves
    the Registry UUID/fingerprint exact-match gate fully authoritative.
    """
    if getattr(ollama_module, "_instacomp_card_number_evidence_guard_installed", False):
        return

    original = ollama_module.merge_local_vision_payload

    def guarded_merge_local_vision_payload(payload: dict, local_vision):
        candidate_number = _candidate_card_number(payload)
        merged = original(payload, local_vision)
        if candidate_number is None:
            return merged

        root = dict(merged)
        identity = dict(root.get("identity") or {})
        merged_number = _text(identity.get("card_number") or identity.get("cardNumber"))
        identity["card_number"] = candidate_number
        identity.pop("cardNumber", None)
        root["identity"] = identity

        hint_number = None
        if local_vision is not None:
            hints = getattr(local_vision, "identity_hints", None)
            hint_number = _text(getattr(hints, "card_number", None)) if hints is not None else None

        if (
            hint_number is not None
            and _normalized_card_number(hint_number)
            != _normalized_card_number(candidate_number)
        ):
            evidence = dict(root.get("evidence") or {})
            uncertainty = [str(value) for value in evidence.get("uncertainty") or [] if value]
            note = (
                "card_number_conflict: explicit candidate "
                f"{candidate_number!r} preserved; deterministic OCR hint "
                f"{hint_number!r} retained as evidence for Registry verification"
            )
            if note not in uncertainty:
                uncertainty.append(note)
            evidence["uncertainty"] = uncertainty
            root["evidence"] = evidence

        # If the original merge already preserved the same value, this assignment
        # is intentionally idempotent. Keeping the branch explicit makes the guard
        # safe if the underlying merge implementation changes later.
        _ = merged_number
        return root

    ollama_module.merge_local_vision_payload = guarded_merge_local_vision_payload
    ollama_module._instacomp_card_number_evidence_guard_installed = True
