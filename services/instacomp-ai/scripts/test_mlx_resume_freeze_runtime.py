#!/usr/bin/env python3
from __future__ import annotations

import tempfile
from pathlib import Path

import mlx.nn as nn
from mlx.utils import tree_flatten

import mlx_vlm_lora_compat as compat
from mlx_vlm.trainer import utils as trainer_utils


class _Config:
    pass


class _TinyLanguage(nn.Module):
    def __init__(self):
        super().__init__()
        self.q_proj = nn.Linear(8, 8)
        self.k_proj = nn.Linear(8, 8)
        self.mlp = nn.Linear(8, 16)


class _TinyVLM(nn.Module):
    def __init__(self):
        super().__init__()
        self.language_model = _TinyLanguage()
        self.vision_model = nn.Linear(8, 8)
        self.config = _Config()


def _trainable(model):
    return list(tree_flatten(model.trainable_parameters()))


def _lora_only(rows) -> bool:
    return bool(rows) and all(
        str(name).rsplit(".", 1)[-1] in {"lora_a", "lora_b"}
        for name, _value in rows
    )


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        bundle = Path(raw) / "adapter"
        bundle.mkdir()

        # Build a real modern mlx-vlm adapter bundle through the fresh-LoRA path.
        source = _TinyVLM()
        modules = trainer_utils.find_all_linear_names(source.language_model)
        source = trainer_utils.get_peft_model(
            source,
            modules,
            rank=4,
            alpha=8,
            dropout=0.0,
            verbose=False,
        )
        trainer_utils.save_adapter(source, bundle / "adapters.safetensors")
        assert (bundle / "adapter_config.json").is_file()
        assert (bundle / "adapters.safetensors").is_file()

        # Reproduce the pinned 0.6.8 defect: resume applies LoRA without first
        # freezing the fresh base model, leaving non-LoRA parameters trainable.
        buggy = _TinyVLM()
        buggy = trainer_utils.apply_lora_layers(buggy, str(bundle))
        buggy_rows = _trainable(buggy)
        buggy_non_lora = [
            name
            for name, _value in buggy_rows
            if str(name).rsplit(".", 1)[-1] not in {"lora_a", "lora_b"}
        ]
        assert buggy_non_lora, "pinned runtime no longer reproduces the resume freeze defect"
        buggy_params = sum(int(value.size) for _name, value in buggy_rows)

        # Install the InstaComp worker compatibility guard and repeat from a
        # pristine base model. Only lora_a/lora_b may remain trainable.
        assert compat.install_resume_adapter_freeze_compatibility() is True
        assert compat.install_resume_adapter_freeze_compatibility() is False
        safe = _TinyVLM()
        safe = trainer_utils.apply_lora_layers(safe, str(bundle))
        safe_rows = _trainable(safe)
        safe_params = sum(int(value.size) for _name, value in safe_rows)
        assert _lora_only(safe_rows)
        assert safe_params > 0
        assert safe_params < buggy_params
        assert safe_params <= compat.MAX_RESUME_TRAINABLE_PARAMS

        # Prove the purity gate itself is fail-closed if upstream freezing is
        # defeated: optimizer creation must never see base-model trainables.
        guarded_apply = trainer_utils.apply_lora_layers
        original_freeze = trainer_utils.freeze_model
        try:
            trainer_utils.freeze_model = lambda _model: None
            unsafe = _TinyVLM()
            try:
                guarded_apply(unsafe, str(bundle))
            except RuntimeError as exc:
                assert "non-LoRA trainable tensors" in str(exc)
            else:
                raise AssertionError("resume purity gate must reject unfrozen base parameters")
        finally:
            trainer_utils.freeze_model = original_freeze

        print(
            "PASS pinned mlx-vlm 0.6.8 resume defect reproduced: "
            f"buggy_trainable_params={buggy_params} non_lora_tensors={len(buggy_non_lora)}"
        )
        print(
            "PASS InstaComp resume freeze leaves LoRA-only trainables: "
            f"safe_trainable_params={safe_params} trainable_tensors={len(safe_rows)}"
        )
        print("PASS resume trainable-purity gate fails closed before optimizer creation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
