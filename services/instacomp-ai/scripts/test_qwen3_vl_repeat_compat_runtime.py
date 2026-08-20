#!/usr/bin/env python3
from __future__ import annotations

import mlx.core as mx

import mlx_vlm_lora_compat as compat


class _FakeVisionInstance:
    """Minimal state needed to execute pinned VisionModel.__call__ exactly."""

    def __init__(self, template: mx.array):
        self.patch_embed = lambda hidden_states: hidden_states
        self.fast_pos_embed_interpolate = lambda _grid: mx.zeros_like(template)
        self.rot_pos_emb = lambda _grid: mx.zeros_like(template)
        self.blocks = []
        self.deepstack_visual_indexes = []
        self.deepstack_merger_list = []
        self.merger = lambda hidden_states: hidden_states


def main() -> int:
    from mlx_vlm.models.qwen3_vl import vision as vision_module

    installed = compat.install_qwen3_vision_repeat_compatibility()
    assert installed is True

    seq_len = mx.array(25, dtype=mx.int32)
    frame_count = mx.array(2, dtype=mx.int32)
    repeated = vision_module.mx.repeat(seq_len, frame_count)
    assert repeated.tolist() == [25, 25]

    ordinary = vision_module.mx.repeat(mx.array([1, 2], dtype=mx.int32), 2)
    assert ordinary.tolist() == [1, 1, 2, 2]

    # Execute the real mlx-vlm 0.6.8 Qwen3-VL VisionModel.__call__ method with
    # lightweight fake layers. This reaches the exact failing line from the Mac:
    #   mx.repeat(seq_len, grid_thw[i, 0])
    # where both seq_len and grid_thw[i, 0] are mlx.core.array scalars.
    grid_thw = mx.array([[1, 2, 3], [2, 1, 2]], dtype=mx.int32)
    hidden_states = mx.zeros((10, 4), dtype=mx.float32)
    fake_vision = _FakeVisionInstance(hidden_states)
    features, deepstack = vision_module.VisionModel.__call__(
        fake_vision, hidden_states, grid_thw
    )
    assert features.shape == (10, 4)
    assert deepstack == []

    installed_again = compat.install_qwen3_vision_repeat_compatibility()
    assert installed_again is False

    print(
        "PASS pinned Qwen3-VL vision accepts mlx scalar repeat counts after "
        "InstaComp worker compatibility install"
    )
    print("PASS exact pinned VisionModel.__call__ scalar-repeat path completes")
    print("PASS ordinary Python-int mx.repeat behavior remains unchanged")
    print("PASS Qwen3-VL repeat compatibility install is idempotent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
