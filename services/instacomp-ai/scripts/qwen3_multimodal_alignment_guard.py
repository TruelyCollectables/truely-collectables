#!/usr/bin/env python3
from __future__ import annotations

from math import prod
from typing import Any

SUPPORTED_MODEL_TYPES = {"qwen3_vl", "qwen3_5"}
BASELINE_PROFILE_EDGE = 320


class Qwen3MultimodalAlignmentError(RuntimeError):
    """Qwen3 text/grid/pixel/vision geometry disagreed before a safe update."""


def _tolist(value: Any) -> Any:
    method = getattr(value, "tolist", None)
    if callable(method):
        return method()
    return value


def _flatten(value: Any):
    value = _tolist(value)
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
        return
    yield value


def _shape(value: Any) -> tuple[int, ...]:
    raw = getattr(value, "shape", None)
    if raw is None:
        return ()
    return tuple(int(part) for part in raw)


def _model_type(dataset: Any) -> str:
    config = getattr(dataset, "config", None)
    if isinstance(config, dict):
        return str(config.get("model_type") or "")
    return str(getattr(config, "model_type", "") or "")


def _processor(dataset: Any) -> Any:
    return getattr(dataset, "processor", None)


def _token_id(processor: Any, name: str) -> int | None:
    value = getattr(processor, name, None)
    if value is None:
        value = getattr(getattr(processor, "tokenizer", None), name, None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _merge_size(processor: Any, *, video: bool = False) -> int:
    media_processor = (
        getattr(processor, "video_processor", None)
        if video
        else getattr(processor, "image_processor", None)
    )
    if media_processor is None and video:
        media_processor = getattr(processor, "image_processor", None)
    value = getattr(media_processor, "merge_size", None)
    try:
        merge_size = int(value)
    except (TypeError, ValueError) as exc:
        raise Qwen3MultimodalAlignmentError(
            "Qwen3 processor does not expose an integer merge_size; refusing unknown multimodal geometry."
        ) from exc
    if merge_size <= 0:
        raise Qwen3MultimodalAlignmentError(
            f"Qwen3 processor exposed invalid merge_size={merge_size}."
        )
    return merge_size


def _grid_patch_count(value: Any) -> int:
    rows = _tolist(value)
    if rows is None:
        return 0
    if isinstance(rows, tuple):
        rows = list(rows)
    if not isinstance(rows, list):
        raise Qwen3MultimodalAlignmentError(
            f"Qwen3 grid_thw must be list-like, got {type(rows).__name__}."
        )
    if len(rows) == 3 and all(not isinstance(part, (list, tuple)) for part in rows):
        rows = [rows]
    total = 0
    for row in rows:
        row = _tolist(row)
        if not isinstance(row, (list, tuple)) or len(row) != 3:
            raise Qwen3MultimodalAlignmentError(
                f"Qwen3 grid_thw row must contain exactly three values, got {row!r}."
            )
        try:
            t, h, w = (int(part) for part in row)
        except (TypeError, ValueError) as exc:
            raise Qwen3MultimodalAlignmentError(
                f"Qwen3 grid_thw row contains a non-integer value: {row!r}."
            ) from exc
        if min(t, h, w) <= 0:
            raise Qwen3MultimodalAlignmentError(
                f"Qwen3 grid_thw row contains a non-positive value: {row!r}."
            )
        total += t * h * w
    return total


def _visual_token_count(input_ids: Any, token_id: int | None) -> int:
    if token_id is None or input_ids is None:
        return 0
    count = 0
    for value in _flatten(input_ids):
        try:
            count += int(value) == token_id
        except (TypeError, ValueError):
            continue
    return int(count)


def _pixel_patch_rows(pixel_values: Any) -> int:
    if pixel_values is None:
        return 0
    shape = _shape(pixel_values)
    if len(shape) < 2 or any(part <= 0 for part in shape):
        raise Qwen3MultimodalAlignmentError(
            f"Qwen3 pixel tensor has an invalid shape: {shape!r}."
        )
    # Qwen3 pixel_values is (..., patch_feature_width). The trainer may add a
    # leading batch dimension, but every preceding dimension still represents
    # complete vision patch rows consumed by PatchEmbed.
    return int(prod(shape[:-1]))


def _media_alignment(
    *,
    processor: Any,
    payload: dict[str, Any],
    grid_key: str,
    pixel_key: str,
    token_name: str,
    video: bool,
) -> dict[str, int]:
    grid = payload.get(grid_key)
    pixels = payload.get(pixel_key)
    token_id = _token_id(processor, token_name)
    actual_tokens = _visual_token_count(payload.get("input_ids"), token_id)
    grid_patches = _grid_patch_count(grid) if grid is not None else 0
    pixel_patches = _pixel_patch_rows(pixels) if pixels is not None else 0

    if grid_patches == 0 and pixel_patches == 0 and actual_tokens == 0:
        return {
            "tokens": 0,
            "grid_patches": 0,
            "pixel_patches": 0,
            "expected_tokens": 0,
        }

    merge_size = _merge_size(processor, video=video)
    merge_area = merge_size * merge_size
    if grid_patches % merge_area != 0:
        raise Qwen3MultimodalAlignmentError(
            f"{grid_key} patch count {grid_patches} is not divisible by merge area {merge_area}."
        )
    expected_tokens = grid_patches // merge_area
    return {
        "tokens": actual_tokens,
        "grid_patches": grid_patches,
        "pixel_patches": pixel_patches,
        "expected_tokens": expected_tokens,
    }


def alignment_snapshot(dataset: Any, payload: dict[str, Any]) -> dict[str, dict[str, int]]:
    processor = _processor(dataset)
    return {
        "image": _media_alignment(
            processor=processor,
            payload=payload,
            grid_key="image_grid_thw",
            pixel_key="pixel_values",
            token_name="image_token_id",
            video=False,
        ),
        "video": _media_alignment(
            processor=processor,
            payload=payload,
            grid_key="video_grid_thw",
            pixel_key="pixel_values_videos",
            token_name="video_token_id",
            video=True,
        ),
    }


def validate_alignment(dataset: Any, payload: dict[str, Any], *, stage: str) -> None:
    if _model_type(dataset) not in SUPPORTED_MODEL_TYPES:
        return
    snapshot = alignment_snapshot(dataset, payload)
    for media, counts in snapshot.items():
        if not any(counts.values()):
            continue
        if (
            counts["tokens"] != counts["expected_tokens"]
            or counts["pixel_patches"] != counts["grid_patches"]
        ):
            raise Qwen3MultimodalAlignmentError(
                "Qwen3 multimodal alignment mismatch before model update: "
                f"stage={stage} media={media} text_tokens={counts['tokens']} "
                f"grid_expected_tokens={counts['expected_tokens']} "
                f"grid_patches={counts['grid_patches']} "
                f"pixel_patches={counts['pixel_patches']}."
            )


def _rounded_area_without_minimum_upscale(image: Any, *, factor: int) -> int:
    shape = _shape(image)
    if len(shape) != 3:
        raise Qwen3MultimodalAlignmentError(
            f"Qwen3 image processor expected CHW input, got shape {shape!r}."
        )
    _channels, height, width = shape
    rounded_h = max(factor, round(height / factor) * factor)
    rounded_w = max(factor, round(width / factor) * factor)
    return int(rounded_h * rounded_w)


def install_profile_pixel_floor(profile_edge: int) -> bool:
    """Prevent Qwen's checkpoint min_pixels floor from undoing lower retry edges."""
    if profile_edge >= BASELINE_PROFILE_EDGE:
        return False

    from mlx_vlm.models.qwen3_vl.processing_qwen3_vl import Qwen3VLImageProcessor

    original = Qwen3VLImageProcessor._process_one
    if getattr(original, "_instacomp_profile_pixel_floor", False):
        return False

    def process_one(
        self,
        image,
        min_pixels=None,
        max_pixels=None,
        resized_height=None,
        resized_width=None,
    ):
        if resized_height is None and resized_width is None:
            factor = int(self.patch_size) * int(self.merge_size)
            rounded_area = _rounded_area_without_minimum_upscale(image, factor=factor)
            configured_min = int(self.min_pixels if min_pixels is None else min_pixels)
            min_pixels = min(configured_min, rounded_area)
        return original(
            self,
            image,
            min_pixels=min_pixels,
            max_pixels=max_pixels,
            resized_height=resized_height,
            resized_width=resized_width,
        )

    process_one._instacomp_profile_pixel_floor = True
    Qwen3VLImageProcessor._process_one = process_one
    print(
        "INSTACOMP QWEN3 PROFILE: lower image retry will not be upscaled by the checkpoint min_pixels floor; "
        f"profile_edge={profile_edge}, max_seq_length remains caller-controlled.",
        flush=True,
    )
    return True


def install_alignment_guards() -> tuple[bool, bool, bool]:
    """Install raw-dataset, collated-batch, and model-merge fail-fast checks."""
    from mlx_vlm.models.qwen3_vl import qwen3_vl as model_module
    from mlx_vlm.trainer import datasets as datasets_module
    from mlx_vlm.trainer import sft_trainer as trainer_module

    process_installed = False
    original_process = datasets_module.VisionDataset.process
    if not getattr(original_process, "_instacomp_qwen3_alignment_guard", False):
        def process_guard(dataset, item):
            result = original_process(dataset, item)
            validate_alignment(dataset, result, stage="raw_dataset")
            return result

        process_guard._instacomp_qwen3_alignment_guard = True
        datasets_module.VisionDataset.process = process_guard
        process_installed = True

    iterate_installed = False
    original_iterate = trainer_module.iterate_batches
    if not getattr(original_iterate, "_instacomp_qwen3_alignment_guard", False):
        def iterate_guard(*args, **kwargs):
            dataset = kwargs.get("dataset") if "dataset" in kwargs else args[0]
            max_seq_length = (
                kwargs.get("max_seq_length")
                if "max_seq_length" in kwargs
                else (args[2] if len(args) > 2 else None)
            )
            for batch in original_iterate(*args, **kwargs):
                validate_alignment(
                    dataset,
                    batch,
                    stage=f"collated_batch:max_seq_length={max_seq_length}",
                )
                yield batch

        iterate_guard._instacomp_qwen3_alignment_guard = True
        trainer_module.iterate_batches = iterate_guard
        iterate_installed = True

    merge_installed = False
    original_merge = model_module.Model.merge_input_ids_with_image_features
    if not getattr(original_merge, "_instacomp_qwen3_alignment_guard", False):
        def merge_guard(
            image_features,
            inputs_embeds,
            input_ids,
            image_token_index,
            video_token_index,
        ):
            token_count = _visual_token_count(input_ids, int(image_token_index))
            token_count += _visual_token_count(input_ids, int(video_token_index))
            feature_shape = _shape(image_features)
            feature_count = int(feature_shape[0]) if feature_shape else 0
            if token_count != feature_count:
                raise Qwen3MultimodalAlignmentError(
                    "Qwen3 model merge alignment mismatch before masked scatter: "
                    f"text_visual_tokens={token_count} vision_features={feature_count}."
                )
            return original_merge(
                image_features,
                inputs_embeds,
                input_ids,
                image_token_index,
                video_token_index,
            )

        merge_guard._instacomp_qwen3_alignment_guard = True
        model_module.Model.merge_input_ids_with_image_features = staticmethod(merge_guard)
        merge_installed = True

    print(
        "INSTACOMP QWEN3 ALIGNMENT GUARD: validating text tokens, grid geometry, pixel patches, and model features before every update.",
        flush=True,
    )
    return process_installed, iterate_installed, merge_installed
