#!/usr/bin/env python3
from __future__ import annotations

import os
import runpy
import subprocess
import sys
import time
from numbers import Integral
from pathlib import Path
from typing import Callable

from qwen3_multimodal_alignment_guard import (
    Qwen3MultimodalAlignmentError,
    install_alignment_guards,
    install_profile_pixel_floor,
)


RESIZE_COMPAT_MODEL_TYPES = (
    "qwen3_vl",
    "qwen3_5",
)
# The curriculum command intentionally requests max_seq_length=4096. mlx-vlm
# 0.6.8 truncates input_ids at max_seq_length without rebuilding pixel_values
# or image_grid_thw, so memory recovery must NEVER lower the requested
# multimodal sequence cap. Reduce image resolution only.
MAX_SAFE_IMAGE_EDGE = 320
MIN_SAFE_MULTIMODAL_SEQ_LENGTH = 2048
OOM_RETRY_IMAGE_EDGES = (288, 256)
OOM_EXIT_CODE = 86
MULTIMODAL_ALIGNMENT_EXIT_CODE = 87
RETRYABLE_OOM_RETURN_CODES = {-6, 134, OOM_EXIT_CODE}
RETRYABLE_PROFILE_RETURN_CODES = RETRYABLE_OOM_RETURN_CODES | {
    MULTIMODAL_ALIGNMENT_EXIT_CODE
}
WORKER_ENV = "INSTACOMP_MLX_LORA_WORKER"
PARENT_OOM_RETRY_DELAY_SECONDS = 2.0


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
    seq = requested_seq if requested_seq is not None else MIN_SAFE_MULTIMODAL_SEQ_LENGTH
    return edge, seq


def apply_memory_safe_profile(argv: list[str]) -> tuple[list[str], tuple[int, int], tuple[int, int]]:
    requested = _requested_image_resize(argv) or (MAX_SAFE_IMAGE_EDGE, MAX_SAFE_IMAGE_EDGE)
    if min(requested) < 224:
        raise SystemExit("--image-resize-shape values must be at least 224")

    requested_seq = _requested_max_seq_length(argv)
    safe_seq = requested_seq if requested_seq is not None else MIN_SAFE_MULTIMODAL_SEQ_LENGTH
    if safe_seq < MIN_SAFE_MULTIMODAL_SEQ_LENGTH:
        raise SystemExit(
            "Refusing unsafe InstaComp multimodal max_seq_length below 2048: "
            "mlx-vlm 0.6.8 truncates input_ids without rebuilding vision tensors, "
            "which can desynchronize Qwen image tokens and image features."
        )

    safe = (min(requested[0], MAX_SAFE_IMAGE_EDGE), min(requested[1], MAX_SAFE_IMAGE_EDGE))
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
    for edge in OOM_RETRY_IMAGE_EDGES:
        if edge < current_edge:
            updated = _set_image_resize(argv, edge)
            # Preserve the exact caller-requested multimodal sequence cap.
            updated = _set_scalar_arg(updated, "--max-seq-length", current_seq)
            return updated, (edge, current_seq)
    return None


def _output_path(argv: list[str]) -> Path | None:
    index = _flag_index(argv, "--output-path")
    if index is None or index + 1 >= len(argv):
        return None
    return Path(argv[index + 1]).expanduser()


def _clear_partial_output(argv: list[str]) -> None:
    output = _output_path(argv)
    if output is not None and output.is_file():
        # Preserve adapter_config.json in the bundle. Only weights emitted by a
        # killed/failed worker are unsafe to resume from.
        output.unlink()


def _normalize_mlx_repeat_count(repeats):
    """Convert only scalar integer-like MLX counts to the Python int API expects."""
    if isinstance(repeats, Integral):
        return int(repeats)

    item = getattr(repeats, "item", None)
    if not callable(item):
        return repeats

    try:
        scalar = item()
    except Exception:
        return repeats

    return int(scalar) if isinstance(scalar, Integral) else repeats


def _wrap_mlx_repeat_scalar_count(repeat_fn):
    if getattr(repeat_fn, "_instacomp_qwen3_scalar_repeat_compat", False):
        return repeat_fn

    def repeat_compat(array, repeats, axis=None, *, stream=None):
        normalized_repeats = _normalize_mlx_repeat_count(repeats)
        if stream is None:
            return repeat_fn(array, normalized_repeats, axis=axis)
        return repeat_fn(array, normalized_repeats, axis=axis, stream=stream)

    repeat_compat._instacomp_qwen3_scalar_repeat_compat = True
    return repeat_compat


class _MxRepeatCompatProxy:
    """Delegate all MLX calls except scalar repeat-count normalization."""

    def __init__(self, mx_module):
        self._mx_module = mx_module
        self.repeat = _wrap_mlx_repeat_scalar_count(mx_module.repeat)

    def __getattr__(self, name):
        return getattr(self._mx_module, name)


def install_qwen3_vision_repeat_compatibility() -> bool:
    """Patch only Qwen3-VL vision's local MLX namespace inside this worker.

    mlx-vlm 0.6.8 calls ``mx.repeat(seq_len, grid_thw[i, 0])`` where the second
    argument is an ``mlx.core.array`` scalar. Current MLX requires ``repeats``
    to be a Python integer. The worker is process-isolated, so replacing the
    qwen3_vl vision module's local ``mx`` reference is bounded to LoRA training.
    """
    from mlx_vlm.models.qwen3_vl import vision as vision_module

    if isinstance(vision_module.mx, _MxRepeatCompatProxy):
        return False
    if not hasattr(vision_module.mx, "repeat"):
        raise SystemExit(
            "InstaComp Qwen3-VL repeat compatibility guard could not find mx.repeat. "
            "Refusing to train against an unknown mlx-vlm/MLX layout."
        )

    vision_module.mx = _MxRepeatCompatProxy(vision_module.mx)
    print(
        "INSTACOMP MLX COMPAT: normalizing Qwen3-VL scalar mx.repeat counts "
        "to Python int inside the isolated training worker.",
        flush=True,
    )
    return True


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


