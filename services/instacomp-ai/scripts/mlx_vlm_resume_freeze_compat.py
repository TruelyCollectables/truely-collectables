#!/usr/bin/env python3
from __future__ import annotations

from typing import Any


_MARKER = "_instacomp_resume_base_freeze_compat"
_ALLOWED_LORA_SUFFIXES = (".lora_a", ".lora_b")


def _is_lora_trainable_name(name: str) -> bool:
    return any(str(name).endswith(suffix) for suffix in _ALLOWED_LORA_SUFFIXES)


def _trainable_summary(model: Any) -> tuple[int, list[str]]:
    from mlx.utils import tree_flatten

    flattened = [(str(name), value) for name, value in tree_flatten(model.trainable_parameters())]
    total = sum(int(getattr(value, "size", 0)) for _, value in flattened)
    unexpected = [name for name, _ in flattened if not _is_lora_trainable_name(name)]
    return total, unexpected


def _freeze_base_for_resume(model: Any) -> Any:
    """Freeze the complete loaded VLM before resume LoRA modules are created.

    mlx-vlm 0.6.8 freezes the base model in fresh LoRA setup, but its adapter
    resume path applies LoRA layers without first freezing the freshly loaded
    base VLM. That leaves base parameters trainable and causes Adam to allocate
    optimizer state for hundreds of millions of parameters. Freeze recursively
    before applying the adapter so only newly created LoRA A/B tensors remain
    trainable.
    """
    freeze = getattr(model, "freeze", None)
    if not callable(freeze):
        raise RuntimeError(
            "InstaComp resume-freeze guard could not find recursive model.freeze(); "
            "refusing warm-start training against an unknown MLX model layout."
        )
    freeze()
    return model


def install_resume_adapter_freeze_compatibility() -> bool:
    """Patch pinned mlx-vlm's adapter-resume loader inside this worker only.

    The worker process imports ``mlx_vlm.lora`` after this function runs. That
    module imports ``apply_lora_layers`` from ``mlx_vlm.trainer.utils`` at import
    time, so replacing the trainer-utils function here deterministically fixes
    only this isolated LoRA worker.
    """
    from mlx_vlm.trainer import utils as trainer_utils

    current = trainer_utils.apply_lora_layers
    if getattr(current, _MARKER, False):
        return False

    original_apply = current

    def apply_lora_layers_with_frozen_base(model, adapter_path):
        _freeze_base_for_resume(model)
        resumed = original_apply(model, adapter_path)
        trainable_count, unexpected = _trainable_summary(resumed)
        if unexpected:
            preview = ", ".join(unexpected[:8])
            raise RuntimeError(
                "InstaComp resume-freeze guard found non-LoRA trainable base parameters "
                f"after adapter restore: {preview}. Refusing optimizer setup."
            )
        if trainable_count <= 0:
            raise RuntimeError(
                "InstaComp resume-freeze guard found zero trainable LoRA parameters after "
                "adapter restore; refusing a no-op training run."
            )
        print(
            "INSTACOMP MLX RESUME FREEZE: base VLM recursively frozen before adapter restore; "
            f"trainable_params={trainable_count} and every trainable tensor is LoRA A/B only.",
            flush=True,
        )
        return resumed

    setattr(apply_lora_layers_with_frozen_base, _MARKER, True)
    trainer_utils.apply_lora_layers = apply_lora_layers_with_frozen_base
    return True


def self_test() -> int:
    assert _is_lora_trainable_name("language_model.layers.0.q_proj.lora_a")
    assert _is_lora_trainable_name("language_model.layers.0.q_proj.lora_b")
    assert not _is_lora_trainable_name("language_model.layers.0.q_proj.linear.weight")
    assert not _is_lora_trainable_name("vision_model.patch_embed.weight")
    print("PASS resume-freeze contract accepts only LoRA A/B trainable tensor names")
    print("PASS resume-freeze contract rejects base-model trainable tensor names")
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test())
