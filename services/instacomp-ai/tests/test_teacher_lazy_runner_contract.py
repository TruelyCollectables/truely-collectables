from pathlib import Path


def _source() -> str:
    root = Path(__file__).resolve().parents[1]
    return (root / "scripts" / "run_teacher_vision_lora_training_lazy.py").read_text("utf-8")


def test_lazy_runner_checks_cache_before_image_preparation() -> None:
    source = _source()
    cache_check = source.index("if not force and tvt._receipt_is_current")
    image_prepare = source.index("images = tvt.prepare_learning_images")
    assert cache_check < image_prepare
    assert "TEACHER LAZY MINER ACTIVE" in source
    assert "TEACHER CARD START" in source
    assert "TEACHER RECEIPT WRITTEN" in source


def test_lazy_runner_bounds_and_retries_teacher_json() -> None:
    source = _source()
    assert '"maxItems": 3' in source
    assert '"maxLength": 180' in source
    assert '"maxProperties": 6' in source
    assert "class CompactRetryOllamaVisionTeacher" in source
    assert "for retry in (False, True):" in source
    assert "TEACHER JSON RETRY" in source
    assert '"compact_output_contract": True' in source
    assert '"json_attempts": attempts' in source
    assert 'done_reason == "length"' in source
