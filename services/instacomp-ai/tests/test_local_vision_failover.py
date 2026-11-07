from pathlib import Path

import pytest

import app as app_package
from app.models import CardIdentity, LocalVisionEvidence, SideVisionEvidence


@pytest.mark.asyncio
async def test_unexpected_local_vision_failure_becomes_empty_non_authoritative_evidence(monkeypatch):
    async def broken_local_vision(_front, _back, _settings):
        raise RuntimeError("simulated deterministic witness crash")

    monkeypatch.setattr(
        app_package,
        "_original_analyze_local_vision",
        broken_local_vision,
    )

    result = await app_package._analyze_local_vision_with_trusted_style_memory(
        b"validated-front-image",
        b"validated-back-image",
        object(),
    )

    assert isinstance(result, LocalVisionEvidence)
    assert result.combined_text == ""
    assert result.apple_vision_available is False
    assert result.opencv_available is False
    assert result.identity_hints.model_dump(exclude_none=True) == {}
    assert result.serial.stamp_present is False
    assert result.front.ocr == []
    assert result.front.pattern.label == "unknown"
    assert result.front.errors == ["front:local_vision_unavailable:runtimeerror"]
    assert result.back is not None
    assert result.back.errors == ["back:local_vision_unavailable:runtimeerror"]


@pytest.mark.asyncio
async def test_style_memory_failure_preserves_deterministic_evidence(monkeypatch, tmp_path: Path):
    evidence = LocalVisionEvidence(
        front=SideVisionEvidence(side="front", width=640, height=900),
        back=SideVisionEvidence(side="back", width=640, height=900),
        combined_text="SONIA CITRON NO. 122",
        identity_hints=CardIdentity(
            year="2025",
            manufacturer="Panini",
            card_number="122",
        ),
        apple_vision_available=True,
        opencv_available=True,
    )

    async def working_local_vision(_front, _back, _settings):
        return evidence

    def broken_style_memory(**_kwargs):
        raise ValueError("simulated style-memory enrichment crash")

    class Settings:
        database_path = Path("data/instacomp_ai.sqlite3")

        def resolve_local_path(self, _value):
            return tmp_path / "instacomp_ai.sqlite3"

    monkeypatch.setattr(
        app_package,
        "_original_analyze_local_vision",
        working_local_vision,
    )
    monkeypatch.setattr(
        app_package,
        "apply_trusted_pattern_style",
        broken_style_memory,
    )

    result = await app_package._analyze_local_vision_with_trusted_style_memory(
        b"validated-front-image",
        b"validated-back-image",
        Settings(),
    )

    assert result.identity_hints == evidence.identity_hints
    assert result.combined_text == evidence.combined_text
    assert result.apple_vision_available is True
    assert result.opencv_available is True
    assert result.front.errors == [
        "front:trusted_style_memory_unavailable:valueerror"
    ]
    assert result.back is not None
    assert result.back.errors == []
