from __future__ import annotations

from types import SimpleNamespace

from app.lora_candidate_runtime import _guard_model_pattern_parallel


def _vision(label: str, confidence: float):
    return SimpleNamespace(
        front=SimpleNamespace(
            pattern=SimpleNamespace(label=label, confidence=confidence),
        )
    )


def test_rickea_cracked_ice_hallucination_is_removed_without_deterministic_support() -> None:
    parsed = {
        "identity": {
            "player": "Rickea Jackson",
            "card_number": "118",
            "set_name": "2025 Panini Prizm WNBA - Green Prizms",
            "parallel": "Cracked Ice Prizm",
        }
    }
    guarded = _guard_model_pattern_parallel(parsed, _vision("unknown", 0.0))
    assert guarded["identity"]["parallel"] is None
    assert parsed["identity"]["parallel"] == "Cracked Ice Prizm"


def test_malonga_cracked_ice_is_preserved_when_opencv_agrees() -> None:
    parsed = {
        "identity": {
            "player": "Dominique Malonga",
            "card_number": "116",
            "parallel": "Cracked Ice Prizm",
        }
    }
    guarded = _guard_model_pattern_parallel(parsed, _vision("cracked_ice", 0.83))
    assert guarded["identity"]["parallel"] == "Cracked Ice Prizm"


def test_paige_low_confidence_pattern_cannot_authorize_cracked_ice() -> None:
    parsed = {
        "identity": {
            "player": "Paige Bueckers",
            "card_number": "5",
            "parallel": "Cracked Ice Prizm",
        }
    }
    guarded = _guard_model_pattern_parallel(parsed, _vision("cracked_ice", 0.69))
    assert guarded["identity"]["parallel"] is None


def test_velocity_requires_velocity_witness() -> None:
    parsed = {"identity": {"parallel": "Blue Velocity Prizm"}}
    assert _guard_model_pattern_parallel(parsed, _vision("cracked_ice", 0.9))["identity"]["parallel"] is None
    assert _guard_model_pattern_parallel(parsed, _vision("velocity", 0.9))["identity"]["parallel"] == "Blue Velocity Prizm"


def test_non_geometry_parallel_is_unchanged_by_narrow_guard() -> None:
    parsed = {"identity": {"parallel": "Green Prizm"}}
    guarded = _guard_model_pattern_parallel(parsed, _vision("unknown", 0.0))
    assert guarded["identity"]["parallel"] == "Green Prizm"
