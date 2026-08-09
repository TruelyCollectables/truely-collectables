from __future__ import annotations

import base64
import re
from typing import Any

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


def install_lora_candidate_runtime() -> None:
    """Put the validated LoRA candidate ahead of Ollama in the same evidence slot.

    Disabled is the default. Candidate transport/parse failures fall back to the
    exact pre-existing Ollama implementation. A successful candidate suggestion
    never becomes identity authority here; main.py still performs the fresh
    Registry UUID/fingerprint lock and otherwise fails closed.
    """
    from . import ollama as ollama_module

    cls = ollama_module.OllamaReader
    if getattr(cls, "_instacomp_lora_candidate_installed", False):
        return
    original_analyze = cls.analyze

    async def analyze_with_candidate(
        self,
        front: bytes,
        back: bytes | None,
        *,
        local_vision: LocalVisionEvidence | None = None,
    ) -> ModelSuggestion:
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
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            fallback = await original_analyze(
                self,
                front,
                back,
                local_vision=local_vision,
            )
            raw = dict(fallback.raw)
            raw["lora_candidate_fallback"] = True
            raw["lora_candidate_error"] = _safe_error(exc)
            fallback.raw = raw
            return fallback

    cls.analyze = analyze_with_candidate
    cls._instacomp_lora_candidate_installed = True
