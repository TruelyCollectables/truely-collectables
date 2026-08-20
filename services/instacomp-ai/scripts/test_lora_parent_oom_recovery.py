#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import run_lora_training_checkpoint_safe as guard


def _arg(command: list[str], flag: str) -> str:
    index = command.index(flag)
    return command[index + 1]


def _edge(command: list[str]) -> int:
    index = command.index("--image-resize-shape")
    return int(command[index + 1])


def _base(output_path: Path) -> list[str]:
    return [
        "python",
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


def _sigabrt_then_success() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        guard.STATUS_PATH = root / "status.json"
        guard.PARENT_OOM_RETRY_DELAY_SECONDS = 0
        output = root / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[list[str]] = []

        def fake_run(command: list[str], *_args, **_kwargs):
            calls.append(list(command))
            if len(calls) == 1:
                assert _edge(command) == 384
                assert _arg(command, "--max-seq-length") == "2048"
                output.write_bytes(b"partial-unsafe-weights")
                return subprocess.CompletedProcess(command, -6)
            assert not output.exists(), "partial OOM weights must be deleted before retry"
            assert _edge(command) == 320
            assert _arg(command, "--max-seq-length") == "1536"
            assert _arg(command, "--dataset") == "/trusted/curriculum"
            assert _arg(command, "--adapter-path") == "/certified/adapter"
            output.write_bytes(b"complete-safe-weights")
            return subprocess.CompletedProcess(command, 0)

        result = guard._run_training_supervised(_base(output), original_run=fake_run)
        assert result.returncode == 0
        assert len(calls) == 2


def _bounded_memory_ladder() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        guard.STATUS_PATH = root / "status.json"
        guard.PARENT_OOM_RETRY_DELAY_SECONDS = 0
        output = root / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[tuple[int, int]] = []

        def always_oom(command: list[str], *_args, **_kwargs):
            calls.append((_edge(command), int(_arg(command, "--max-seq-length"))))
            output.write_bytes(b"partial")
            return subprocess.CompletedProcess(command, -6)

        result = guard._run_training_supervised(_base(output), original_run=always_oom)
        assert result.returncode == -6
        assert calls == [(384, 2048), (320, 1536), (256, 1024)]


def _non_oom_failure_is_not_retried() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        guard.STATUS_PATH = root / "status.json"
        guard.PARENT_OOM_RETRY_DELAY_SECONDS = 0
        output = root / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[list[str]] = []

        def fail(command: list[str], *_args, **_kwargs):
            calls.append(list(command))
            return subprocess.CompletedProcess(command, 2)

        result = guard._run_training_supervised(_base(output), original_run=fail)
        assert result.returncode == 2
        assert len(calls) == 1


def main() -> int:
    _sigabrt_then_success()
    _bounded_memory_ladder()
    _non_oom_failure_is_not_retried()
    print("PASS parent survives Metal SIGABRT and retries a lower memory profile")
    print("PASS partial OOM weights are discarded while dataset and certified resume adapter stay unchanged")
    print("PASS memory ladder is bounded 384/2048 -> 320/1536 -> 256/1024")
    print("PASS non-OOM training failures are never retried as memory failures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
