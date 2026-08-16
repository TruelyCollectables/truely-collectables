from __future__ import annotations

from app.lora_candidate_runtime import (
    _candidate_response_to_suggestion,
    _guard_model_pattern_parallel,
)
from app.models import CardIdentity, LocalVisionEvidence, PatternEvidence, SideVisionEvidence


def _vision(
    *,
    label: str,
    confidence: float,
    geometry: list[str],
    polygon_count: int = 0,
    angle_entropy: float = 0.0,
    trusted_style_score: float = 0.0,
    hint_parallel: str | None = None,
) -> LocalVisionEvidence:
    scores = {}
    if trusted_style_score:
        scores["trusted_style_memory"] = trusted_style_score
    return LocalVisionEvidence(
        front=SideVisionEvidence(
            side="front",
            width=800,
            height=1200,
            pattern=PatternEvidence(
                label=label,
                confidence=confidence,
                scores=scores,
                geometry=geometry,
                line_count=300,
                polygon_count=polygon_count,
                edge_density=0.18,
                angle_entropy=angle_entropy,
            ),
        ),
        identity_hints=CardIdentity(parallel=hint_parallel),
    )


def _rickea_mac_receipt_vision() -> LocalVisionEvidence:
    # Exact geometry facts retained by the failed 2026-08-15 Mac promotion:
    # detector said cracked_ice and counted 359 polygons, but there was no
    # directional-diagonal geometry. This must never authorize an Ice Registry filter.
    return _vision(
        label="cracked_ice",
        confidence=0.82,
        geometry=[
            "detected 300 long line segments",
            "detected 359 irregular polygon candidates",
            "non-directional multi-angle edge geometry",
        ],
        polygon_count=359,
        angle_entropy=0.86,
        hint_parallel="Cracked Ice Prizm",
    )


def test_rickea_mac_receipt_false_cracked_ice_is_removed() -> None:
    parsed = {
        "identity": {
            "player": "Rickea Jackson",
            "card_number": "118",
            "set_name": "2025 Panini Prizm WNBA - Green Prizms",
            "parallel": "Cracked Ice Prizm",
        }
    }
    guarded = _guard_model_pattern_parallel(parsed, _rickea_mac_receipt_vision())
    assert guarded["identity"]["parallel"] is None
    assert parsed["identity"]["parallel"] == "Cracked Ice Prizm"


def test_malonga_real_ice_geometry_preserves_cracked_ice() -> None:
    vision = _vision(
        label="cracked_ice",
        confidence=0.83,
        geometry=[
            "detected 300 long line segments",
            "directional diagonal line geometry",
            "detected 274 irregular polygon candidates",
            "non-directional multi-angle edge geometry",
        ],
        polygon_count=274,
        angle_entropy=0.84,
        hint_parallel="Cracked Ice Prizm",
    )
    parsed = {"identity": {"parallel": "Cracked Ice Prizm"}}
    guarded = _guard_model_pattern_parallel(parsed, vision)
    assert guarded["identity"]["parallel"] == "Cracked Ice Prizm"


def test_paige_reinforced_style_memory_plus_geometry_preserves_cracked_ice() -> None:
    vision = _vision(
        label="unknown",
        confidence=0.0,
        geometry=[
            "detected 300 long line segments",
            "directional diagonal line geometry",
            "detected 267 irregular polygon candidates",
            "non-directional multi-angle edge geometry",
            "trusted style memory suggests Cracked Ice Prizm (0.933; support=3)",
        ],
        polygon_count=267,
        angle_entropy=0.83,
        trusted_style_score=0.933,
        hint_parallel="Cracked Ice Prizm",
    )
    parsed = {"identity": {"parallel": "Cracked Ice Prizm"}}
    guarded = _guard_model_pattern_parallel(parsed, vision)
    assert guarded["identity"]["parallel"] == "Cracked Ice Prizm"


def test_flat_sidecar_payload_cannot_bypass_post_merge_guard() -> None:
    payload = {
        "ok": True,
        "validation_eligible": True,
        "model": "mlx-community/Qwen3-VL-2B-Instruct-4bit",
        "adapter_name": "fixture-adapter",
        # Real sidecar responses can be flat rather than nested under identity.
        "parsed": {
            "sport": "Basketball",
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Panini Prizm",
            "set_name": "2025 Panini Prizm WNBA - Green Prizms",
            "player": "Rickea Jackson",
            "card_number": "118",
            "parallel": "Cracked Ice Prizm",
            "evidence": {"visible_text": ["RICKEA JACKSON", "118", "PRIZM"]},
        },
    }
    suggestion = _candidate_response_to_suggestion(
        payload,
        local_vision=_rickea_mac_receipt_vision(),
    )
    assert suggestion.identity.player == "Rickea Jackson"
    assert suggestion.identity.card_number == "118"
    # This captured receipt has no back evidence at all. Under the authoritative
    # physical rule, no bold black PRIZM mark on the back means regular Base.
    assert suggestion.identity.parallel == "Base"
    assert suggestion.raw["pattern_parallel_guard_stage"] == "post_normalization_post_local_merge"


def test_velocity_requires_directional_velocity_witness() -> None:
    no_diagonal = _vision(
        label="velocity",
        confidence=0.9,
        geometry=["detected 40 long line segments"],
    )
    diagonal = _vision(
        label="velocity",
        confidence=0.9,
        geometry=["directional diagonal line geometry"],
    )
    parsed = {"identity": {"parallel": "Blue Velocity Prizm"}}
    assert _guard_model_pattern_parallel(parsed, no_diagonal)["identity"]["parallel"] is None
    assert _guard_model_pattern_parallel(parsed, diagonal)["identity"]["parallel"] == "Blue Velocity Prizm"


def test_non_geometry_parallel_is_unchanged_by_narrow_guard() -> None:
    parsed = {"identity": {"parallel": "Green Prizm"}}
    guarded = _guard_model_pattern_parallel(parsed, _rickea_mac_receipt_vision())
    assert guarded["identity"]["parallel"] == "Green Prizm"
