from __future__ import annotations

import base64
import json
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field

from .config import Settings
from .models import CardIdentity, SpecimenAttributes
from .ollama import extract_json, prepare_fast_identity_image, prepare_ollama_image


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



_CLOUDFLARE_CONFIDENCE = {"high": 0.95, "medium": 0.75, "low": 0.50}


def _parse_cloudflare_specimen(raw_response: object) -> RawSpecimenVision:
    if isinstance(raw_response, dict):
        data = dict(raw_response)
    else:
        text = str(raw_response or "").strip()
        if not text:
            raise ValueError("Cloudflare specimen response was empty")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            object_match = re.search(r"\{.*?\}", text, re.S)
            if object_match:
                try:
                    data = json.loads(object_match.group(0))
                except json.JSONDecodeError:
                    data = {}
            else:
                data = {}
            count_match = re.search(r"Patch\s+Color\s+Count\s*[:*]+\s*(\d+)", text, re.I)
            colors_match = re.search(r"Patch\s+Colors?\s*[:*]+\s*([^\n]+)", text, re.I)
            confidence_match = re.search(
                r"Observation\s+Confidence\s*[:*]+\s*([^\n]+)", text, re.I
            )
            uncertainty_match = re.search(r"Uncertainty\s*[:*]+\s*([^\n]+)", text, re.I)
            if count_match:
                data["patch_color_count"] = int(count_match.group(1))
            if colors_match:
                value = re.sub(r"[*_]", "", colors_match.group(1)).strip(" .")
                data["patch_colors"] = [
                    part.strip()
                    for part in re.split(r"\s*(?:,|\band\b|/|\+)\s*", value, flags=re.I)
                    if part.strip()
                ]
            if confidence_match:
                data["observation_confidence"] = re.sub(
                    r"[*_]", "", confidence_match.group(1)
                ).strip(" .")
            if uncertainty_match:
                data["uncertainty"] = re.sub(
                    r"[*_]", "", uncertainty_match.group(1)
                ).strip(" .")

    colors = _unique_colors(list(data.get("patch_colors") or []))
    count = data.get("patch_color_count")
    try:
        count = int(count) if count is not None else (len(colors) or None)
    except (TypeError, ValueError):
        count = len(colors) or None

    confidence_value = data.get("observation_confidence", 0)
    if isinstance(confidence_value, str):
        lowered = confidence_value.casefold().strip(" .")
        confidence = next(
            (score for label, score in _CLOUDFLARE_CONFIDENCE.items() if label in lowered),
            0.0,
        )
        if confidence == 0.0:
            match = re.search(r"\d+(?:\.\d+)?", lowered)
            if match:
                confidence = float(match.group(0))
                if confidence > 1:
                    confidence /= 100.0
    else:
        try:
            confidence = float(confidence_value or 0)
        except (TypeError, ValueError):
            confidence = 0.0

    raw_uncertainty = data.get("uncertainty")
    uncertainty: list[str] = []
    if isinstance(raw_uncertainty, list):
        uncertainty = [str(v).strip() for v in raw_uncertainty if str(v).strip()]
    elif isinstance(raw_uncertainty, (int, float)):
        if float(raw_uncertainty) > 0.25:
            uncertainty = [f"cloudflare_uncertainty:{float(raw_uncertainty):.2f}"]
    elif raw_uncertainty is not None:
        value = str(raw_uncertainty).strip()
        try:
            numeric_uncertainty = float(value)
        except ValueError:
            numeric_uncertainty = None
        if numeric_uncertainty is not None:
            if numeric_uncertainty > 0.25:
                uncertainty = [f"cloudflare_uncertainty:{numeric_uncertainty:.2f}"]
        elif value and value.casefold() not in {"low", "none", "no", "n/a", "null"}:
            uncertainty = [value]

    if not colors or count is None:
        raise ValueError("Cloudflare specimen response did not contain visible patch colors")

    return RawSpecimenVision(
        patch_color_count=count,
        patch_colors=colors,
        observation_confidence=max(0.0, min(confidence or 0.90, 1.0)),
        uncertainty=uncertainty,
    )


async def _cloudflare_specimen_attributes(
    front: bytes,
    identity: CardIdentity,
    settings: Settings,
) -> SpecimenAttributes | None:
    account_id = str(settings.cloudflare_account_id or "").strip()
    token = str(settings.cloudflare_workers_ai_token or "").strip()
    if not account_id or not token:
        return None

    model = "@cf/meta/llama-3.2-11b-vision-instruct"
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"
    image = "data:image/jpeg;base64," + base64.b64encode(
        prepare_fast_identity_image(front)
    ).decode("ascii")
    prompt = (
        "The canonical trading-card identity is already locked and must not be changed. "
        "Inspect ONLY the physical memorabilia/jersey/patch material inside the visible patch window. "
        "Ignore printed card art, foil, borders, text, player uniform image, and background. "
        "Return JSON only with patch_color_count, patch_colors, observation_confidence, uncertainty. "
        "If physical patch colors are visible, patch_colors MUST list every distinct visible material color "
        "and patch_color_count MUST equal the number of unique listed colors. "
        "Team identity is irrelevant to the physical color observation."
    )
    timeout = min(max(float(settings.patch_color_vision_timeout_seconds or 12.0), 4.0), 15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"prompt": prompt, "image": image, "max_tokens": 160, "temperature": 0},
        )
    response.raise_for_status()
    raw_response = (response.json().get("result") or {}).get("response")
    raw = _parse_cloudflare_specimen(raw_response)
    result = _build_result(raw, identity)
    return result.model_copy(update={"source": "post_identity_cloudflare_vision"})


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

    cloudflare = await _cloudflare_specimen_attributes(front, identity, settings)
    if cloudflare is not None:
        return cloudflare

    # Local Ollama is a fail-closed fallback only. One compact front image keeps
    # specimen work bounded and avoids wedged reused VLM workers.
    prepared = [prepare_fast_identity_image(front)]
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
        "keep_alive": 0,
        "options": {
            "temperature": 0.0,
            "num_ctx": 2048,
            "num_predict": 256,
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
