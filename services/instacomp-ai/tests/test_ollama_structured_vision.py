from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from app.ollama import (
    OLLAMA_OUTPUT_SCHEMA,
    extract_json,
    prepare_ollama_image,
)


def test_prepares_compact_baseline_jpeg_for_ollama() -> None:
    source = Image.new("RGB", (2600, 1800), "white")
    progressive = io.BytesIO()
    source.save(progressive, format="JPEG", quality=95, progressive=True)

    prepared = prepare_ollama_image(progressive.getvalue())

    with Image.open(io.BytesIO(prepared)) as image:
        assert image.format == "JPEG"
        assert max(image.size) <= 1280
        assert not image.info.get("progressive")
        assert not image.info.get("progression")


def test_extract_json_repairs_common_qwen_wrappers() -> None:
    fenced = """```json
    {"identity":{"year":2025,"card_number":122,},"evidence":{},}
    ```"""
    parsed = extract_json(fenced)
    assert parsed["identity"]["year"] == 2025
    assert parsed["identity"]["card_number"] == 122

    python_literal = "result: {'identity': {'player': 'Sonia Citron'}, 'confidence': 0.9}"
    parsed_literal = extract_json(python_literal)
    assert parsed_literal["identity"]["player"] == "Sonia Citron"


def test_schema_requires_structured_identity_and_evidence() -> None:
    assert OLLAMA_OUTPUT_SCHEMA["type"] == "object"
    properties = OLLAMA_OUTPUT_SCHEMA["properties"]
    assert "identity" in properties
    assert "evidence" in properties
    assert "confidence" in properties
    assert "explanation" in properties


def test_runtime_uses_chat_schema_and_bounded_generation() -> None:
    source = (
        Path(__file__).resolve().parents[1] / "app" / "ollama.py"
    ).read_text(encoding="utf-8")
    assert '"format": OLLAMA_OUTPUT_SCHEMA' in source
    assert '}/api/chat"' in source
    assert '"num_ctx": 8192' in source
    assert '"num_predict": 2048' in source
    assert '"temperature": 0.0' in source
    assert 'progressive=False' in source
