from __future__ import annotations

import asyncio
import base64
import io
import json
import re
from typing import Any

import httpx
from PIL import Image, ImageOps
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


def _prepare_specimen_image(content: bytes, max_edge: int = 896) -> bytes:
    if not content:
        raise ValueError("Specimen image is empty")
    with Image.open(io.BytesIO(content)) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(
            output,
            format="JPEG",
            quality=82,
            optimize=True,
            progressive=False,
            subsampling=0,
        )
        prepared = output.getvalue()
    if not prepared:
        raise ValueError("Specimen image preparation produced no bytes")
    return prepared
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


def _color_family(value: str) -> str:
    color = _clean_color(value) or ""
    families = (
        "white", "black", "grey", "red", "orange", "yellow", "green",
        "blue", "purple", "pink", "brown", "gold", "silver", "teal",
    )
    for family in families:
        if family in color:
            return family
    if "navy" in color:
        return "blue"
    if "cream" in color or "ivory" in color:
        return "white"
    return color


def _color_signature(raw: RawSpecimenVision) -> tuple[str, ...]:
    return tuple(sorted({_color_family(value) for value in raw.patch_colors if _color_family(value)}))


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
            count_match = re.search(r"patch[_\s-]*color[_\s-]*count\s*[:=*]+\s*(\d+)", text, re.I)
            colors_match = re.search(r"patch[_\s-]*colors?\s*[:=*]+\s*([^\n]+)", text, re.I)
            confidence_match = re.search(
                r"observation[_\s-]*confidence\s*[:=*]+\s*([^\n]+)", text, re.I
            )
            uncertainty_match = re.search(r"uncertainty\s*[:=*]+\s*([^\n]+)", text, re.I)
            if count_match:
                data["patch_color_count"] = int(count_match.group(1))
            if colors_match:
                value = re.sub(r"[*_\[\]\"']", "", colors_match.group(1)).strip(" .")
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
        numeric_uncertainty = None
        match = re.search(r"\d+(?:\.\d+)?", value)
        if match:
            try:
                numeric_uncertainty = float(match.group(0))
                if "%" in value or numeric_uncertainty > 1:
                    numeric_uncertainty /= 100.0
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


_SPECIMEN_REGIONS = [
    ("full", 0.00, 0.00, 1.00, 1.00),
    ("top_left", 0.00, 0.00, 0.62, 0.54),
    ("top_right", 0.38, 0.00, 1.00, 0.54),
    ("middle_left", 0.00, 0.23, 0.62, 0.79),
    ("middle_right", 0.38, 0.23, 1.00, 0.79),
    ("bottom_left", 0.00, 0.46, 0.62, 1.00),
    ("bottom_right", 0.38, 0.46, 1.00, 1.00),
]


