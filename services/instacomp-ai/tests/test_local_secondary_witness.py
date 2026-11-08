from __future__ import annotations

import pytest

from app.lora_candidate_runtime import analyze_with_established_reader
from app.models import CardIdentity, ModelSuggestion


@pytest.mark.asyncio
async def test_established_reader_bypasses_candidate_wrapper():
    calls: list[str] = []

    class Reader:
        pass

    async def established(self, front, back, *, local_vision=None):
        calls.append("established")
        return ModelSuggestion(
            provider="instacomp_ollama_backup",
            model="baseline-local-model",
            identity=CardIdentity(player="Sonia Citron", card_number="122", year="2025"),
            confidence=0.97,
            explanation="independent baseline read",
        )

    async def wrapped(self, front, back, *, local_vision=None):
        calls.append("candidate-wrapper")
        raise AssertionError("candidate wrapper must not run for the independent witness")

    Reader._instacomp_established_analyze = established
    Reader.analyze = wrapped
    reader = Reader()

    result = await analyze_with_established_reader(
        reader,
        b"front",
        b"back",
        local_vision=None,
    )

    assert calls == ["established"]
    assert result.provider == "instacomp_ollama_backup"
    assert result.identity.player == "Sonia Citron"
    assert result.confidence == 0.97
