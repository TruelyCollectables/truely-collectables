from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import httpx

from .config import settings
from .teacher_comp_learning import load_teacher_comp_receipts

SCHEMA_VERSION = "tcos.instacomp-ai.student-comp-hypothesis.v1"

STUDENT_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "predicted_median": {"type": ["number", "null"]},
        "predicted_low": {"type": ["number", "null"]},
        "predicted_high": {"type": ["number", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "rationale": {"type": "string"},
        "uncertainty": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "predicted_median",
        "predicted_low",
        "predicted_high",
        "confidence",
        "rationale",
        "uncertainty",
    ],
}


def _text(value: object, maximum: int = 500) -> str:
    return str(value or "").strip()[:maximum]


def _money(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed) or parsed <= 0:
        return None
    return round(parsed, 2)


def _confidence(value: object) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(parsed):
        return 0.0
    return max(0.0, min(parsed, 1.0))


def _identity(body: dict[str, Any]) -> dict[str, Any]:
    raw = body.get("canonicalIdentity") or body.get("canonical_identity") or {}
    return raw if isinstance(raw, dict) else {}


def _score_similarity(target: dict[str, Any], candidate: dict[str, Any]) -> int:
    weights = {
        "player": 8,
        "year": 6,
        "brand": 5,
        "setName": 7,
        "cardNumber": 9,
        "parallel": 7,
        "gradingCompany": 5,
        "gradeValue": 5,
        "isAuto": 4,
        "isRelic": 3,
        "isRookie": 2,
    }
    score = 0
    for field, weight in weights.items():
        left = _text(target.get(field), 200).casefold()
        right = _text(candidate.get(field), 200).casefold()
        if left and right and left == right:
            score += weight
    return score


def _trusted_training_memory(path: Path, target: dict[str, Any], limit: int = 8) -> list[dict[str, Any]]:
    rows = load_teacher_comp_receipts(path, limit=2000)
    ranked: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        if row.get("trusted_market_truth") is not True or row.get("student_training_eligible") is not True:
            continue
        receipt = row.get("receipt")
        if not isinstance(receipt, dict):
            continue
        candidate_identity = receipt.get("canonicalIdentity")
        if not isinstance(candidate_identity, dict):
            continue
        trusted_price = _money(receipt.get("trustedSuggestedPrice"))
        if trusted_price is None:
            continue
        similarity = _score_similarity(target, candidate_identity)
        if similarity <= 0:
            continue
        accepted = receipt.get("acceptedSoldComps")
        sold_count = len(accepted) if isinstance(accepted, list) else 0
        ranked.append(
            (
                similarity,
                {
                    "similarity": similarity,
                    "identity": {
                        key: candidate_identity.get(key)
                        for key in (
                            "player",
                            "year",
                            "brand",
                            "setName",
                            "cardNumber",
                            "parallel",
                            "gradingCompany",
                            "gradeValue",
                            "isRookie",
                            "isAuto",
                            "isRelic",
                        )
                    },
                    "trusted_suggested_price": trusted_price,
                    "trusted_sold_count": sold_count,
                },
            )
        )
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in ranked[: max(1, min(limit, 20))]]


def _parse_json_object(value: str) -> dict[str, Any]:
    text = str(value or "").strip().lstrip("\ufeff")
    if text.startswith("```"):
        text = text.replace("```json", "", 1).replace("```", "", 1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("InstaComp student did not return a JSON object.")
    parsed = json.loads(text[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("InstaComp student output must be an object.")
    return parsed


async def build_student_comp_hypothesis(path: Path, body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Student comp request must be an object.")
    identity = _identity(body)
    exact_title = _text(body.get("exactTitle") or body.get("exact_title"), 1000)
    required = ("player", "year", "brand", "setName", "cardNumber")
    missing = [field for field in required if not _text(identity.get(field), 300)]
    if missing:
        raise ValueError("Student comp hypothesis requires exact identity fields: " + ", ".join(missing))

    memory = _trusted_training_memory(path, identity, limit=8)
    prompt = "\n".join(
        [
            "You are InstaComp AI in COMP LEARN MODE. You are the student, not pricing authority.",
            "Make a private pre-teacher hypothesis for this exact sports card using only the trusted training-memory examples supplied below and general learned market patterns.",
            "Do not browse the web. Do not invent a sale, listing URL, sold date, or shipping price. Do not claim your estimate is market truth.",
            "The purpose is calibration: after independent teachers verify real exact sold evidence, your prediction will be compared with the verified result and retained as a training example.",
            "Different parallels, serial denominators, autograph/relic state, and grades can have materially different prices. Be conservative when training memory is sparse.",
            "Return JSON only with predicted_median, predicted_low, predicted_high, confidence, rationale, uncertainty.",
            f"EXACT TITLE: {exact_title}",
            "CANONICAL IDENTITY: " + json.dumps(identity, separators=(",", ":"), ensure_ascii=False),
            "TRUSTED PRIOR COMP MEMORY: " + json.dumps(memory, separators=(",", ":"), ensure_ascii=False),
        ]
    )
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": STUDENT_OUTPUT_SCHEMA,
        "keep_alive": "15m",
        "options": {
            "temperature": 0.0,
            "num_ctx": 8192,
            "num_predict": 700,
            "seed": 0,
        },
    }
    async with httpx.AsyncClient(timeout=settings.ollama_timeout_seconds) as client:
        response = await client.post(
            f"{settings.ollama_base_url.rstrip('/')}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        envelope = response.json()
    parsed = _parse_json_object(str((envelope.get("message") or {}).get("content") or ""))
    median = _money(parsed.get("predicted_median"))
    low = _money(parsed.get("predicted_low"))
    high = _money(parsed.get("predicted_high"))
    if median is not None:
        if low is None or low > median:
            low = median
        if high is None or high < median:
            high = median
    uncertainty = parsed.get("uncertainty")
    uncertainty = [
        _text(value, 300)
        for value in (uncertainty if isinstance(uncertainty, list) else [])
        if _text(value, 300)
    ][:12]
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "student_mode": True,
        "learn_mode": True,
        "pricing_authority": False,
        "market_truth": False,
        "identity_training_mutated": False,
        "model": settings.ollama_model,
        "training_memory_examples": len(memory),
        "hypothesis": {
            "predictedMedian": median,
            "predictedLow": low,
            "predictedHigh": high,
            "confidence": _confidence(parsed.get("confidence")),
            "rationale": _text(parsed.get("rationale"), 1800),
            "uncertainty": uncertainty,
        },
    }
