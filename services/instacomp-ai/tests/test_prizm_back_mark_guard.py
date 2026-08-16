from __future__ import annotations

import io

from PIL import Image, ImageDraw

from app.models import LocalVisionEvidence
from app.ollama import SYSTEM_PROMPT, merge_local_vision_payload
from app.prizm_back_mark_guard import (
    apply_prizm_back_mark_rule,
    bold_black_prizm_back_mark,
)


def _back_image(*, dark: bool) -> bytes:
    width, height = 800, 1100
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    left, right = int(0.20 * width), int(0.45 * width)
    top, bottom = int(0.40 * height), int(0.45 * height)
    ink = (20, 20, 20) if dark else (185, 185, 185)
    bar_width = max(5, (right - left) // 16)
    for index in range(6):
        x = left + 8 + index * (bar_width * 2)
        draw.rectangle((x, top + 5, x + bar_width, bottom - 5), fill=ink)
    draw.rectangle((left + 8, top + 5, right - 8, top + 11), fill=ink)
    draw.rectangle((left + 8, bottom - 11, right - 8, bottom - 5), fill=ink)

    output = io.BytesIO()
    image.save(output, format="JPEG", quality=95)
    return output.getvalue()


def _vision(*, back_text: str | None, parallel: str | None = None) -> LocalVisionEvidence:
    back_ocr = []
    if back_text is not None:
        back_ocr.append(
            {
                "text": back_text,
                "confidence": 0.99,
                "box": {"x": 0.20, "y": 0.55, "width": 0.25, "height": 0.05},
                "side": "back",
                "source": "test",
            }
        )
    return LocalVisionEvidence.model_validate(
        {
            "front": {
                "side": "front",
                "width": 800,
                "height": 1100,
                "ocr": [
                    {
                        "text": "PANINI PRIZM",
                        "confidence": 0.99,
                        "box": {"x": 0.2, "y": 0.8, "width": 0.4, "height": 0.06},
                        "side": "front",
                        "source": "test",
                    }
                ],
            },
            "back": {
                "side": "back",
                "width": 800,
                "height": 1100,
                "ocr": back_ocr,
            },
            "identity_hints": {
                "manufacturer": "Panini",
                "parallel": parallel,
            },
            "combined_text": "2025 PANINI PRIZM WNBA",
        }
    )


def test_bold_black_prizm_back_mark_requires_standalone_dark_print():
    evidence = _vision(back_text="PRIZM")
    assert bold_black_prizm_back_mark(evidence, _back_image(dark=True)) is True
    assert bold_black_prizm_back_mark(evidence, _back_image(dark=False)) is False

    legal_copy = _vision(back_text="2025 PANINI PRIZM WNBA")
    assert bold_black_prizm_back_mark(legal_copy, _back_image(dark=True)) is False


def test_missing_back_prizm_mark_forces_prizm_family_to_base():
    evidence = _vision(back_text=None, parallel="Silver Prizm")
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    assert guarded.identity_hints.parallel == "Base"
    assert any("forced to Base" in value for value in guarded.back.pattern.geometry)


def test_present_back_prizm_mark_sets_silver_minimum_when_parallel_is_missing():
    evidence = _vision(back_text="PRIZM", parallel=None)
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    assert guarded.identity_hints.parallel == "Silver Prizm"
    assert any("minimum parallel Silver Prizm" in value for value in guarded.back.pattern.geometry)


def test_present_back_prizm_mark_upgrades_base_to_silver_minimum():
    evidence = _vision(back_text="PRIZM", parallel="Base")
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    assert guarded.identity_hints.parallel == "Silver Prizm"


def test_present_back_prizm_mark_preserves_stronger_non_base_evidence():
    evidence = _vision(back_text="PRIZM", parallel="Green Prizm")
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    assert guarded.identity_hints.parallel == "Green Prizm"


def test_model_cannot_promote_silver_over_guarded_base():
    evidence = _vision(back_text=None, parallel=None)
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    merged = merge_local_vision_payload(
        {
            "identity": {
                "brand": "2025 Panini Prizm WNBA",
                "set_name": "Base",
                "player": "DeWanna Bonner",
                "card_number": "32",
                "parallel": "Silver Prizm",
            },
            "evidence": {},
        },
        guarded,
    )
    assert merged["identity"]["parallel"] == "Base"


def test_model_base_is_upgraded_to_silver_when_back_prizm_is_present():
    evidence = _vision(back_text="PRIZM", parallel=None)
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    merged = merge_local_vision_payload(
        {
            "identity": {
                "brand": "2025 Panini Prizm WNBA",
                "set_name": "Base",
                "player": "Aari McDonald",
                "card_number": "10",
                "parallel": "Base",
            },
            "evidence": {},
        },
        guarded,
    )
    assert merged["identity"]["parallel"] == "Silver Prizm"


def test_model_color_survives_when_back_prizm_is_present():
    evidence = _vision(back_text="PRIZM", parallel="Green Prizm")
    guarded = apply_prizm_back_mark_rule(evidence, back_bytes=_back_image(dark=True))
    merged = merge_local_vision_payload(
        {
            "identity": {
                "brand": "2025 Panini Prizm WNBA",
                "set_name": "Base",
                "player": "Aneesah Morrow",
                "card_number": "79",
                "parallel": "Green Prizm",
            },
            "evidence": {},
        },
        guarded,
    )
    assert merged["identity"]["parallel"] == "Green Prizm"


def test_ollama_prompt_uses_authoritative_back_rule():
    assert "absence is not proof of Base" not in SYSTEM_PROMPT
    assert "bold black word PRIZM on the BACK is authoritative" in SYSTEM_PROMPT
    assert "at least Silver Prizm" in SYSTEM_PROMPT
