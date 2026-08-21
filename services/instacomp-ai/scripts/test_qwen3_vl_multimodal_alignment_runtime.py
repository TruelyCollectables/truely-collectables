#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata

import mlx.core as mx
import numpy as np

import qwen3_multimodal_alignment_guard as guard
from mlx_vlm.models.qwen3_vl.processing_qwen3_vl import Qwen3VLImageProcessor


IMAGE_TOKEN_ID = 151655
VIDEO_TOKEN_ID = 151656
VISION_START_TOKEN_ID = 151652
VISION_END_TOKEN_ID = 151653


class _RuntimeImageProcessor:
    merge_size = 2


class _RuntimeProcessor:
    image_token_id = IMAGE_TOKEN_ID
    video_token_id = VIDEO_TOKEN_ID
    vision_start_token_id = VISION_START_TOKEN_ID
    vision_end_token_id = VISION_END_TOKEN_ID
    image_processor = _RuntimeImageProcessor()
    video_processor = _RuntimeImageProcessor()


class _BatchDataset:
    config = {"model_type": "qwen3_vl"}
    processor = _RuntimeProcessor()

    def __init__(self, item):
        self.item = item

    def __len__(self):
        return 1

    def __getitem__(self, _index):
        return self.item


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


def _real_pinned_batcher_preserves_late_vision_after_guard() -> None:
    from mlx_vlm.trainer import sft_trainer as trainer_module

    seq_len = 5000
    ids = np.full((1, seq_len), 7, dtype=np.int32)
    ids[0, 4299] = VISION_START_TOKEN_ID
    ids[0, 4300:4440] = IMAGE_TOKEN_ID
    ids[0, 4440] = VISION_END_TOKEN_ID
    completion = np.zeros((1, seq_len), dtype=np.int32)
    completion[0, 4500:] = 1

    # This is the exact upstream failure shape: its unguarded first-4096 slice
    # would have zero image tokens while the complete 560 vision patches remain.
    assert int(np.sum(ids[:, :4096] == IMAGE_TOKEN_ID)) == 0
    item = {
        "input_ids": mx.array(ids),
        "attention_mask": mx.ones((1, seq_len), dtype=mx.int32),
        "completion_mask": mx.array(completion),
        "pixel_values": mx.zeros((560, 1536), dtype=mx.float32),
        "image_grid_thw": mx.array(
            [[1, 14, 20], [1, 14, 20]], dtype=mx.int32
        ),
    }
    dataset = _BatchDataset(item)
    guard.validate_alignment(dataset, item, stage="pinned_raw_reproduction")
    guard.install_alignment_guards()

    batch = next(
        trainer_module.iterate_batches(
            dataset=dataset,
            batch_size=1,
            max_seq_length=4096,
            train=False,
        )
    )
    batch_ids = np.array(batch["input_ids"])
    batch_completion = np.array(batch["completion_mask"])
    assert batch_ids.shape == (1, 4096)
    assert int(np.sum(batch_ids == IMAGE_TOKEN_ID)) == 140
    assert int(np.sum(batch_ids == VISION_START_TOKEN_ID)) == 1
    assert int(np.sum(batch_ids == VISION_END_TOKEN_ID)) == 1
    assert int(np.sum(batch_completion)) == 500
    assert tuple(batch["pixel_values"].shape) == (560, 1536)
    assert tuple(batch["image_grid_thw"].shape) == (2, 3)
    guard.validate_alignment(dataset, batch, stage="pinned_collated_reproduction")


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
    _real_pinned_batcher_preserves_late_vision_after_guard()
    _real_model_merge_guard_catches_exact_failure_class()
    print("PASS pinned mlx-vlm 0.6.8 lower profile produces fewer real Qwen3 visual patches")
    print("PASS pinned mlx-vlm 0.6.8 late image tokens survive the exact 4096 batcher with full completion and vision tensors")
    print("PASS pinned Qwen3 model merge mismatch is intercepted before masked_scatter broadcast failure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())