#!/usr/bin/env python3
from __future__ import annotations

import tempfile
from pathlib import Path
from types import SimpleNamespace

import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten
from mlx_vlm.trainer import utils as trainer_utils

import mlx_vlm_resume_freeze_compat as resume_compat


class ToyLanguageModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.q_proj = nn.Linear(8, 8, bias=False)
        self.k_proj = nn.Linear(8, 8, bias=False)


class ToyVisionModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.proj = nn.Linear(8, 8, bias=False)


class ToyVLM(nn.Module):
    def __init__(self):
        super().__init__()
        self.language_model = ToyLanguageModel()
        self.vision_model = ToyVisionModel()
        self.config = SimpleNamespace()


def _trainable_names(model: nn.Module) -> list[str]:
    return [str(name) for name, _ in tree_flatten(model.trainable_parameters())]


def _allclose(left, right) -> bool:
    return bool(mx.allclose(left, right).item())


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        adapter_dir = Path(raw) / "adapter"
        adapter_dir.mkdir()

        source = ToyVLM()
        source = trainer_utils.get_peft_model(
            source,
            ["q_proj", "k_proj"],
            rank=2,
            alpha=4,
            dropout=0.0,
            verbose=False,
        )
        source.language_model.q_proj.lora_a = mx.full((8, 2), 0.125)
        source.language_model.q_proj.lora_b = mx.full((2, 8), -0.25)
        mx.eval(source.parameters())
        trainer_utils.save_adapter(source, adapter_dir / "adapters.safetensors")

        # Reproduce pinned mlx-vlm 0.6.8 behavior before the InstaComp shim:
        # adapter resume applies LoRA layers to a fresh model without first
        # freezing the fresh base VLM.
        original_apply = trainer_utils.apply_lora_layers
        broken = original_apply(ToyVLM(), adapter_dir)
        broken_names = _trainable_names(broken)
        assert any(not resume_compat._is_lora_trainable_name(name) for name in broken_names), (
            "Pinned mlx-vlm resume behavior changed; update this regression instead of "
            "silently keeping a compatibility shim."
        )
        assert any("vision_model" in name for name in broken_names), broken_names

        installed = resume_compat.install_resume_adapter_freeze_compatibility()
        assert installed is True
        assert resume_compat.install_resume_adapter_freeze_compatibility() is False

        fixed = trainer_utils.apply_lora_layers(ToyVLM(), adapter_dir)
        fixed_names = _trainable_names(fixed)
        assert fixed_names, "resume must leave LoRA parameters trainable"
        assert all(resume_compat._is_lora_trainable_name(name) for name in fixed_names), fixed_names
        assert not any("vision_model" in name for name in fixed_names), fixed_names
        assert not any(name.endswith("linear.weight") for name in fixed_names), fixed_names

        assert _allclose(
            fixed.language_model.q_proj.lora_a,
            source.language_model.q_proj.lora_a,
        )
        assert _allclose(
            fixed.language_model.q_proj.lora_b,
            source.language_model.q_proj.lora_b,
        )

        broken_count = sum(
            int(value.size) for _, value in tree_flatten(broken.trainable_parameters())
        )
        fixed_count = sum(
            int(value.size) for _, value in tree_flatten(fixed.trainable_parameters())
        )
        assert fixed_count < broken_count, (broken_count, fixed_count)
        assert fixed_count == 64, fixed_count

        print(
            "PASS pinned mlx-vlm resume bug reproduced: fresh base parameters remain trainable without shim"
        )
        print(
            "PASS resume-freeze shim leaves only LoRA A/B trainable and freezes vision/base weights"
        )
        print("PASS certified adapter LoRA values survive freeze-before-restore unchanged")
        print(f"PASS toy trainable footprint collapsed from {broken_count} to {fixed_count} parameters")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
