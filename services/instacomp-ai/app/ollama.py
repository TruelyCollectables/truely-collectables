from __future__ import annotations

import ast
import base64
import io
import json
import math
import re

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from .config import Settings
from .models import CardIdentity, LocalVisionEvidence, ModelSuggestion, VisualEvidence


SYSTEM_PROMPT = """You are the local backup vision reader for InstaComp AI™.
The internal trusted image/text memory and Checklist Registry have already been checked. Analyze the front and back of one trading card together only because the internal engine did not yet know this card.
Return visible evidence and a conservative identity suggestion that can be verified against the Checklist Registry and then taught to InstaComp.
Never invent a player, set, card number, parallel, print run, autograph, inscription, or memorabilia claim that is not visibly supported. Use null for unknown fields.

Critical rules:
- The first image is the FRONT and the optional second image is the BACK.
- Transcribe front-only printed text into front_visible_text and back-only printed text into back_visible_text. Never copy front text into back_visible_text.
- The back-visible-text field is the decisive evidence for printed back markers such as PRIZM and serial numbering.
- Read player, team, year, manufacturer/product, card number, rookie mark, autograph, inscription, memorabilia, and serial-number evidence from both sides.
- serial_number may contain the exact visible copy stamp such as 017/299, but serial_run must contain only the denominator as an integer, such as 299.
- An autograph is not an inscription. Set inscription true only when handwriting contains extra words, a phrase, date, nickname, statistic, or message beyond the signature itself. Copy the visible phrase into inscription_text when readable.
- memorabilia means a relic, patch, jersey, bat, puck, ball, or other embedded material. Put the material description in memorabilia_type when visible.
- Autograph, inscription, memorabilia, and serial numbering may occur in any combination. Report each independently.
- The word PRIZM on the back is useful positive evidence, but its absence is not proof of Base. Never force Base solely because OCR missed PRIZM.
- Use deterministic Apple Vision OCR, OpenCV color/pattern measurements, visible serial evidence, and Checklist Registry candidates together.
- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence and must ultimately be locked by the Registry.
- Blue Velocity Prizm has a directional speed pattern: dense repeating diagonal lines, slashes, chevrons, or criss-cross velocity streaks. Call it Blue Velocity Prizm, never Blue Cracked Ice.
- Blue Cracked Ice Prizm has irregular polygonal shattered-ice or broken-glass facets. Do not call a card Cracked Ice from blue color, sparkle, or diagonal lines alone.
- When Velocity and Cracked Ice are the two candidates, describe the observed surface geometry in foil_or_pattern and choose the name supported by that geometry.
- The Checklist Registry locks the final exact identity. This backup reader supplies evidence only.
Return one JSON object only.
"""

JSON_SHAPE = {
    "identity": {
        "sport": None,
        "league": None,
        "year": None,
        "manufacturer": None,
        "brand": None,
        "set_name": None,
        "subset": None,
        "player": None,
        "team": None,
        "card_number": None,
        "parallel": None,
        "variation": None,
        "serial_number": None,
        "serial_run": None,
        "rookie": None,
        "autograph": None,
        "inscription": None,
        "inscription_text": None,
        "memorabilia": None,
        "memorabilia_type": None,
    },
    "evidence": {
        "visible_text": [],
        "front_visible_text": [],
        "back_visible_text": [],
        "logos": [],
        "colors": [],
        "foil_or_pattern": [],
        "front_notes": [],
        "back_notes": [],
        "uncertainty": [],
    },
    "confidence": 0.0,
    "explanation": "",
}


class OllamaStructuredSuggestion(BaseModel):
    identity: CardIdentity = Field(default_factory=CardIdentity)
    evidence: VisualEvidence = Field(default_factory=VisualEvidence)
    confidence: float = Field(default=0.0, ge=0, le=1)
    explanation: str = ""


OLLAMA_OUTPUT_SCHEMA = OllamaStructuredSuggestion.model_json_schema()
OLLAMA_MAX_EDGE = 1280


