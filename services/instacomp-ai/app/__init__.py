"""InstaComp AI package initialization.

The local-vision entry point is wrapped once here so every existing caller gets
trusted style-memory hints without duplicating scan orchestration. The wrapper
only fills a missing parallel hint; exact identity still has to reconcile through
printed evidence and the internal Checklist Registry.
"""

from . import local_vision as _local_vision
from .pattern_memory import apply_trusted_pattern_style
from .psa_policy import install_psa_lead_only_policy
from .runtime_compat import install_sentinel_runtime_compat

_original_analyze_local_vision = _local_vision.analyze_local_vision


async def _analyze_local_vision_with_trusted_style_memory(front, back, settings):
    evidence = await _original_analyze_local_vision(front, back, settings)
    database_path = settings.resolve_local_path(settings.database_path)
    return apply_trusted_pattern_style(
        database_path=database_path,
        evidence=evidence,
    )


_local_vision.analyze_local_vision = _analyze_local_vision_with_trusted_style_memory
install_psa_lead_only_policy()
install_sentinel_runtime_compat()