def _run_worker(argv: list[str]) -> int:
    safe_argv, requested, safe = apply_memory_safe_profile(argv)
    sys.argv[:] = safe_argv
    profile_edge, safe_seq = _effective_profile(sys.argv)
    if requested != safe:
        print(
            "INSTACOMP MLX MEMORY PROFILE: clamped requested image resize "
            f"{requested[0]}x{requested[1]} to {safe[0]}x{safe[1]}; "
            f"max_seq_length={safe_seq} preserved.",
            flush=True,
        )
    else:
        print(
            "INSTACOMP MLX MEMORY PROFILE: using image resize "
            f"{safe[0]}x{safe[1]}; max_seq_length={safe_seq} preserved.",
            flush=True,
        )

    install_resize_compatibility()
    install_qwen3_vision_repeat_compatibility()
    install_profile_pixel_floor(profile_edge)
    install_alignment_guards()
    try:
        runpy.run_module("mlx_vlm.lora", run_name="__main__")
    except Qwen3MultimodalAlignmentError as exc:
        print(
            "INSTACOMP QWEN3 ALIGNMENT: bounded profile is incompatible with this multimodal batch; "
            f"no unsafe tensor coercion was attempted: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return MULTIMODAL_ALIGNMENT_EXIT_CODE
    except RuntimeError as exc:
        if not _is_metal_out_of_memory(exc):
            raise
        print(
            "INSTACOMP MLX WORKER OOM: Python observed Metal memory exhaustion; "
            "returning control to the parent supervisor.",
            file=sys.stderr,
            flush=True,
        )
        return OOM_EXIT_CODE
    return 0


def _worker_command(argv: list[str]) -> list[str]:
    return [sys.executable, str(Path(__file__).resolve()), *argv[1:]]


def supervise_training(
    argv: list[str],
    *,
    run_fn: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    retry_delay_seconds: float = PARENT_OOM_RETRY_DELAY_SECONDS,
) -> int:
    command_argv, requested, safe = apply_memory_safe_profile(argv)
    attempt = 0

    while True:
        attempt += 1
        edge, seq = _effective_profile(command_argv)
        _clear_partial_output(command_argv)
        if attempt == 1 and requested != safe:
            print(
                "INSTACOMP MLX PARENT MEMORY PROFILE: clamped requested image resize "
                f"{requested[0]}x{requested[1]} to {edge}x{edge}; "
                f"max_seq_length={seq} preserved.",
                flush=True,
            )
        print(
            "INSTACOMP MLX PARENT SUPERVISOR: "
            f"attempt={attempt} image={edge}x{edge} max_seq_length={seq}; "
            "trusted dataset, requested multimodal sequence cap, and certified resume adapter unchanged.",
            flush=True,
        )
        env = dict(os.environ)
        env[WORKER_ENV] = "1"
        result = run_fn(
            _worker_command(command_argv),
            env=env,
            check=False,
        )
        code = int(result.returncode)
        if code == 0:
            return 0
        if code not in RETRYABLE_PROFILE_RETURN_CODES:
            return code

        retry = _next_lower_memory_argv(command_argv)
        if retry is None:
            _clear_partial_output(command_argv)
            if code == MULTIMODAL_ALIGNMENT_EXIT_CODE:
                print(
                    "INSTACOMP QWEN3 ALIGNMENT: every bounded certified image profile failed multimodal alignment; "
                    "partial weights discarded and training remains failed closed.",
                    file=sys.stderr,
                    flush=True,
                )
            else:
                print(
                    "INSTACOMP MLX OOM: Metal exhausted every bounded certified image profile; "
                    "partial weights discarded and training remains failed closed.",
                    file=sys.stderr,
                    flush=True,
                )
            return code

        retry_argv, (next_edge, next_seq) = retry
        _clear_partial_output(command_argv)
        if code == MULTIMODAL_ALIGNMENT_EXIT_CODE:
            print(
                "INSTACOMP QWEN3 PARENT ALIGNMENT RECOVERY: worker detected a fail-fast text/grid/pixel/vision mismatch; "
                "discarded partial weights and restarting from the same certified adapter at "
                f"{next_edge}x{next_edge} with max_seq_length={next_seq} preserved exactly.",
                file=sys.stderr,
                flush=True,
            )
        else:
            print(
                "INSTACOMP MLX PARENT OOM RECOVERY: training worker ended with "
                f"returncode={code}; discarded partial weights and restarting from the "
                f"same certified adapter at {next_edge}x{next_edge} "
                f"with max_seq_length={next_seq} preserved exactly.",
                file=sys.stderr,
                flush=True,
            )
        if retry_delay_seconds > 0:
            time.sleep(retry_delay_seconds)
        command_argv = retry_argv


def main() -> int:
    if os.environ.get(WORKER_ENV) == "1":
        return _run_worker(list(sys.argv))
    return supervise_training(list(sys.argv))


if __name__ == "__main__":
    raise SystemExit(main())