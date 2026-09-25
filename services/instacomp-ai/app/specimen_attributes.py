from __future__ import annotations

import base64
import json
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field

from .config import Settings
from .models import CardIdentity, SpecimenAttributes
from .ollama import extract_json, prepare_ollama_image


SYSTEM_PROMPT = """You are InstaComp Patch Color Intelligence, a specimen-only vision pass.
The Checklist Registry has ALREADY locked the canonical card identity. You are forbidden
from creating, correcting, replacing, scoring, or returning any identity field.

Inspect only card-specific physical traits visible in the supplied card images.
For memorabilia/relic/patch cards, inspect the embedded material itself:
- Count distinct visible material colors inside the patch/relic window.
- Do NOT count card borders, printed graphics, background art, foil, text, or team logos
  unless that color is physically present in the embedded memorabilia material.
- Name the visible material colors with ordinary color words.
- Record specimen traits such as logo fragment, laundry tag, shield, button, seam,
  lettering, prime patch, patch type/location, autograph ink color, or inscription.
- team_color_match is specimen description metadata only. Set it true only when the
  observed patch colors clearly correspond to the supplied canonical team palette/name.
  If uncertain, use null/false and explain the uncertainty.
- Never use subjective marketing adjectives such as nasty, sick, monster, or filthy.
- Never infer a missing patch color just because a team normally uses that color.
- If the patch boundary or colors are not clear enough, lower confidence and say why.

Return one JSON object matching the schema. No identity fields are allowed."""


class RawSpecimenVision(BaseModel):
    patch_color_count: int | None = Field(default=None, ge=1, le=12)
    patch_colors: list[str] = Field(default_factory=list)
    patch_type: str | None = None
    patch_location: str | None = None
    logo_patch: bool | None = None
    laundry_tag: bool | None = None
    shield: bool | None = None
    button: bool | None = None
    seam: bool | None = None
    lettering: bool | None = None
    prime_patch: bool | None = None
    autograph_ink_color: str | None = None
    inscription_text: str | None = None
    team_color_match: bool | None = None
    team_color_match_colors: list[str] = Field(default_factory=list)
    team_color_match_confidence: float = Field(default=0, ge=0, le=1)
    observation_confidence: float = Field(default=0, ge=0, le=1)
    uncertainty: list[str] = Field(default_factory=list)


RAW_SCHEMA = RawSpecimenVision.model_json_schema()
_COLOR_MAP = {
    "gray": "grey",
    "charcoal gray": "charcoal grey",
    "light gray": "light grey",
    "dark gray": "dark grey",
}


def _clean_color(value: object) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    if not text or len(text) > 40:
        return None
    text = _COLOR_MAP.get(text, text)
    if not re.fullmatch(r"[a-z][a-z -]*", text):
        return None
    return text


def _unique_colors(values: list[object]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        color = _clean_color(value)
        if color and color not in seen:
            seen.add(color)
            result.append(color)
    return result[:12]


def _join_colors(colors: list[str]) -> str:
    labels = [color.title() for color in colors]
    if len(labels) <= 1:
        return labels[0] if labels else ""
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return f"{', '.join(labels[:-1])}, and {labels[-1]}"


def _is_memorabilia(identity: CardIdentity) -> bool:
    return bool(identity.memorabilia or str(identity.memorabilia_type or "").strip())


def _context(identity: CardIdentity) -> dict[str, Any]:
    return {
        "team": identity.team,
        "sport": identity.sport,
        "memorabilia_type": identity.memorabilia_type,
        "autograph": identity.autograph,
        "inscription": identity.inscription,
    }


def _build_result(raw: RawSpecimenVision, identity: CardIdentity) -> SpecimenAttributes:
    colors = _unique_colors(list(raw.patch_colors))
    uncertainty = list(dict.fromkeys(str(v).strip() for v in raw.uncertainty if str(v).strip()))
    reported_count = raw.patch_color_count
    measured_count = len(colors) or reported_count
    if colors and reported_count and reported_count != len(colors):
        uncertainty.append(
            f"model_color_count_mismatch:reported={reported_count}:named={len(colors)}"
        )
        measured_count = len(colors)

    confidence = float(raw.observation_confidence or 0)
    publishable = bool(measured_count and confidence >= 0.85 and not uncertainty)
    status = "observed" if publishable else "uncertain"

    title_suffix = (
        f"{measured_count} Color Patch"
        if publishable and measured_count is not None and measured_count >= 2
        else None
    )

    description_note = None
    if colors and confidence >= 0.80:
        color_text = _join_colors(colors)
        if (
            raw.team_color_match is True
            and raw.team_color_match_confidence >= 0.85
            and identity.team
        ):
            description_note = (
                f"Observed memorabilia patch colors: {color_text}. "
                f"These visible colors align with the {identity.team} team palette."
            )
        else:
            description_note = f"Observed memorabilia patch colors: {color_text}."

    return SpecimenAttributes(
        status=status,
        patch_color_count=measured_count,
        patch_colors=colors,
        patch_type=str(raw.patch_type or "").strip() or None,
        patch_location=str(raw.patch_location or "").strip() or None,
        logo_patch=raw.logo_patch,
        laundry_tag=raw.laundry_tag,
        shield=raw.shield,
        button=raw.button,
        seam=raw.seam,
        lettering=raw.lettering,
        prime_patch=raw.prime_patch,
        autograph_ink_color=_clean_color(raw.autograph_ink_color),
        team_color_match=raw.team_color_match,
        team_color_match_colors=_unique_colors(list(raw.team_color_match_colors)),
        team_color_match_confidence=raw.team_color_match_confidence,
        observation_confidence=confidence,
        title_suffix=title_suffix,
        description_note=description_note,
        uncertainty=uncertainty,
        identity_fields_mutated=False,
    )


async def analyze_specimen_attributes(
    front: bytes,
    back: bytes | None,
    identity: CardIdentity,
    settings: Settings,
) -> SpecimenAttributes:
    if not settings.patch_color_intelligence_enabled:
        return SpecimenAttributes(status="disabled", identity_fields_mutated=False)
    if not _is_memorabilia(identity):
        return SpecimenAttributes(status="not_applicable", identity_fields_mutated=False)

    prepared = [prepare_ollama_image(front)]
    if back:
        prepared.append(prepare_ollama_image(back))
    images = [base64.b64encode(value).decode("ascii") for value in prepared]
    model = str(settings.patch_color_vision_model or "").strip() or settings.ollama_model
    prompt = (
        SYSTEM_PROMPT
        + "\nCanonical context for DESCRIPTION comparison only; do not return or modify it:\n"
        + json.dumps(_context(identity), ensure_ascii=False, separators=(",", ":"))
    )
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt, "images": images}],
        "stream": False,
        "format": RAW_SCHEMA,
        "keep_alive": "15m",
        "options": {
            "temperature": 0.0,
            "num_ctx": 4096,
            "num_predict": 1024,
            "seed": 0,
        },
    }
    async with httpx.AsyncClient(timeout=settings.patch_color_vision_timeout_seconds) as client:
        response = await client.post(
            f"{settings.ollama_base_url.rstrip('/')}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        envelope = response.json()

    message = envelope.get("message") or {}
    parsed = extract_json(str(message.get("content") or ""))
    raw = RawSpecimenVision.model_validate(parsed)
    return _build_result(raw, identity)
