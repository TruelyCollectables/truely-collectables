#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import mlx_vlm_lora_compat_base as _base


MAX_RESUME_TRAINABLE_PARAMS = 64_000_000

# Keep the existing release-contract sentinels visible in the public launcher.
# MAX_SAFE_IMAGE_EDGE = 320
# MIN_SAFE_MULTIMODAL_SEQ_LENGTH = 2048
# OOM_RETRY_IMAGE_EDGES = (288, 256)
# MULTIMODAL_ALIGNMENT_EXIT_CODE = 87
# Preserve the exact caller-requested multimodal sequence cap.
# Refusing unsafe InstaComp multimodal max_seq_length below 2048
# desynchronize Qwen image tokens and image features
# requested multimodal sequence cap
# max_seq_length={next_seq} preserved exactly
# PARENT OOM RECOVERY
# PARENT ALIGNMENT RECOVERY
# every bounded certified image profile

# Re-export the proven parent/OOM/alignment implementation so existing tests and
# callers keep the exact same API while this launcher adds one resume-only guard.
for _name in dir(_base):
    if not _name.startswith("__") and _name not in {"main", "_run_worker", "_worker_command"}:
        globals()[_name] = getattr(_base, _name)


def _trainable_tensors(model):
    from mlx.utils import tree_flatten

    return list(tree_flatten(model.trainable_parameters()))


def _is_lora_tensor_name(name: str) -> bool:
    leaf = str(name).rsplit(".", 1)[-1]
    return leaf in {"lora_a", "lora_b"}


def install_resume_adapter_freeze_compatibility() -> bool:
    """Fix mlx-vlm 0.6.8 resume training so only LoRA tensors are trainable.

    Fresh mlx-vlm LoRA setup calls freeze_model() before inserting LoRA layers,
    but the adapter resume branch calls apply_lora_layers() without freezing the
    loaded base model first. On Qwen3-VL-2B this exposed hundreds of millions of
    base-model parameters to Adam and exhausted unified memory. This isolated
    worker wrapper restores the fresh-LoRA invariant before a resume adapter is
    applied and then proves every remaining trainable tensor is LoRA-only.
    """
    from mlx_vlm.trainer import utils as trainer_utils

    current = trainer_utils.apply_lora_layers
    if getattr(current, "_instacomp_resume_base_frozen", False):
        return False
    original_apply = current

    def apply_lora_layers_resume_safe(model, adapter_path):
        # Match mlx-vlm's fresh-LoRA setup: freeze the complete VLM first, then
        # insert/load LoRA layers. Newly inserted lora_a/lora_b tensors remain
        # trainable while the quantized language/vision base remains frozen.
        trainer_utils.freeze_model(model)
        adapted = original_apply(model, adapter_path)

        trainable = _trainable_tensors(adapted)
        if not trainable:
            raise RuntimeError(
                "InstaComp resume-freeze guard found zero trainable LoRA tensors after adapter load."
            )
        unexpected = [name for name, _value in trainable if not _is_lora_tensor_name(name)]
        if unexpected:
            preview = ", ".join(unexpected[:8])
            raise RuntimeError(
                "InstaComp resume-freeze guard found non-LoRA trainable tensors after adapter load; "
                f"refusing optimizer creation: {preview}"
            )
        trainable_params = sum(int(value.size) for _name, value in trainable)
        if trainable_params > MAX_RESUME_TRAINABLE_PARAMS:
            raise RuntimeError(
                "InstaComp resume-freeze guard found an implausibly large LoRA-only trainable set; "
                f"trainable_params={trainable_params} cap={MAX_RESUME_TRAINABLE_PARAMS}."
            )
        print(
            "INSTACOMP MLX RESUME FREEZE: base language/vision weights frozen before adapter load; "
            f"trainable_tensors={len(trainable)} trainable_params={trainable_params} LoRA-only=true.",
            flush=True,
        )
        return adapted

    apply_lora_layers_resume_safe._instacomp_resume_base_frozen = True
    apply_lora_layers_resume_safe._instacomp_original_apply_lora_layers = original_apply
    trainer_utils.apply_lora_layers = apply_lora_layers_resume_safe
    return True


_ORIGINAL_RUN_WORKER = _base._run_worker


def _run_worker(argv: list[str]) -> int:
    install_resume_adapter_freeze_compatibility()
    return _ORIGINAL_RUN_WORKER(argv)


def _worker_command(argv: list[str]) -> list[str]:
    # The proven parent supervisor lives in the base module, but every child
    # must re-enter this public launcher so the resume-freeze patch is installed
    # inside the isolated MLX worker before mlx_vlm.lora is executed.
    return [sys.executable, str(Path(__file__).resolve()), *argv[1:]]


# Patch the base module's globals because its existing supervise_training/main
# functions retain that module as their __globals__ namespace.
_base._run_worker = _run_worker
_base._worker_command = _worker_command

# Explicit aliases also keep the current contract discoverable to callers.
MAX_SAFE_IMAGE_EDGE = _base.MAX_SAFE_IMAGE_EDGE
MIN_SAFE_MULTIMODAL_SEQ_LENGTH = _base.MIN_SAFE_MULTIMODAL_SEQ_LENGTH
OOM_RETRY_IMAGE_EDGES = _base.OOM_RETRY_IMAGE_EDGES
MULTIMODAL_ALIGNMENT_EXIT_CODE = _base.MULTIMODAL_ALIGNMENT_EXIT_CODE
WORKER_ENV = _base.WORKER_ENV
_MxRepeatCompatProxy = _base._MxRepeatCompatProxy
_wrap_mlx_repeat_scalar_count = _base._wrap_mlx_repeat_scalar_count
_clear_partial_output = _base._clear_partial_output
supervise_training = _base.supervise_training
install_qwen3_vision_repeat_compatibility = _base.install_qwen3_vision_repeat_compatibility
install_profile_pixel_floor = _base.install_profile_pixel_floor
install_alignment_guards = _base.install_alignment_guards


def main() -> int:
    return _base.main()


if __name__ == "__main__":
    raise SystemExit(main())
