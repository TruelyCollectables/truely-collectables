from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import scripts.run_teacher_vision_lora_training_lazy as lazy


class _Example:
    def __init__(self, example_id: str):
        self.training_example_id = example_id
        self.trusted = True


class _Teacher:
    def __init__(self, _settings, _model):
        pass

    async def analyze(self, example, images):
        return {"training_example_id": example.training_example_id, "images": images}


def test_lazy_miner_skips_image_preparation_for_cached_receipts(tmp_path: Path, monkeypatch) -> None:
    examples = [_Example("cached"), _Example("missing")]
    prepared: list[str] = []
    written: list[str] = []

    monkeypatch.setattr(lazy.tvt, "configured_teacher_models", lambda _settings: ["qwen2.5vl:7b"])
    monkeypatch.setattr(lazy.tvt, "_available_ollama_models", lambda _settings: asyncio.sleep(0, result={"qwen2.5vl:7b"}))
    monkeypatch.setattr(lazy.tvt, "latest_training_examples", lambda values: list(values))
    monkeypatch.setattr(lazy.tvt, "_stable_split", lambda _example, _percent: "train")
    monkeypatch.setattr(lazy.tvt, "_teacher_priority", lambda example: (0, example.training_example_id))
    monkeypatch.setattr(lazy, "CompactRetryOllamaVisionTeacher", _Teacher)
    monkeypatch.setattr(
        lazy.tvt,
        "_receipt_path",
        lambda root, model, example_id: root / model.replace(":", "-") / f"{example_id}.json",
    )
    monkeypatch.setattr(
        lazy.tvt,
        "_receipt_is_current",
        lambda _path, example, _model: example.training_example_id == "cached",
    )

    def prepare(example, **_kwargs):
        prepared.append(example.training_example_id)
        return [{"path": str(tmp_path / f"{example.training_example_id}.jpg")}]

    monkeypatch.setattr(lazy.tvt, "prepare_learning_images", prepare)
    monkeypatch.setattr(
        lazy.tvt,
        "_write_json_atomic",
        lambda _path, receipt: written.append(receipt["training_example_id"]),
    )

    settings = SimpleNamespace(
        teacher_vision_enabled=True,
        teacher_vision_image_max_edge=768,
    )
    result = asyncio.run(
        lazy.mine_teacher_vision_lessons_lazy(
            examples,
            settings=settings,
            image_store_path=tmp_path / "images",
            teacher_root=tmp_path / "teacher",
        )
    )

    assert prepared == ["missing"]
    assert written == ["missing"]
    assert result["generated"] == 1
    assert result["cached"] == 1
    assert result["failed"] == 0
    assert result["lazy_image_preparation"] is True