def _specimen_region_images(front: bytes) -> list[tuple[str, bytes]]:
    """Return overlapping card regions so patch windows cannot hide in full-card context."""
    if not front:
        return []
    with Image.open(io.BytesIO(front)) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        width, height = image.size
        normalized_regions = _SPECIMEN_REGIONS
        result: list[tuple[str, bytes]] = []
        for label, x1, y1, x2, y2 in normalized_regions:
            crop = image.crop(
                (
                    max(0, int(width * x1)),
                    max(0, int(height * y1)),
                    min(width, int(width * x2)),
                    min(height, int(height * y2)),
                )
            )
            crop.thumbnail((640, 640), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            crop.save(
                output,
                format="JPEG",
                quality=84,
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            result.append((label, output.getvalue()))
        return result


def _contour_verification_crops(front: bytes, region_label: str) -> list[bytes]:
    """Propose tight physical-window crops for tie-breaking only."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []
    region = next((value for value in _SPECIMEN_REGIONS if value[0] == region_label), None)
    if region is None or not front:
        return []
    try:
        with Image.open(io.BytesIO(front)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = image.size
            _, rx1, ry1, rx2, ry2 = region
            px1, py1 = int(width * rx1), int(height * ry1)
            px2, py2 = int(width * rx2), int(height * ry2)
            array = np.asarray(image)
            gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edges = cv2.Canny(blurred, 50, 140)
            contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            proposals: list[tuple[float, tuple[int, int, int, int]]] = []
            image_area = float(width * height)
            for contour in contours:
                x, y, box_w, box_h = cv2.boundingRect(contour)
                cx, cy = x + box_w / 2.0, y + box_h / 2.0
                if not (px1 <= cx <= px2 and py1 <= cy <= py2):
                    continue
                area_fraction = (box_w * box_h) / image_area
                aspect = box_w / max(box_h, 1)
                if not (0.008 <= area_fraction <= 0.12):
                    continue
                if box_w < 55 or box_h < 45 or not (0.38 <= aspect <= 3.2):
                    continue
                perimeter = cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
                if not (2 <= len(approx) <= 12):
                    continue
                # Favor substantial bounded shapes and keep only a few independent proposals.
                score = area_fraction + (0.015 if 4 <= len(approx) <= 8 else 0.0)
                proposals.append((score, (x, y, box_w, box_h)))

            output: list[bytes] = []
            accepted: list[tuple[int, int, int, int]] = []
            for _, (x, y, box_w, box_h) in sorted(proposals, reverse=True):
                if any(
                    abs(x - ax) < 35 and abs(y - ay) < 35
                    for ax, ay, _, _ in accepted
                ):
                    continue
                pad_x = max(12, int(box_w * 0.18))
                pad_y = max(12, int(box_h * 0.18))
                left, top = max(0, x - pad_x), max(0, y - pad_y)
                right, bottom = min(width, x + box_w + pad_x), min(height, y + box_h + pad_y)
                crop = image.crop((left, top, right, bottom))
                crop.thumbnail((512, 512), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                crop.save(buffer, format="JPEG", quality=88, optimize=True, progressive=False, subsampling=0)
                output.append(buffer.getvalue())
                accepted.append((x, y, box_w, box_h))
                if len(output) >= 3:
                    break
            return output
    except (OSError, ValueError, cv2.error):
        return []


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
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    timeout = min(max(float(settings.patch_color_vision_timeout_seconds or 12.0), 4.0), 15.0)
    regions = _specimen_region_images(front)
    if not regions:
        return None

    prompt = (
        "The canonical trading-card identity is already locked and must not be changed. "
        "This image is either the full card or an overlapping crop from it. "
        "Find only a REAL embedded memorabilia/jersey/patch window: a physical textile/material insert "
        "inside a visible cutout or bounded memorabilia area. Never treat the photographed player uniform, "
        "printed card art, foil, border, logo, text, or background as memorabilia. "
        "If no physical memorabilia window is clearly visible in this crop, reply exactly NO_PATCH. "
        "If a real memorabilia window is visible, inspect only the material inside that window and return "
        "patch_color_count, patch_colors, observation_confidence, uncertainty. "
        "Name every distinct visible physical material color; patch_color_count must equal the number of "
        "unique patch_colors. Team identity is irrelevant to the physical color observation."
    )

    async def inspect_region(
        client: httpx.AsyncClient,
        label: str,
        content: bytes,
    ) -> tuple[str, RawSpecimenVision] | None:
        image = "data:image/jpeg;base64," + base64.b64encode(content).decode("ascii")
        try:
            response = await client.post(
                url,
                headers=headers,
                json={"prompt": prompt, "image": image, "max_tokens": 180, "temperature": 0},
            )
            response.raise_for_status()
            raw_response = (response.json().get("result") or {}).get("response")
            if str(raw_response or "").strip().upper().startswith("NO_PATCH"):
                return None
            raw = _parse_cloudflare_specimen(raw_response)
            if raw.observation_confidence < 0.80:
                return None
            return label, raw
        except (httpx.HTTPError, asyncio.TimeoutError, ValueError, TypeError, KeyError):
            return None

    async with httpx.AsyncClient(timeout=timeout) as client:
        observations = await asyncio.gather(
            *(inspect_region(client, label, content) for label, content in regions)
        )

    candidates = [value for value in observations if value is not None]
    if not candidates:
        # Cloudflare was configured and answered no publishable physical window.
        # Fail closed here instead of paying a potentially wedged local VLM pass.
        return SpecimenAttributes(
            status="uncertain",
            source="post_identity_cloudflare_vision",
            observation_confidence=0.0,
            uncertainty=["no_clear_physical_patch_window"],
            identity_fields_mutated=False,
        )

    # Favor repeatable evidence across overlapping crops. A real memorabilia
    # window should be seen by adjacent regions, while a hallucinated printed
    # uniform detail typically appears in only one crop.
    support: dict[tuple[str, ...], int] = {}
    for _, observation in candidates:
        signature = _color_signature(observation)
        if signature:
            support[signature] = support.get(signature, 0) + 1

    max_count = max(
        int(value[1].patch_color_count or len(value[1].patch_colors) or 0)
        for value in candidates
    )
    leaders = [
        value for value in candidates
        if int(value[1].patch_color_count or len(value[1].patch_colors) or 0) == max_count
    ]
    leader_signatures = {_color_signature(value[1]) for value in leaders}
    corroboration: dict[str, int] = {}

    if len(leader_signatures) > 1:
        verification_prompt = (
            "This is a tight contour crop from a trading card. Reply exactly NO_PATCH unless "
            "you can clearly see a REAL physical textile/material insert inside a bounded cutout/window. "
            "Do not count printed decoration, card art, logos, foil, or the photographed player uniform. "
            "If a real insert is present, return patch_color_count, patch_colors, observation_confidence, "
            "uncertainty. Count only visible material colors."
        )

        async def verify_leader(label: str, observation: RawSpecimenVision) -> tuple[str, int]:
            parent_signature = set(_color_signature(observation))
            crops = _contour_verification_crops(front, label)
            if not crops:
                return label, 0

            async def inspect_crop(client: httpx.AsyncClient, content: bytes) -> RawSpecimenVision | None:
                image = "data:image/jpeg;base64," + base64.b64encode(content).decode("ascii")
                try:
                    response = await client.post(
                        url,
                        headers=headers,
                        json={
                            "prompt": verification_prompt,
                            "image": image,
                            "max_tokens": 140,
                            "temperature": 0,
                        },
                    )
                    response.raise_for_status()
                    raw_response = (response.json().get("result") or {}).get("response")
                    if str(raw_response or "").strip().upper().startswith("NO_PATCH"):
                        return None
                    return _parse_cloudflare_specimen(raw_response)
                except (httpx.HTTPError, asyncio.TimeoutError, ValueError, TypeError, KeyError):
                    return None

            async with httpx.AsyncClient(timeout=timeout) as client:
                checks = await asyncio.gather(*(inspect_crop(client, crop) for crop in crops))
            overlap = 0
            for check in checks:
                if check is None:
                    continue
                overlap = max(overlap, len(parent_signature & set(_color_signature(check))))
            return label, overlap

        verification = await asyncio.gather(
            *(verify_leader(label, observation) for label, observation in leaders)
        )
        corroboration = dict(verification)

    label, raw = max(
        candidates,
        key=lambda item: (
            int(item[1].patch_color_count or len(item[1].patch_colors) or 0),
            corroboration.get(item[0], 0),
            support.get(_color_signature(item[1]), 0),
            float(item[1].observation_confidence or 0),
            0 if item[0] == "full" else 1,
        ),
    )
    result = _build_result(raw, identity)
    uncertainty = list(result.uncertainty)
    if label != "full":
        uncertainty = [value for value in uncertainty if not value.startswith("region:")]
    return result.model_copy(
        update={
            "source": f"post_identity_cloudflare_vision:{label}",
            "uncertainty": uncertainty,
        }
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

    cloudflare = await _cloudflare_specimen_attributes(front, identity, settings)
    if cloudflare is not None:
        return cloudflare

    # Local Ollama is a fail-closed fallback only. One compact front image keeps
    # specimen work bounded and avoids wedged reused VLM workers.
    prepared = [_prepare_specimen_image(front)]
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