def prepare_ollama_image(content: bytes) -> bytes:
    """Create a compact baseline JPEG that Ollama vision can decode reliably."""
    if not content:
        raise ValueError("Ollama image is empty")
    try:
        with Image.open(io.BytesIO(content)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((OLLAMA_MAX_EDGE, OLLAMA_MAX_EDGE), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(
                output,
                format="JPEG",
                quality=84,
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            prepared = output.getvalue()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Ollama image could not be decoded") from exc
    if not prepared:
        raise ValueError("Ollama image preparation produced no bytes")
    return prepared


def _balanced_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def extract_json(text: str) -> dict:
    cleaned = str(text or "").strip().lstrip("\ufeff")
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    candidates = [cleaned]
    balanced = _balanced_json_object(cleaned)
    if balanced and balanced not in candidates:
        candidates.append(balanced)

    for candidate in candidates:
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass

        repaired = re.sub(r",\s*([}\]])", r"\1", candidate)
        repaired = repaired.replace("“", '"').replace("”", '"').replace("’", "'")
        try:
            value = json.loads(repaired)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass

        try:
            value = ast.literal_eval(repaired)
            if isinstance(value, dict):
                return value
        except (SyntaxError, ValueError):
            pass

    raise ValueError("Local backup model did not return valid JSON")


def _surface_text(value: object) -> str:
    if isinstance(value, list):
        return " ".join(_surface_text(item) for item in value)
    if isinstance(value, dict):
        return " ".join(_surface_text(item) for item in value.values())
    return str(value or "")


def normalize_prizm_surface_parallel(
    identity: dict,
    evidence: dict,
    explanation: str = "",
) -> dict:
    normalized = dict(identity)
    parallel = str(normalized.get("parallel") or "").strip()
    if not parallel:
        return normalized

    context = " ".join(
        [
            parallel,
            str(normalized.get("set_name") or ""),
            str(normalized.get("brand") or ""),
            _surface_text(evidence),
            explanation,
        ]
    ).lower()
    if "prizm" not in context:
        return normalized

    explicit_velocity = bool(re.search(r"\bvelocity\b", context))
    directional_velocity = bool(
        re.search(
            r"\b(?:dense|repeating|directional|angled)?\s*(?:diagonal|chevron|speed[- ]?line|criss[- ]?cross|cross[- ]?hatch)(?:\s+(?:line|lines|slash|slashes|streak|streaks|pattern))?\b",
            context,
        )
    )
    strong_cracked_ice = bool(
        re.search(
            r"\b(?:irregular\s+polygon|polygonal|shattered[- ]?(?:ice|glass)|broken[- ]?glass|ice[- ]?shard|faceted[- ]?(?:ice|crystal))\b",
            context,
        )
    )
    weak_cracked_ice = bool(re.search(r"\bcracked[- ]?ice\b", context))

    color = "Blue" if "blue" in context else ""
    velocity_supported = explicit_velocity or directional_velocity
    cracked_supported = strong_cracked_ice or (
        weak_cracked_ice and not directional_velocity
    )

    if velocity_supported and not strong_cracked_ice:
        if re.search(r"cracked[- ]?ice|\bblue\s+prizm\b|\bvelocity\b", parallel, re.I):
            normalized["parallel"] = f"{color + ' ' if color else ''}Velocity Prizm"
    elif cracked_supported and not velocity_supported and re.search(
        r"velocity|\bblue\s+prizm\b",
        parallel,
        re.I,
    ):
        normalized["parallel"] = f"{color + ' ' if color else ''}Cracked Ice Prizm"

    return normalized


TEXT_IDENTITY_FIELDS = [
    "sport", "league", "year", "manufacturer", "brand", "set_name",
    "subset", "player", "team", "card_number", "parallel", "variation",
    "serial_number", "inscription_text", "memorabilia_type",
]

IDENTITY_ALIASES = {
    "setName": "set_name", "cardNumber": "card_number",
    "serialNumber": "serial_number", "serialRun": "serial_run",
    "inscriptionText": "inscription_text", "memorabiliaType": "memorabilia_type",
    "isRookie": "rookie", "isAuto": "autograph", "isAutograph": "autograph",
    "isInscribed": "inscription", "isRelic": "memorabilia",
}

EVIDENCE_ALIASES = {
    "visibleText": "visible_text", "frontVisibleText": "front_visible_text",
    "backVisibleText": "back_visible_text", "foilOrPattern": "foil_or_pattern",
    "frontNotes": "front_notes", "backNotes": "back_notes",
}


def _as_mapping(value: object) -> dict:
    return dict(value) if isinstance(value, dict) else {}


def _as_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "yes", "y", "1", "present"}:
        return True
    if text in {"false", "no", "n", "0", "none", "null", "absent", ""}:
        return False
    return None


def _as_text_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        items = list(value.values())
    elif isinstance(value, (list, tuple, set)):
        items = list(value)
    else:
        items = [value]
    normalized: list[str] = []
    for item in items:
        if isinstance(item, (list, tuple, set)):
            normalized.extend(_as_text_list(item))
            continue
        text = str(item).strip()
        if text and text not in normalized:
            normalized.append(text)
    return normalized


def normalize_confidence(value: object) -> float:
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return 0.0
    text = str(value).strip()
    percent = text.endswith("%")
    if percent:
        text = text[:-1].strip()
    try:
        confidence = float(text or 0)
    except (TypeError, ValueError):
        return 0.0
    if percent or confidence > 1:
        confidence /= 100
    return max(0.0, min(confidence, 1.0))


def normalize_identity_payload(payload: object) -> dict:
    root = _as_mapping(payload)
    identity_source = _as_mapping(root.get("identity")) or root
    for alias, canonical in IDENTITY_ALIASES.items():
        if canonical not in identity_source and alias in identity_source:
            identity_source[canonical] = identity_source.get(alias)

    identity: dict = {
        field: _as_optional_text(identity_source.get(field))
        for field in TEXT_IDENTITY_FIELDS
    }
    serial_number = identity.get("serial_number") or ""
    serial_run = identity_source.get("serial_run")
    if not serial_run and serial_number:
        match = re.search(r"/\s*(\d{1,6})\b", serial_number)
        if match:
            serial_run = int(match.group(1))
    try:
        identity["serial_run"] = int(serial_run) if serial_run is not None else None
    except (TypeError, ValueError):
        identity["serial_run"] = None
    for field in ["rookie", "autograph", "inscription", "memorabilia"]:
        identity[field] = _as_optional_bool(identity_source.get(field))

    evidence_source = _as_mapping(root.get("evidence"))
    for alias, canonical in EVIDENCE_ALIASES.items():
        if canonical not in evidence_source and alias in evidence_source:
            evidence_source[canonical] = evidence_source.get(alias)
    evidence = {
        field: _as_text_list(evidence_source.get(field))
        for field in [
            "visible_text", "front_visible_text", "back_visible_text", "logos",
            "colors", "foil_or_pattern", "front_notes", "back_notes", "uncertainty",
        ]
    }

    root["evidence"] = evidence
    root["identity"] = normalize_prizm_surface_parallel(
        identity, evidence, str(root.get("explanation") or "")
    )
    root["confidence"] = normalize_confidence(root.get("confidence"))
    root["explanation"] = str(
        root.get("explanation") or "Local backup visual evidence only."
    ).strip()
    return root


def _finite_float(value: object, default: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    return numeric if math.isfinite(numeric) else default


def _compact_ocr(observations: list, limit: int = 40) -> list[dict]:
    compact: list[dict] = []
    seen: set[str] = set()
    for observation in observations:
        text = re.sub(r"\s+", " ", str(observation.text or "")).strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        compact.append(
            {
                "text": text[:120],
                "confidence": round(_finite_float(observation.confidence), 3),
            }
        )
        if len(compact) >= limit:
            break
    return compact


def _compact_colors(colors) -> dict:
    ranked = sorted(
        (
            (str(name), _finite_float(score))
            for name, score in colors.proportions.items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:8]
    return {
        "dominant_colors": list(colors.dominant_colors[:8]),
        "proportions": {name: round(score, 4) for name, score in ranked},
        "mean_saturation": round(_finite_float(colors.mean_saturation), 4),
        "mean_brightness": round(_finite_float(colors.mean_brightness), 4),
        "metallic_score": round(_finite_float(colors.metallic_score), 4),
    }


def _compact_pattern(pattern) -> dict:
    ranked = sorted(
        (
            (str(name), _finite_float(score))
            for name, score in pattern.scores.items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:8]
    return {
        "label": pattern.label,
        "confidence": round(_finite_float(pattern.confidence), 4),
        "scores": {name: round(score, 4) for name, score in ranked},
        "geometry": list(pattern.geometry[:12]),
        "line_count": int(pattern.line_count),
        "polygon_count": int(pattern.polygon_count),
        "edge_density": round(_finite_float(pattern.edge_density), 4),
        "dominant_angle": (
            round(_finite_float(pattern.dominant_angle), 2)
            if pattern.dominant_angle is not None
            else None
        ),
        "angle_concentration": round(_finite_float(pattern.angle_concentration), 4),
        "angle_entropy": round(_finite_float(pattern.angle_entropy), 4),
    }


def _compact_side(side) -> dict:
    return {
        "ocr": _compact_ocr(side.ocr),
        "colors": _compact_colors(side.colors),
        "pattern": _compact_pattern(side.pattern),
        "errors": list(side.errors[:8]),
    }


def local_vision_prompt_payload(local_vision: LocalVisionEvidence | None) -> dict | None:
    """Return a bounded reasoning digest while preserving full evidence in storage.

    Bounding boxes and every raw OpenCV metric belong in the scan/training record,
    not in the Ollama prompt. Sending the full evidence object can exceed Qwen's
    configured context and make Ollama reject the request with HTTP 400.
    """
    if local_vision is None:
        return None
    return {
        "identity_hints": local_vision.identity_hints.model_dump(mode="json"),
        "serial": local_vision.serial.model_dump(mode="json", exclude={"box"}),
        "front": _compact_side(local_vision.front),
        "back": _compact_side(local_vision.back) if local_vision.back else None,
    }


def merge_local_vision_payload(payload: dict, local_vision: LocalVisionEvidence | None) -> dict:
    if local_vision is None:
        return payload
    root = dict(payload)
    identity = dict(root.get("identity") or {})
    hints = local_vision.identity_hints.model_dump(mode="json")
    hard_fields = {"year", "manufacturer", "set_name", "card_number"}
    for field, value in hints.items():
        if value in {None, ""}:
            continue
        if field in hard_fields or identity.get(field) in {None, ""}:
            identity[field] = value
    # Surface geometry is deterministic evidence. If it produced a parallel hint,
    # it outranks a free-form model guess. Otherwise do not let dominant image
    # color masquerade as a checklist parallel.
    if hints.get("parallel"):
        identity["parallel"] = hints["parallel"]
    elif identity.get("parallel") and re.search(
        r"^(?:white|black|red|blue|green|gold|orange|purple|pink|silver)\s+prizm$",
        str(identity.get("parallel")),
        re.I,
    ):
        identity["parallel"] = None
    if local_vision.serial.stamp_present and local_vision.serial.exact_stamp:
        identity["serial_number"] = local_vision.serial.exact_stamp
        identity["serial_run"] = local_vision.serial.visible_denominator
    else:
        # A checklist print run is not a visible physical copy stamp. Never keep a
        # model-invented numerator/denominator when deterministic OCR saw no stamp.
        identity["serial_number"] = None
        identity["serial_run"] = None
    evidence = dict(root.get("evidence") or {})
    front_text = [value.text for value in local_vision.front.ocr]
    back_text = [value.text for value in local_vision.back.ocr] if local_vision.back else []
    evidence["front_visible_text"] = list(dict.fromkeys([*(evidence.get("front_visible_text") or []), *front_text]))
    evidence["back_visible_text"] = list(dict.fromkeys([*(evidence.get("back_visible_text") or []), *back_text]))
    evidence["visible_text"] = list(dict.fromkeys([*(evidence.get("visible_text") or []), *front_text, *back_text]))
    evidence["colors"] = list(dict.fromkeys([
        *(evidence.get("colors") or []),
        *local_vision.front.colors.dominant_colors,
        *(local_vision.back.colors.dominant_colors if local_vision.back else []),
    ]))
    evidence["foil_or_pattern"] = list(dict.fromkeys([
        *(evidence.get("foil_or_pattern") or []),
        local_vision.front.pattern.label,
        *local_vision.front.pattern.geometry,
    ]))
    root["identity"] = identity
    root["evidence"] = evidence
    return root


class OllamaReader:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.get(
                    f"{self.settings.ollama_base_url.rstrip('/')}/api/tags"
                )
                return response.is_success
        except httpx.HTTPError:
            return False

    async def analyze(
        self,
        front: bytes,
        back: bytes | None,
        *,
        local_vision: LocalVisionEvidence | None = None,
    ) -> ModelSuggestion:
        prepared_images = [prepare_ollama_image(front)]
        if back:
            prepared_images.append(prepare_ollama_image(back))
        images = [base64.b64encode(image).decode("ascii") for image in prepared_images]
        evidence_digest = local_vision_prompt_payload(local_vision)
        prompt = (
            SYSTEM_PROMPT
            + "\nReturn only one JSON object matching the requested structured-output schema. "
            + "Use null or empty arrays for unknown values."
        )
        if evidence_digest is not None:
            prompt += (
                "\nDeterministic local evidence digest. Full OCR boxes and raw measurements "
                "remain stored for training; this bounded digest is for reasoning only. "
                "Trust serial parsing, OCR text, colors, and measured geometry over visual guessing:\n"
                + json.dumps(
                    evidence_digest,
                    separators=(",", ":"),
                    ensure_ascii=False,
                    allow_nan=False,
                )
            )
        payload = {
            "model": self.settings.ollama_model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": images,
                }
            ],
            "stream": False,
            "format": OLLAMA_OUTPUT_SCHEMA,
            "keep_alive": "15m",
            "options": {
                "temperature": 0.0,
                "num_ctx": 8192,
                "num_predict": 2048,
                "seed": 0,
            },
        }
        async with httpx.AsyncClient(
            timeout=self.settings.ollama_timeout_seconds
        ) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            envelope = response.json()
        message = envelope.get("message") or {}
        parsed = normalize_identity_payload(
            merge_local_vision_payload(
                extract_json(str(message.get("content") or "")),
                local_vision,
            )
        )
        structured = OllamaStructuredSuggestion.model_validate(parsed)
        return ModelSuggestion(
            provider="instacomp_ollama_backup",
            model=self.settings.ollama_model,
            identity=structured.identity,
            evidence=structured.evidence,
            confidence=structured.confidence,
            explanation=(
                structured.explanation or "Local backup visual evidence only."
            ),
            raw={
                "role": "backup_reader",
                "transport": "ollama_chat_structured_output",
                "done_reason": envelope.get("done_reason"),
                "total_duration": envelope.get("total_duration"),
                "eval_count": envelope.get("eval_count"),
                "prepared_image_count": len(prepared_images),
                "prepared_image_bytes": [len(image) for image in prepared_images],
                "deterministic_local_evidence": local_vision is not None,
                "prompt_chars": len(prompt),
                "evidence_digest_chars": (
                    len(json.dumps(evidence_digest, ensure_ascii=False, allow_nan=False))
                    if evidence_digest is not None
                    else 0
                ),
            },
        )
