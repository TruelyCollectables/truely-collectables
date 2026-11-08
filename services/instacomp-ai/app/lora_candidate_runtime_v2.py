from __future__ import annotations

import base64
from typing import Any

import httpx

from . import lora_candidate_runtime as legacy
from .models import LocalVisionEvidence, ModelSuggestion
from .ollama import local_vision_prompt_payload, prepare_ollama_image


CANDIDATE_TRANSPORT_SCHEMA = "tcos.instacomp-ai.lora-candidate-transport.v2"


def _candidate_request_body(
    front: bytes,
    back: bytes | None,
    *,
    local_vision: LocalVisionEvidence | None,
) -> dict[str, Any]:
    """Build a bounded candidate request without discarding local evidence.

    The v1 transport sent original full-resolution images plus the complete
    LocalVisionEvidence model (including every OCR box/raw metric) to the MLX
    sidecar. Expansion cards can contain much more OCR and larger source images
    than the original Frozen Five, so that request shape can turn an otherwise
    valid candidate into a timeout/body/context failure.

    Reuse the already-proven local-reader transport policy: compact each image to
    a decode-safe 1280px JPEG and send only the bounded deterministic reasoning
    digest. The full LocalVisionEvidence object still stays in this process and is
    merged back into the candidate suggestion after the sidecar responds, so no
    evidence is lost and Registry remains the only identity authority.
    """
    prepared_front = prepare_ollama_image(front)
    prepared_back = prepare_ollama_image(back) if back else None
    return {
        "front_base64": base64.b64encode(prepared_front).decode("ascii"),
        "back_base64": (
            base64.b64encode(prepared_back).decode("ascii")
            if prepared_back is not None
            else None
        ),
        "deterministic_evidence": local_vision_prompt_payload(local_vision),
        "transport_schema": CANDIDATE_TRANSPORT_SCHEMA,
    }


def _sidecar_failure(response: httpx.Response) -> RuntimeError:
    error = "candidate_sidecar_error"
    detail = ""
    try:
        payload = response.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        error = str(payload.get("error") or error)
        detail = str(payload.get("detail") or payload.get("error_type") or "")
    elif response.text:
        detail = response.text
    safe_error = legacy._safe_error(error, 120)
    safe_detail = legacy._safe_error(detail, 240)
    suffix = f" detail={safe_detail}" if safe_detail else ""
    return RuntimeError(
        f"LoRA candidate sidecar HTTP {response.status_code} error={safe_error}{suffix}"
    )


async def _analyze_candidate_hardened(
    settings,
    front: bytes,
    back: bytes | None,
    *,
    local_vision: LocalVisionEvidence | None,
) -> ModelSuggestion:
    body = _candidate_request_body(front, back, local_vision=local_vision)
    async with httpx.AsyncClient(timeout=settings.lora_candidate_timeout_seconds) as client:
        response = await client.post(
            f"{settings.lora_candidate_url.rstrip('/')}/analyze",
            json=body,
        )
    if response.is_error:
        raise _sidecar_failure(response)
    try:
        payload = response.json()
    except Exception as exc:
        raise ValueError("LoRA candidate sidecar returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("LoRA candidate sidecar returned a non-object response")
    return legacy._candidate_response_to_suggestion(
        payload,
        local_vision=local_vision,
    )


def install_lora_candidate_runtime() -> None:
    """Install v2 bounded transport before the existing fail-safe wrapper.

    Ordinary candidate failures still fall back for normal scanner uptime. Frozen
    promotion continues to reject any fallback, so this changes transport
    robustness only; it does not weaken promotion or Registry gates.
    """
    legacy._analyze_candidate = _analyze_candidate_hardened
    legacy.install_lora_candidate_runtime()
