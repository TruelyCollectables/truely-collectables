from __future__ import annotations

from pathlib import Path

from app.apple_vision import AppleVisionOCR


def _force_supported(monkeypatch, ocr: AppleVisionOCR) -> None:
    monkeypatch.setattr(AppleVisionOCR, "supported", property(lambda self: True))
    monkeypatch.setattr(ocr, "_ensure_binary", lambda: None)


def test_preprocess_failure_becomes_bounded_witness_error(monkeypatch, tmp_path: Path) -> None:
    ocr = AppleVisionOCR(tmp_path, tmp_path)
    _force_supported(monkeypatch, ocr)

    def fail_variants(_content: bytes):
        raise RuntimeError("synthetic preprocess failure")

    monkeypatch.setattr(ocr, "_variants", fail_variants)

    observations, errors = ocr.recognize(b"non-empty", side="front")

    assert observations == []
    assert errors == ["front:apple_vision_preprocess_failed:runtimeerror"]


def test_unexpected_variant_failure_does_not_abort_other_witness_variants(
    monkeypatch,
    tmp_path: Path,
) -> None:
    ocr = AppleVisionOCR(tmp_path, tmp_path)
    _force_supported(monkeypatch, ocr)
    monkeypatch.setattr(
        ocr,
        "_variants",
        lambda _content: [("original", b"one"), ("contrast", b"two")],
    )

    calls: list[bytes] = []

    def run_variant(content: bytes):
        calls.append(content)
        if content == b"one":
            raise RuntimeError("synthetic native helper failure")
        return []

    monkeypatch.setattr(ocr, "_run_variant", run_variant)

    observations, errors = ocr.recognize(b"non-empty", side="back")

    assert calls == [b"one", b"two"]
    assert observations == []
    assert errors == ["back:original:apple_vision_failed:runtimeerror"]
