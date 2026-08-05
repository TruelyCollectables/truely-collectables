from __future__ import annotations

import base64
import json
import re
import httpx

from .config import Settings
from .models import CardIdentity, ModelSuggestion, VisualEvidence


SYSTEM_PROMPT = """You are the local vision reader for InstaComp AI™.
Analyze trading-card images conservatively. Return evidence, not certainty.
Never invent a player, set, card number, parallel, serial number, autograph,
or memorabilia claim that is not visibly supported. Use null for unknown fields.
The checklist registry, not this model, will ultimately authorize an exact identity.
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
        "memorabilia": None,
    },
    "evidence": {
        "visible_text": [],
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
            raise ValueError("Local model did not return JSON")
        return json.loads(cleaned[start : end + 1])


class OllamaReader:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.get(f"{self.settings.ollama_base_url.rstrip('/')}/api/tags")
                return response.is_success
        except httpx.HTTPError:
            return False

    async def analyze(self, front: bytes, back: bytes | None) -> ModelSuggestion:
        images = [base64.b64encode(front).decode("ascii")]
        if back:
            images.append(base64.b64encode(back).decode("ascii"))
        prompt = (
            SYSTEM_PROMPT
            + "\nThe first image is the front. The optional second image is the back.\n"
            + "Return this exact structural shape, populated with observed evidence:\n"
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
        async with httpx.AsyncClient(timeout=self.settings.ollama_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/generate",
                json=payload,
            )
            response.raise_for_status()
            envelope = response.json()
        parsed = extract_json(str(envelope.get("response") or ""))
        confidence = float(parsed.get("confidence") or 0)
        if confidence > 1:
            confidence /= 100
        confidence = max(0.0, min(confidence, 1.0))
        return ModelSuggestion(
            provider="ollama",
            model=self.settings.ollama_model,
            identity=CardIdentity.model_validate(parsed.get("identity") or {}),
            evidence=VisualEvidence.model_validate(parsed.get("evidence") or {}),
            confidence=confidence,
            explanation=str(parsed.get("explanation") or "Local visual evidence only."),
            raw={
                "done_reason": envelope.get("done_reason"),
                "total_duration": envelope.get("total_duration"),
                "eval_count": envelope.get("eval_count"),
            },
        )
