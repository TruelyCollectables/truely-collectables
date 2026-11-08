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


def _trusted_style_memory_support(
    local_vision: LocalVisionEvidence,
    required_label: str,
) -> bool:
    pattern = local_vision.front.pattern
    try:
        score = float(pattern.scores.get("trusted_style_memory", 0) or 0)
    except (TypeError, ValueError):
        score = 0.0
    hints = getattr(local_vision, "identity_hints", None)
    hint = str(getattr(hints, "parallel", None) or "").strip().casefold()
    if score < 0.90:
        return False
    if required_label == "cracked_ice":
        return "cracked" in hint and "ice" in hint
    if required_label == "velocity":
        return "velocity" in hint
    return False


def _pattern_parallel_supported(
    parallel: str,
    local_vision: LocalVisionEvidence | None,
) -> bool:
    """Require discriminative surface evidence before filtering Registry by pattern.

    The failed Mac receipt exposed a false Cracked Ice label on Rickea Base with
    359 polygon candidates against the detector's capped 300 long-line segments.
    Verified Frozen Five Ice examples remain below that over-segmentation boundary
    while still carrying irregular, high-entropy multi-angle surface geometry.

    A Cracked Ice claim therefore needs either a direct deterministic label or a
    reinforced trusted-style hint *and* must pass the independent geometry sanity
    checks. Velocity remains a directional pattern and still requires diagonal
    geometry. These rules only authorize use of a parallel as Registry evidence;
    failure removes the parallel rather than asserting Base.
    """
    lowered = str(parallel or "").strip().casefold()
    if not lowered:
        return True

    required_label: str | None = None
    if "cracked" in lowered and "ice" in lowered:
        required_label = "cracked_ice"
    elif "velocity" in lowered:
        required_label = "velocity"
    if required_label is None:
        return True
    if local_vision is None:
        return False

    pattern = local_vision.front.pattern
    label = str(pattern.label or "").strip().casefold()
    try:
        confidence = float(pattern.confidence or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    geometry = [str(value or "").strip().casefold() for value in pattern.geometry]
    line_count = int(pattern.line_count or 0)
    polygon_count = int(pattern.polygon_count or 0)

    has_directional_diagonal = any(
        "directional diagonal line geometry" in value for value in geometry
    )
    has_irregular_polygons = (
        polygon_count >= 12
        or any("irregular polygon" in value for value in geometry)
    )
    has_multi_angle_geometry = (
        float(pattern.angle_entropy or 0) >= 0.72
        or any("non-directional multi-angle edge geometry" in value for value in geometry)
    )
    # Hough lines are capped at 300. A polygon count materially beyond the
    # available line structure is the exact over-segmentation signature in the
    # failed Rickea Mac receipt. For small samples, keep a floor equal to the
    # detector's polygon scoring saturation point instead of dividing by noise.
    not_oversegmented = polygon_count <= max(line_count, 48)
    direct_support = label == required_label and confidence >= 0.70
    memory_support = _trusted_style_memory_support(local_vision, required_label)

    if required_label == "cracked_ice":
        return bool(
            has_irregular_polygons
            and has_multi_angle_geometry
            and not_oversegmented
            and (direct_support or memory_support)
        )

    return bool(
        has_directional_diagonal
        and (direct_support or memory_support)
    )


def _guard_model_pattern_parallel(
    parsed: dict[str, Any],
    local_vision: LocalVisionEvidence | None,
) -> dict[str, Any]:
    """Strip unsupported Cracked Ice/Velocity from the final Registry candidate.

    This guard is intentionally shape-tolerant. It accepts either the normalized
    nested ``identity`` object or a flat sidecar payload, because the real MLX
    sidecar has emitted both shapes during promotion work.
    """
    root = dict(parsed)
    identity_source = root.get("identity")
    nested = isinstance(identity_source, dict)
    identity = dict(identity_source) if nested else dict(root)
    parallel = str(identity.get("parallel") or "").strip()
    if not parallel or _pattern_parallel_supported(parallel, local_vision):
        return root

    identity["parallel"] = None
    if nested:
        root["identity"] = identity
    else:
        root["parallel"] = None
    return root


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

    # Normalize before merging so a flat MLX sidecar response is promoted into
    # the canonical nested identity shape instead of losing player/card/release
    # fields inside merge_local_vision_payload. Then guard *after* the local merge
    # so a bad deterministic parallel hint cannot re-inject what the model guard
    # removed. The guarded object is exactly what proceeds to Registry.
    normalized_input = normalize_identity_payload(parsed)
    merged = merge_local_vision_payload(normalized_input, local_vision)
    normalized = normalize_identity_payload(merged)
    normalized = _guard_model_pattern_parallel(normalized, local_vision)
    normalized = normalize_identity_payload(normalized)

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
            "pattern_parallel_requires_deterministic_support": True,
            "pattern_parallel_guard_stage": "post_normalization_post_local_merge",
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
