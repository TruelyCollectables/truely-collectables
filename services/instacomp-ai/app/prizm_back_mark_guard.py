from __future__ import annotations

import io
import re
from typing import Any

from PIL import Image, ImageOps

from .models import LocalVisionEvidence, OCRObservation

_PRIZM_WORD_RE = re.compile(r"\bPRIZM\b", re.I)
_PROMPT_OLD_RULE = (
    "- The word PRIZM on the back is useful positive evidence, but its absence is not proof of Base. "
    "Never force Base solely because OCR missed PRIZM."
)
_PROMPT_NEW_RULE = (
    "- For Panini Prizm cards, the bold black word PRIZM on the BACK is authoritative for parallel status. "
    "If that back mark is absent, classify the card as regular Base even when the front looks metallic, silver, colored, or patterned. "
    "Never promote trusted style memory or a model parallel guess over a missing back PRIZM mark."
)


def _normalized_word(value: object) -> str:
    return re.sub(r"[^A-Z]", "", str(value or "").upper())


def _standalone_prizm_observations(evidence: LocalVisionEvidence) -> list[OCRObservation]:
    if evidence.back is None:
        return []
    return [
        observation
        for observation in evidence.back.ocr
        if observation.side == "back"
        and _normalized_word(observation.text) == "PRIZM"
        and float(observation.confidence or 0) >= 0.72
        # The actual parallel marker is a prominent standalone word, not tiny
        # legal/copyright copy that merely happens to mention the product name.
        and float(observation.box.width or 0) >= 0.055
        and float(observation.box.height or 0) >= 0.015
    ]


def _dark_ink_ratio(back_bytes: bytes, observation: OCRObservation) -> float:
    try:
        with Image.open(io.BytesIO(back_bytes)) as opened:
            image = ImageOps.exif_transpose(opened).convert("L")
            width, height = image.size
            box = observation.box
            # Apple Vision uses normalized lower-left coordinates. PIL crops use
            # top-left pixel coordinates, so flip Y while preserving the OCR box.
            left = max(0, min(width - 1, int(box.x * width)))
            right = max(left + 1, min(width, int((box.x + box.width) * width)))
            top = max(0, min(height - 1, int((1.0 - box.y - box.height) * height)))
            bottom = max(top + 1, min(height, int((1.0 - box.y) * height)))
            crop = image.crop((left, top, right, bottom))
            histogram = crop.histogram()
    except Exception:
        return 0.0

    total = max(1, sum(histogram))
    # Black printed letters occupy a meaningful fraction of the standalone OCR
    # box. The threshold is deliberately modest because anti-aliasing and JPEG
    # compression soften letter edges while still leaving a clear black mark.
    dark = sum(histogram[:106])
    very_dark = sum(histogram[:66])
    return max(dark / total, (very_dark / total) * 1.15)


def bold_black_prizm_back_mark(
    evidence: LocalVisionEvidence,
    back_bytes: bytes | None = None,
) -> bool:
    """Return True only for the prominent standalone black PRIZM back marker."""
    observations = _standalone_prizm_observations(evidence)
    if not observations:
        return False
    if back_bytes is None:
        # Stored evidence no longer has pixels attached. A strong standalone OCR
        # box is the durable receipt; live scans additionally verify dark ink.
        return True
    return any(_dark_ink_ratio(back_bytes, value) >= 0.055 for value in observations)


def local_evidence_is_prizm_family(evidence: LocalVisionEvidence) -> bool:
    """Use printed local text, not a surface-style guess, to establish Prizm family."""
    hints = evidence.identity_hints
    context = " ".join(
        [
            str(evidence.combined_text or ""),
            str(hints.brand or ""),
            str(hints.set_name or ""),
        ]
    )
    return bool(_PRIZM_WORD_RE.search(context))


def _identity_is_prizm_family(identity: dict[str, Any]) -> bool:
    context = " ".join(
        str(identity.get(key) or "")
        for key in ("brand", "set_name", "subset", "parallel", "variation")
    )
    return bool(_PRIZM_WORD_RE.search(context))


def apply_prizm_back_mark_rule(
    evidence: LocalVisionEvidence,
    *,
    back_bytes: bytes | None,
) -> LocalVisionEvidence:
    """Force Panini Prizm cards to Base unless the authoritative back mark exists."""
    if not local_evidence_is_prizm_family(evidence):
        return evidence

    mark_present = bold_black_prizm_back_mark(evidence, back_bytes)
    back = evidence.back
    if mark_present:
        if back is None:
            return evidence
        pattern = back.pattern.model_copy(
            update={
                "geometry": [
                    *back.pattern.geometry,
                    "authoritative bold black PRIZM back mark present",
                ]
            }
        )
        return evidence.model_copy(update={"back": back.model_copy(update={"pattern": pattern})})

    identity_hints = evidence.identity_hints.model_copy(update={"parallel": "Base"})
    if back is None:
        return evidence.model_copy(update={"identity_hints": identity_hints})
    pattern = back.pattern.model_copy(
        update={
            "geometry": [
                *back.pattern.geometry,
                "no authoritative bold black PRIZM back mark; Prizm family forced to Base",
            ]
        }
    )
    return evidence.model_copy(
        update={
            "identity_hints": identity_hints,
            "back": back.model_copy(update={"pattern": pattern}),
        }
    )


def install_prizm_back_mark_guard() -> None:
    """Install the back-mark rule before style memory and model/Registry merging."""
    from . import local_vision as local_vision_module
    from . import ollama as ollama_module

    if not getattr(local_vision_module, "_instacomp_prizm_back_mark_guard_installed", False):
        original_sync = local_vision_module.analyze_local_vision_sync

        def analyze_local_vision_sync_with_prizm_back_rule(front, back, settings):
            evidence = original_sync(front, back, settings)
            return apply_prizm_back_mark_rule(evidence, back_bytes=back)

        local_vision_module.analyze_local_vision_sync = analyze_local_vision_sync_with_prizm_back_rule
        local_vision_module._instacomp_prizm_back_mark_guard_installed = True

    if _PROMPT_OLD_RULE in ollama_module.SYSTEM_PROMPT:
        ollama_module.SYSTEM_PROMPT = ollama_module.SYSTEM_PROMPT.replace(
            _PROMPT_OLD_RULE,
            _PROMPT_NEW_RULE,
        )

    if not getattr(ollama_module, "_instacomp_prizm_back_merge_guard_installed", False):
        original_merge = ollama_module.merge_local_vision_payload

        def merge_local_vision_payload_with_prizm_back_rule(payload, local_vision):
            root = original_merge(payload, local_vision)
            if local_vision is None:
                return root
            identity = dict(root.get("identity") or {})
            if not _identity_is_prizm_family(identity):
                return root
            # If the live deterministic rule already forced Base, preserve it.
            # Otherwise use the durable standalone-back OCR receipt to catch the
            # case where the model recognized the Prizm family but front OCR did not.
            if str(local_vision.identity_hints.parallel or "").strip().casefold() == "base" or not bold_black_prizm_back_mark(local_vision):
                identity["parallel"] = "Base"
                root["identity"] = identity
            return root

        ollama_module.merge_local_vision_payload = merge_local_vision_payload_with_prizm_back_rule
        ollama_module._instacomp_prizm_back_merge_guard_installed = True
