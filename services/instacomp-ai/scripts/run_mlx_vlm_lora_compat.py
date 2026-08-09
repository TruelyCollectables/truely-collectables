#!/usr/bin/env python3
from __future__ import annotations

import runpy

import mlx.core as mx
import mlx_vlm.trainer.sft_trainer as sft_trainer


_original_loss = sft_trainer.vision_language_loss_fn
_native_grid_collation = hasattr(sft_trainer, "_collate_grid_thw")


def _normalize_grid(value):
    if isinstance(value, mx.array) and value.ndim >= 2 and value.shape[-1] == 3:
        return value.reshape(-1, 3)
    return value


def _instacomp_multi_image_loss(
    model,
    batch,
    train_on_completions=False,
    assistant_id=77091,
):
    patched = dict(batch)
    for key in ("image_grid_thw", "video_grid_thw"):
        if key in patched:
            patched[key] = _normalize_grid(patched[key])
    return _original_loss(
        model,
        patched,
        train_on_completions=train_on_completions,
        assistant_id=assistant_id,
    )


if not _native_grid_collation:
    # mlx-vlm 0.6.7 and earlier affected releases stack a two-image Qwen3-VL
    # grid as (1, N, 3) when batch_size=1. Qwen3-VL requires the flat
    # (N, 3) media grid. Keep front+back training intact and normalize only
    # at the loss boundary. Upstream main now has native _collate_grid_thw.
    sft_trainer.vision_language_loss_fn = _instacomp_multi_image_loss
    print("InstaComp MLX compatibility: flattening multi-image grid_thw for paired-card LoRA training.")
else:
    print("InstaComp MLX compatibility: native multi-image grid collation detected.")

runpy.run_module("mlx_vlm.lora", run_name="__main__")
