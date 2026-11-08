#!/usr/bin/env python3
from __future__ import annotations

"""Run mlx_vlm.lora with a fail-closed fix for MLX-VLM 0.6.8 resume.

MLX-VLM 0.6.8 freezes the base model on a fresh LoRA setup, but its
--adapter-path resume branch calls apply_lora_layers() without freezing the
base first. On quantized Qwen3-VL this leaves hundreds of millions of base
parameters trainable. InstaComp patches only the training subprocess: freeze
the base model immediately before the upstream adapter loader recreates the
LoRA modules, then verify that every remaining trainable tensor is a LoRA
adapter tensor.
"""

import runpy

from mlx.utils import tree_flatten
from mlx_vlm.trainer import utils as trainer_utils

_UPSTREAM_APPLY_LORA_LAYERS = trainer_utils.apply_lora_layers


def _safe_apply_lora_layers(model, adapter_path):
    trainer_utils.freeze_model(model)
    resumed = _UPSTREAM_APPLY_LORA_LAYERS(model, adapter_path)

    trainable = tree_flatten(resumed.trainable_parameters())
    unexpected = [
        name
        for name, _value in trainable
        if not (name.endswith("lora_a") or name.endswith("lora_b"))
    ]
    if unexpected:
        preview = ", ".join(unexpected[:10])
        raise RuntimeError(
            "InstaComp blocked unsafe MLX-VLM resume: non-LoRA base parameters "
            f"remain trainable after adapter load: {preview}"
        )
    if not trainable:
        raise RuntimeError(
            "InstaComp blocked unsafe MLX-VLM resume: adapter load produced no "
            "trainable LoRA tensors."
        )
    return resumed


trainer_utils.apply_lora_layers = _safe_apply_lora_layers

# Execute the upstream CLI as __main__. Its `from .trainer.utils import
# apply_lora_layers` import now receives the patched function above.
runpy.run_module("mlx_vlm.lora", run_name="__main__")
