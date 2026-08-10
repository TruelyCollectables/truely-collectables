from __future__ import annotations

import base64
import re
from typing import Any, Awaitable, Callable

import httpx

from .models import CardIdentity, LocalVisionEvidence, ModelSuggestion, VisualEvidence


def _safe_error(value: object, limit: int = 240) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"[^A-Za-z0-9 .,:;_\-/()\[\]{}'\"=]+", "?", text)
    return text[:limit]


def _candidate_core_usable(identity: CardIdentity) -> bool:
    """Require enough evidence to justify a Registry lookup.

    A partially parsed LoRA answer is not an excuse to fish the Registry for a
    match. If the candidate cannot at least name the player and card number plus
    one release/product clue, fall back to the established Ollama reader.
    """
    return bool(
        identity.player
        and identity.card_number
        and (identity.year or identity.manufacturer or identity.brand or identity.set_name)
    )


def _candidate_response_to_suggestion(
    payload: dict[str, Any],
    *,
    local_vision: LocalVisionEvidence | None,
) -> ModelSuggestion:
    from .ollama import merge_local_vision_payload, normalize_identity_payload

    if payload.get("ok") is not True:
        raise ValueError("LoRA candidate sidecar did not return ok=true")
    if payload.get("validation_eligible") is not True:
        raise ValueError("LoRA candidate sidecar is not backed by a passed validation receipt")
    parsed = payload.get("parsed")
    if not isinstance(parsed, dict):
        raise ValueError("LoRA candidate did not return a structured JSON object")

    # Training answers also contain checklist_identity_id/fingerprint fields.
    # Those are deliberately ignored here. Runtime identity authority comes
    # only from a fresh central Registry lookup performed by the main pipeline.
    normalized = normalize_identity_payload(
        merge_local_vision_payload(parsed, local_vision)
    )
    identity = CardIdentity.model_validate(normalized.get("identity") or {})
    if not _candidate_core_usable(identity):
        raise ValueError("LoRA candidate did not return enough core identity evidence")
    evidence = VisualEvidence.model_validate(normalized.get("evidence") or {})
    model_name = str(payload.get("model") or "mlx-community/Qwen3-VL-2B-Instruct-4bit")
    adapter_name = str(payload.get("adapter_name") or "validated-local-adapter")
    return ModelSuggestion(
        provider="instacomp_lora_candidate",
        model=f"{model_name}+{adapter_name}",
        identity=identity,
        evidence=evidence,
        confidence=0.0,
        explanation=(
            "Validated InstaComp LoRA candidate supplied visual evidence only. "
            "A fresh Checklist Registry exact match is still required before identity or pricing is trusted."
        ),
        raw={
            "role": "candidate_evidence_reader",
            "transport": "localhost_mlx_vlm_sidecar",
            "adapter_name": adapter_name,
            "adapter_weights_sha256": payload.get("adapter_weights_sha256"),
            "validation_receipt": payload.get("validation_receipt"),
            "validation_eligible": True,
            "candidate_checklist_fields_ignored": True,
            "pipeline_slot": "local_model_fallback",
        },
    )


async def _analyze_candidate(
    settings,
    front: bytes,
    back: bytes | None,
    *,
    local_vision: LocalVisionEvidence | None,
) -> ModelSuggestion:
    body = {
        "front_base64": base64.b64encode(front).decode("ascii"),
        "back_base64": base64.b64encode(back).decode("ascii") if back else None,
        "deterministic_evidence": (
            local_vision.model_dump(mode="json") if local_vision else None
        ),
    }
    async with httpx.AsyncClient(timeout=settings.lora_candidate_timeout_seconds) as client:
        response = await client.post(
            f"{settings.lora_candidate_url.rstrip('/')}/analyze",
            json=body,
        )
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("LoRA candidate sidecar returned a non-object response")
    return _candidate_response_to_suggestion(payload, local_vision=local_vision)


def _fallback_with_candidate_receipt(
    fallback: ModelSuggestion,
    error: Exception,
) -> ModelSuggestion:
    """Return the established reader result without mutating it in place."""
    raw = dict(fallback.raw)
    raw["lora_candidate_fallback"] = True
    raw["lora_candidate_error"] = _safe_error(error)
    raw["lora_candidate_error_type"] = type(error).__name__[:80]
    return fallback.model_copy(update={"raw": raw})


async def _analyze_with_candidate_fallback(
    self,
    original_analyze: Callable[..., Awaitable[ModelSuggestion]],
    front: bytes,
    back: bytes | None,
    *,
    local_vision: LocalVisionEvidence | None = None,
) -> ModelSuggestion:
    """Run candidate evidence first, but never let its ordinary failures own scan uptime."""
    if not getattr(self.settings, "lora_candidate_enabled", False):
        return await original_analyze(
            self,
            front,
            back,
            local_vision=local_vision,
        )
    try:
        return await _analyze_candidate(
            self.settings,
            front,
            back,
            local_vision=local_vision,
        )
    except Exception as exc:
        # The LoRA candidate is evidence-only. Any ordinary candidate-side
        # exception must fall back to the exact established reader rather than
        # escaping to FastAPI as HTTP 500. BaseException remains uncaught.
        fallback = await original_analyze(
            self,
            front,
            back,
            local_vision=local_vision,
        )
        return _fallback_with_candidate_receipt(fallback, exc)


async def analyze_with_established_reader(
    reader,
    front: bytes,
    back: bytes | None,
    *,
    local_vision: LocalVisionEvidence | None = None,
) -> ModelSuggestion:
    """Run the established Ollama reader independently of the LoRA wrapper.

    This is evidence-only and exists so an escalated scanner council can obtain
    a genuinely separate local model read while website/cloud identity readers
    remain disabled. The caller must still apply Registry and consensus gates.
    """
    original = getattr(type(reader), "_instacomp_established_analyze", None)
    if not callable(original):
        raise RuntimeError("Established InstaComp Ollama reader is unavailable")
    return await original(
        reader,
        front,
        back,
        local_vision=local_vision,
    )


def install_lora_candidate_runtime() -> None:
    """Put the validated LoRA candidate ahead of Ollama in the same evidence slot.

    Disabled is the default. Any ordinary candidate-side runtime failure falls
    back to the exact pre-existing Ollama implementation. A successful candidate
    suggestion never becomes identity authority here; main.py still performs the
    fresh Registry UUID/fingerprint lock and otherwise fails closed.
    """
    from . import ollama as ollama_module

    cls = ollama_module.OllamaReader
    if getattr(cls, "_instacomp_lora_candidate_installed", False):
        return
    original_analyze = cls.analyze
    cls._instacomp_established_analyze = original_analyze

    async def analyze_with_candidate(
        self,
        front: bytes,
        back: bytes | None,
        *,
        local_vision: LocalVisionEvidence | None = None,
    ) -> ModelSuggestion:
        return await _analyze_with_candidate_fallback(
            self,
            original_analyze,
            front,
            back,
            local_vision=local_vision,
        )

    cls.analyze = analyze_with_candidate
    cls._instacomp_lora_candidate_installed = True
