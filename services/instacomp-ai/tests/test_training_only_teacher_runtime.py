from __future__ import annotations

import asyncio
import io
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image

import app.main as main
from app.config import Settings
from app.models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    LocalVisionEvidence,
    SideVisionEvidence,
)


def _image_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (640, 900), (88, 104, 122)).save(output, format="JPEG", quality=90)
    return output.getvalue()


class _FakeStore:
    def card_uuid_for_image_pair(self, _pair_hash: str):
        return None

    def find_trusted_image_match(self, **_kwargs):
        return None

    def search(self, _identity, _limit=10):
        return []

    def save_scan(self, **_kwargs):
        return None

    def create_lesson(self, _lesson):  # pragma: no cover - should never run here
        raise AssertionError("untrusted scan must not create a lesson")


class _FakeChecklist:
    async def match(self, *_args, **_kwargs):
        return ChecklistResult(
            outcome=ChecklistOutcome.INPUT_INCOMPLETE,
            reasons=["No exact Registry identity in runtime-teacher isolation test."],
        )


async def _fake_local_vision(front: bytes, back: bytes | None, _settings):
    assert front
    return LocalVisionEvidence(
        front=SideVisionEvidence(side="front", width=640, height=900),
        back=(
            SideVisionEvidence(side="back", width=640, height=900)
            if back
            else None
        ),
        identity_hints=CardIdentity(),
        combined_text="",
        apple_vision_available=False,
        opencv_available=True,
    )


def test_runtime_ollama_reader_is_disabled_by_default() -> None:
    settings = Settings(_env_file=None)
    assert settings.ollama_runtime_reader_enabled is False
    assert settings.teacher_vision_enabled is True
    assert "qwen2.5vl:7b" in settings.teacher_vision_models
    assert "gemma3:12b" in settings.teacher_vision_models


def test_scan_does_not_call_teacher_model_when_runtime_reader_is_disabled(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls = {"reader": 0}

    async def forbidden_reader(*_args, **_kwargs):
        calls["reader"] += 1
        raise AssertionError("training-only teacher was called from live scan path")

    monkeypatch.setattr(main, "store", _FakeStore())
    monkeypatch.setattr(main, "checklist_gateway", _FakeChecklist())
    monkeypatch.setattr(main, "analyze_local_vision", _fake_local_vision)
    monkeypatch.setattr(main.reader, "analyze", forbidden_reader)
    monkeypatch.setattr(main, "image_store_path", tmp_path / "images")
    monkeypatch.setattr(main.settings, "ollama_runtime_reader_enabled", False)

    front = UploadFile(filename="front.jpg", file=io.BytesIO(_image_bytes()))
    result = asyncio.run(
        main.analyze_scan(
            front=front,
            back=None,
            printed_evidence_json=None,
            card_uuid=str(uuid4()),
        )
    )

    assert calls["reader"] == 0
    assert result.status == "needs_review"
    assert result.local_suggestion is None
    assert result.trusted_identity is None
    assert result.pricing_allowed is False
    assert result.learning_allowed is False
    assert result.match_source == "none"
    assert "hard training example" in result.next_action


def test_secondary_runtime_witness_is_blocked_by_default(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "ollama_runtime_reader_enabled", False)
    try:
        asyncio.run(main.secondary_identity_witness(front=None, back=None))  # type: ignore[arg-type]
    except HTTPException as exc:
        assert exc.status_code == 409
        assert "training-only teachers" in str(exc.detail)
    else:  # pragma: no cover
        raise AssertionError("secondary runtime witness should be disabled by default")
