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


def normalize_identity_payload(payload: dict) -> dict:
    identity = dict(payload.get("identity") or {})
    serial_number = str(identity.get("serial_number") or "").strip()
    serial_run = identity.get("serial_run")
    if not serial_run and serial_number:
        match = re.search(r"/\s*(\d{1,6})\b", serial_number)
        if match:
            serial_run = int(match.group(1))
    if serial_run is not None:
        try:
            identity["serial_run"] = int(serial_run)
        except (TypeError, ValueError):
            identity["serial_run"] = None
    identity["inscription_text"] = (
        str(identity.get("inscription_text") or "").strip() or None
    )
    identity["memorabilia_type"] = (
        str(identity.get("memorabilia_type") or "").strip() or None
    )
    evidence = dict(payload.get("evidence") or {})
    for field in [
        "visible_text",
        "front_visible_text",
        "back_visible_text",
        "colors",
        "foil_or_pattern",
        "front_notes",
        "back_notes",
        "uncertainty",
    ]:
        value = evidence.get(field)
        evidence[field] = [
            str(item).strip()
            for item in (value if isinstance(value, list) else [])
            if str(item).strip()
        ]
    payload["evidence"] = evidence
    payload["identity"] = normalize_prizm_surface_parallel(
        identity,
        evidence,
        str(payload.get("explanation") or ""),
    )
    return payload


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
        confidence = float(parsed.get("confidence") or 0)
        if confidence > 1:
            confidence /= 100
        confidence = max(0.0, min(confidence, 1.0))
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
