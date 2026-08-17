from pathlib import Path


def test_lazy_runner_checks_cache_before_image_preparation() -> None:
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "run_teacher_vision_lora_training_lazy.py").read_text("utf-8")
    cache_check = source.index("if not force and tvt._receipt_is_current")
    image_prepare = source.index("images = tvt.prepare_learning_images")
    assert cache_check < image_prepare
    assert "TEACHER LAZY MINER ACTIVE" in source
    assert "TEACHER RECEIPT WRITTEN" in source
