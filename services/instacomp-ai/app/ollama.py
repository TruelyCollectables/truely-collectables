from __future__ import annotations

import base64
import json
import re

import httpx

from .config import Settings
from .models import CardIdentity, ModelSuggestion, VisualEvidence


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
- For Panini Prizm WNBA and Panini Select WNBA, the word PRIZM in back_visible_text is the printed proof that a Prizm parallel exists. If the back does not say PRIZM, return parallel Base even when the front has a colored design. Do not remove Prizm or Select from the product/set name.
- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence plus PRIZM in back_visible_text.
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


def extract_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Local backup model did not return JSON")
        return json.loads(cleaned[start : end + 1])


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

    async def analyze(self, front: bytes, back: bytes | None) -> ModelSuggestion:
        images = [base64.b64encode(front).decode("ascii")]
        if back:
            images.append(base64.b64encode(back).decode("ascii"))
        prompt = (
            SYSTEM_PROMPT
            + "\nReturn this exact structural shape, populated with observed evidence:\n"
            + json.dumps(JSON_SHAPE)
        )
        payload = {
            "model": self.settings.ollama_model,
            "prompt": prompt,
            "images": images,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.0},
        }
        async with httpx.AsyncClient(
            timeout=self.settings.ollama_timeout_seconds
        ) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/generate",
                json=payload,
            )
            response.raise_for_status()
            envelope = response.json()
        parsed = normalize_identity_payload(
            extract_json(str(envelope.get("response") or ""))
        )
        confidence = normalize_confidence(parsed.get("confidence"))
        return ModelSuggestion(
            provider="instacomp_ollama_backup",
            model=self.settings.ollama_model,
            identity=CardIdentity.model_validate(parsed.get("identity") or {}),
            evidence=VisualEvidence.model_validate(parsed.get("evidence") or {}),
            confidence=confidence,
            explanation=str(
                parsed.get("explanation") or "Local backup visual evidence only."
            ),
            raw={
                "role": "backup_reader",
                "done_reason": envelope.get("done_reason"),
                "total_duration": envelope.get("total_duration"),
                "eval_count": envelope.get("eval_count"),
            },
        )
