#!/usr/bin/env python3
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


RESIZE_COMPAT_MODEL_TYPES = (
    "qwen3_vl",
    "qwen3_5",
)
# 512x512 + 3072 tokens exhausted Metal on the production Mac at the first
# curriculum iteration. Start materially below that measured failure point and
# preserve deterministic lower profiles for either in-process or parent-process
# OOM recovery.
MAX_SAFE_IMAGE_EDGE = 384
SAFE_MAX_SEQ_LENGTH = 2048
OOM_RETRY_PROFILES = (
    (320, 1536),
    (256, 1024),
)
OOM_EXIT_CODE = 86


def _flag_index(argv: list[str], flag: str) -> int | None:
    try:
        return argv.index(flag)
    except ValueError:
        return None


def _set_scalar_arg(argv: list[str], flag: str, value: int) -> list[str]:
    updated = list(argv)
    index = _flag_index(updated, flag)
    if index is None:
        updated.extend([flag, str(value)])
        return updated
    if index + 1 >= len(updated):
        raise SystemExit(f"{flag} is missing its value")
    updated[index + 1] = str(value)
    return updated


def _set_image_resize(argv: list[str], edge: int) -> list[str]:
    updated = list(argv)
    index = _flag_index(updated, "--image-resize-shape")
    if index is None:
        updated.extend(["--image-resize-shape", str(edge), str(edge)])
        return updated
    if index + 2 >= len(updated):
        raise SystemExit("--image-resize-shape requires HEIGHT WIDTH")
    updated[index + 1] = str(edge)
    updated[index + 2] = str(edge)
    return updated


def _requested_image_resize(argv: list[str]) -> tuple[int, int] | None:
    index = _flag_index(argv, "--image-resize-shape")
    if index is None:
        return None
    if index + 2 >= len(argv):
        raise SystemExit("--image-resize-shape requires HEIGHT WIDTH")
    try:
        return int(argv[index + 1]), int(argv[index + 2])
    except ValueError as exc:
        raise SystemExit("--image-resize-shape values must be integers") from exc


def _requested_max_seq_length(argv: list[str]) -> int | None:
    index = _flag_index(argv, "--max-seq-length")
    if index is None:
        return None
    if index + 1 >= len(argv):
        raise SystemExit("--max-seq-length is missing its value")
    try:
        return int(argv[index + 1])
    except ValueError as exc:
        raise SystemExit("--max-seq-length must be an integer") from exc


def _effective_profile(argv: list[str]) -> tuple[int, int]:
    requested_resize = _requested_image_resize(argv) or (
        MAX_SAFE_IMAGE_EDGE,
        MAX_SAFE_IMAGE_EDGE,
    )
    edge = min(max(requested_resize), MAX_SAFE_IMAGE_EDGE)
    requested_seq = _requested_max_seq_length(argv)
    seq = min(requested_seq or SAFE_MAX_SEQ_LENGTH, SAFE_MAX_SEQ_LENGTH)
    return edge, seq


def apply_memory_safe_profile(argv: list[str]) -> tuple[list[str], tuple[int, int], tuple[int, int]]:
    requested = _requested_image_resize(argv) or (MAX_SAFE_IMAGE_EDGE, MAX_SAFE_IMAGE_EDGE)
    if min(requested) < 224:
        raise SystemExit("--image-resize-shape values must be at least 224")
    safe = (min(requested[0], MAX_SAFE_IMAGE_EDGE), min(requested[1], MAX_SAFE_IMAGE_EDGE))
    requested_seq = _requested_max_seq_length(argv)
    safe_seq = min(requested_seq or SAFE_MAX_SEQ_LENGTH, SAFE_MAX_SEQ_LENGTH)
    if safe_seq < 512:
        raise SystemExit("--max-seq-length must be at least 512 for InstaComp LoRA training")
    updated = list(argv)
    index = _flag_index(updated, "--image-resize-shape")
    if index is None:
        updated.extend(["--image-resize-shape", str(safe[0]), str(safe[1])])
    else:
        updated[index + 1] = str(safe[0])
        updated[index + 2] = str(safe[1])
    updated = _set_scalar_arg(updated, "--max-seq-length", safe_seq)
    return updated, requested, safe


def _next_lower_memory_argv(argv: list[str]) -> tuple[list[str], tuple[int, int]] | None:
    current_edge, current_seq = _effective_profile(argv)
    for edge, seq in OOM_RETRY_PROFILES:
        if edge < current_edge or seq < current_seq:
            updated = _set_image_resize(argv, edge)
            updated = _set_scalar_arg(updated, "--max-seq-length", seq)
            return updated, (edge, seq)
    return None


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


def _is_metal_out_of_memory(exc: BaseException) -> bool:
    text = str(exc).lower()
    return (
        "insufficient memory" in text
        or "kiogpucommandbuffercallbackerroroutofmemory" in text
        or "outofmemory" in text
    )


def main() -> None:
    safe_argv, requested, safe = apply_memory_safe_profile(list(sys.argv))
    sys.argv[:] = safe_argv
    _edge, safe_seq = _effective_profile(sys.argv)
    if requested != safe:
        print(
            "INSTACOMP MLX MEMORY PROFILE: clamped requested image resize "
            f"{requested[0]}x{requested[1]} to {safe[0]}x{safe[1]}; "
            f"max_seq_length={safe_seq}.",
            flush=True,
        )
    else:
        print(
            "INSTACOMP MLX MEMORY PROFILE: using image resize "
            f"{safe[0]}x{safe[1]}; max_seq_length={safe_seq}.",
            flush=True,
        )

    install_resize_compatibility()
    try:
        runpy.run_module("mlx_vlm.lora", run_name="__main__")
    except RuntimeError as exc:
        if not _is_metal_out_of_memory(exc):
            raise
        retry = _next_lower_memory_argv(list(sys.argv))
        if retry is None:
            print(
                "INSTACOMP MLX OOM: Metal still exhausted unified memory at the lowest "
                "certified image/token profile; refusing an unsafe retry.",
                file=sys.stderr,
                flush=True,
            )
            raise SystemExit(OOM_EXIT_CODE) from exc
        retry_argv, (next_edge, next_seq) = retry
        print(
            "INSTACOMP MLX OOM RECOVERY: restarting this training pass from the base model "
            f"at {next_edge}x{next_edge} max_seq_length={next_seq}; "
            "the trusted dataset is unchanged.",
            file=sys.stderr,
            flush=True,
        )
        os.execv(
            sys.executable,
            [sys.executable, str(Path(__file__).resolve()), *retry_argv[1:]],
        )
        raise AssertionError("os.execv returned unexpectedly")


if __name__ == "__main__":
    main()
