#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata

import mlx.core as mx
import numpy as np

import qwen3_multimodal_alignment_guard as guard
from mlx_vlm.models.qwen3_vl.processing_qwen3_vl import Qwen3VLImageProcessor


IMAGE_TOKEN_ID = 151655
VIDEO_TOKEN_ID = 151656


def _real_processor_floor_is_effective() -> None:
    processor = Qwen3VLImageProcessor(
        patch_size=16,
        temporal_patch_size=2,
        merge_size=2,
        min_pixels=65536,
    )
    card = np.zeros((3, 183, 256), dtype=np.uint8)

    before_pixels, before_grid = processor._process_one(card)
    assert before_grid == [1, 14, 20]
    assert before_pixels.shape[0] == 280

    assert guard.install_profile_pixel_floor(256) is True
    after_pixels, after_grid = processor._process_one(card)
    assert after_grid == [1, 12, 16]
    assert after_pixels.shape[0] == 192
    assert after_pixels.shape[0] < before_pixels.shape[0]


def _real_model_merge_guard_catches_exact_failure_class() -> None:
    guard.install_alignment_guards()
    from mlx_vlm.models.qwen3_vl.qwen3_vl import Model

    input_ids = mx.array([[IMAGE_TOKEN_ID, IMAGE_TOKEN_ID]], dtype=mx.int32)
    inputs_embeds = mx.zeros((1, 2, 2048), dtype=mx.float32)
    image_features = mx.zeros((1, 2048), dtype=mx.float32)

    try:
        Model.merge_input_ids_with_image_features(
            image_features,
            inputs_embeds,
            input_ids,
            IMAGE_TOKEN_ID,
            VIDEO_TOKEN_ID,
        )
    except guard.Qwen3MultimodalAlignmentError as exc:
        text = str(exc)
        assert "before masked scatter" in text
        assert "text_visual_tokens=2" in text
        assert "vision_features=1" in text
    else:
        raise AssertionError("real Qwen3 model merge mismatch must be intercepted before masked_scatter")


def main() -> int:
    version = importlib.metadata.version("mlx-vlm")
    assert version == "0.6.8", version
    _real_processor_floor_is_effective()
    _real_model_merge_guard_catches_exact_failure_class()
    print("PASS pinned mlx-vlm 0.6.8 lower profile produces fewer real Qwen3 visual patches")
    print("PASS pinned Qwen3 model merge mismatch is intercepted before masked_scatter broadcast failure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())