"""InstaComp AI package initialization.

The local-vision entry point is wrapped once here so every existing caller gets
trusted style-memory hints without duplicating scan orchestration. Local vision
and style memory are evidence witnesses only: an unexpected witness failure must
never override or crash an otherwise valid Registry-authorized scan.
"""

from . import local_vision as _local_vision
from . import verified_checklist_sources_modern_extra as _verified_checklist_sources_modern_extra
from .deterministic_checklist_recovery import install_deterministic_checklist_recovery
from .lora_candidate_runtime import install_lora_candidate_runtime
from .models import LocalVisionEvidence, SideVisionEvidence
from .pattern_memory import apply_trusted_pattern_style
from .psa_policy import install_psa_lead_only_policy
from .runtime_compat import install_sentinel_runtime_compat

_original_analyze_local_vision = _local_vision.analyze_local_vision


def _witness_error(side: str, stage: str, error: Exception) -> str:
    return f"{side}:{stage}:{type(error).__name__.lower()}"


def _empty_local_vision(front_present: bool, back_present: bool, error: Exception) -> LocalVisionEvidence:
    # The caller has already validated and normalized the card images. A 1x1
    # placeholder here means only "the independent deterministic witness was
    # unavailable"; it carries no identity, OCR, color, pattern, or serial
    # evidence and therefore cannot authorize identity or pricing.
    front = SideVisionEvidence(
        side="front",
        width=1,
        height=1,
        errors=[_witness_error("front", "local_vision_unavailable", error)],
    )
    back = (
        SideVisionEvidence(
            side="back",
            width=1,
            height=1,
            errors=[_witness_error("back", "local_vision_unavailable", error)],
        )
        if back_present
        else None
    )
    return LocalVisionEvidence(
        front=front,
        back=back,
        combined_text="",
        apple_vision_available=False,
        opencv_available=False,
    )


async def _analyze_local_vision_with_trusted_style_memory(front, back, settings):
    try:
        evidence = await _original_analyze_local_vision(front, back, settings)
    except Exception as error:
        return _empty_local_vision(bool(front), bool(back), error)

    try:
        database_path = settings.resolve_local_path(settings.database_path)
        return apply_trusted_pattern_style(
            database_path=database_path,
            evidence=evidence,
        )
    except Exception as error:
        # Style memory is a parallel-only hint. Preserve the deterministic
        # evidence unchanged if that optional enrichment fails, while recording
        # a bounded error type rather than leaking a traceback or stale label.
        front_with_error = evidence.front.model_copy(
            update={
                "errors": [
                    *evidence.front.errors,
                    _witness_error("front", "trusted_style_memory_unavailable", error),
                ]
            }
        )
        return evidence.model_copy(update={"front": front_with_error})


_local_vision.analyze_local_vision = _analyze_local_vision_with_trusted_style_memory
install_psa_lead_only_policy()
install_sentinel_runtime_compat()
install_deterministic_checklist_recovery()
install_lora_candidate_runtime()
