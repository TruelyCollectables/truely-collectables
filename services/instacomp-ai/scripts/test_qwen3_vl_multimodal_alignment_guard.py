#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import mlx_vlm_lora_compat as compat
import qwen3_multimodal_alignment_guard as guard


IMAGE_TOKEN_ID = 151655


class _FakeArray:
    def __init__(self, values=None, *, shape=None):
        self._values = values
        self.shape = tuple(shape) if shape is not None else ()

    def tolist(self):
        return self._values


class _ImageProcessor:
    merge_size = 2


class _Processor:
    image_token_id = IMAGE_TOKEN_ID
    video_token_id = 151656
    image_processor = _ImageProcessor()
    video_processor = _ImageProcessor()


class _Dataset:
    config = {"model_type": "qwen3_vl"}
    processor = _Processor()


def _arg(command: list[str], flag: str) -> str:
    return command[command.index(flag) + 1]


def _edge(command: list[str]) -> int:
    return int(_arg(command, "--image-resize-shape"))


def _base(output_path: Path) -> list[str]:
    return [
        "/tmp/mlx_vlm_lora_compat.py",
        "--model-path",
        "model",
        "--dataset",
        "/trusted/curriculum",
        "--epochs",
        "1",
        "--image-resize-shape",
        "768",
        "768",
        "--max-seq-length",
        "4096",
        "--adapter-path",
        "/certified/adapter",
        "--output-path",
        str(output_path),
    ]


def _aligned_payload(*, pixel_patches: int = 560, tokens: int = 140):
    return {
        "input_ids": _FakeArray(
            [[IMAGE_TOKEN_ID] * tokens + [1, 2, 3]],
            shape=(1, tokens + 3),
        ),
        "image_grid_thw": _FakeArray(
            [[1, 14, 20], [1, 14, 20]],
            shape=(2, 3),
        ),
        "pixel_values": _FakeArray(shape=(pixel_patches, 1536)),
    }


def _four_way_alignment_contract() -> None:
    dataset = _Dataset()
    payload = _aligned_payload()
    snapshot = guard.alignment_snapshot(dataset, payload)
    assert snapshot["image"] == {
        "tokens": 140,
        "grid_patches": 560,
        "pixel_patches": 560,
        "expected_tokens": 140,
    }
    guard.validate_alignment(dataset, payload, stage="unit")

    for bad_payload, expected_fragment in (
        (_aligned_payload(pixel_patches=448), "pixel_patches=448"),
        (_aligned_payload(tokens=112), "text_tokens=112"),
    ):
        try:
            guard.validate_alignment(dataset, bad_payload, stage="unit")
        except guard.Qwen3MultimodalAlignmentError as exc:
            text = str(exc)
            assert "before model update" in text
            assert expected_fragment in text
        else:
            raise AssertionError("mismatched Qwen3 multimodal geometry must fail before model update")


def _lower_profile_can_escape_checkpoint_min_pixel_floor() -> None:
    card = _FakeArray(shape=(3, 183, 256))
    rounded_area = guard._rounded_area_without_minimum_upscale(card, factor=32)
    assert rounded_area == 192 * 256
    assert rounded_area < 65536


def _alignment_failure_retries_image_only_and_preserves_4096() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        seen: list[tuple[int, int]] = []

        def fake_run(command: list[str], **kwargs):
            seen.append((_edge(command), int(_arg(command, "--max-seq-length"))))
            assert kwargs["env"][compat.WORKER_ENV] == "1"
            if len(seen) == 1:
                output.write_bytes(b"partial-alignment-unsafe")
                return subprocess.CompletedProcess(
                    command, compat.MULTIMODAL_ALIGNMENT_EXIT_CODE
                )
            assert not output.exists(), "alignment retry must discard partial weights"
            assert _arg(command, "--dataset") == "/trusted/curriculum"
            assert _arg(command, "--adapter-path") == "/certified/adapter"
            return subprocess.CompletedProcess(command, 0)

        code = compat.supervise_training(
            _base(output), run_fn=fake_run, retry_delay_seconds=0
        )
        assert code == 0
        assert seen == [(320, 4096), (288, 4096)]


def _persistent_alignment_failure_is_bounded_and_fails_closed() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        seen: list[tuple[int, int]] = []

        def always_mismatch(command: list[str], **_kwargs):
            seen.append((_edge(command), int(_arg(command, "--max-seq-length"))))
            output.write_bytes(b"partial")
            return subprocess.CompletedProcess(
                command, compat.MULTIMODAL_ALIGNMENT_EXIT_CODE
            )

        code = compat.supervise_training(
            _base(output), run_fn=always_mismatch, retry_delay_seconds=0
        )
        assert code == compat.MULTIMODAL_ALIGNMENT_EXIT_CODE
        assert seen == [(320, 4096), (288, 4096), (256, 4096)]
        assert not output.exists()


def main() -> int:
    _four_way_alignment_contract()
    _lower_profile_can_escape_checkpoint_min_pixel_floor()
    _alignment_failure_retries_image_only_and_preserves_4096()
    _persistent_alignment_failure_is_bounded_and_fails_closed()
    print("PASS Qwen3 alignment guard compares text tokens, grid patches, and pixel patches before model update")
    print("PASS lower Qwen3 retry profiles can bypass the checkpoint 65536 min-pixel upscale floor")
    print("PASS alignment recovery uses 320/4096 -> 288/4096 -> 256/4096 only")
    print("PASS alignment retries discard partial weights and preserve dataset plus certified resume adapter")
    print("PASS persistent multimodal mismatch fails closed after the bounded image ladder")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())