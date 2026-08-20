#!/usr/bin/env python3
from __future__ import annotations

import mlx.core as mx

import mlx_vlm_lora_compat as compat


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

    installed_again = compat.install_qwen3_vision_repeat_compatibility()
    assert installed_again is False

    print(
        "PASS pinned Qwen3-VL vision accepts mlx scalar repeat counts after "
        "InstaComp worker compatibility install"
    )
    print("PASS ordinary Python-int mx.repeat behavior remains unchanged")
    print("PASS Qwen3-VL repeat compatibility install is idempotent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
