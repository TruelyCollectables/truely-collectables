#!/usr/bin/env python3
from __future__ import annotations

import runpy


RESIZE_COMPAT_MODEL_TYPES = (
    "qwen3_vl",
    "qwen3_5",
)


def install_resize_compatibility() -> tuple[str, ...]:
    from mlx_vlm.trainer import datasets as datasets_module

    removed: list[str] = []
    for model_type in RESIZE_COMPAT_MODEL_TYPES:
        if model_type in datasets_module.NATIVE_PREPROCESS_MODELS:
            datasets_module.NATIVE_PREPROCESS_MODELS.remove(model_type)
            removed.append(model_type)

    if not removed:
        raise SystemExit(
            "InstaComp MLX resize compatibility guard did not find a supported "
            "Qwen3-VL native preprocessing route to patch. Refusing to train "
            "against an unknown mlx-vlm preprocessing layout."
        )

    print(
        "INSTACOMP MLX COMPAT: forcing resize-aware prepare_inputs path for "
        + ", ".join(removed),
        flush=True,
    )
    return tuple(removed)


def main() -> None:
    install_resize_compatibility()
    runpy.run_module("mlx_vlm.lora", run_name="__main__")


if __name__ == "__main__":
    main()
