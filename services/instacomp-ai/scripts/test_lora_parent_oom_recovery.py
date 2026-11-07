#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import mlx_vlm_lora_compat as compat


class _FakeScalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class _FakeMx:
    def __init__(self):
        self.calls: list[tuple[object, object, object, object]] = []
        self.delegated_marker = "delegated"

    def repeat(self, array, repeats, axis=None, *, stream=None):
        self.calls.append((array, repeats, axis, stream))
        return repeats


def _arg(command: list[str], flag: str) -> str:
    index = command.index(flag)
    return command[index + 1]


def _edge(command: list[str]) -> int:
    index = command.index("--image-resize-shape")
    return int(command[index + 1])


def _base(output_path: Path, *, max_seq_length: int = 4096) -> list[str]:
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
        str(max_seq_length),
        "--adapter-path",
        "/certified/adapter",
        "--output-path",
        str(output_path),
    ]


def _repeat_scalar_compat_is_narrow_and_idempotent() -> None:
    fake_mx = _FakeMx()
    proxy = compat._MxRepeatCompatProxy(fake_mx)

    result = proxy.repeat("seq", _FakeScalar(2), axis=0)
    assert result == 2
    assert fake_mx.calls[-1] == ("seq", 2, 0, None)
    assert isinstance(fake_mx.calls[-1][1], int)

    result = proxy.repeat("seq", 3, stream="metal")
    assert result == 3
    assert fake_mx.calls[-1] == ("seq", 3, None, "metal")

    non_integer_scalar = _FakeScalar(1.5)
    result = proxy.repeat("seq", non_integer_scalar)
    assert result is non_integer_scalar
    assert fake_mx.calls[-1][1] is non_integer_scalar

    assert proxy.delegated_marker == "delegated"
    assert compat._wrap_mlx_repeat_scalar_count(proxy.repeat) is proxy.repeat


def _sigabrt_then_success_preserves_requested_seq() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[list[str]] = []

        def fake_run(command: list[str], **kwargs):
            calls.append(list(command))
            assert kwargs["check"] is False
            assert kwargs["env"][compat.WORKER_ENV] == "1"
            if len(calls) == 1:
                assert _edge(command) == 320
                assert _arg(command, "--max-seq-length") == "4096"
                output.write_bytes(b"partial-unsafe-weights")
                return subprocess.CompletedProcess(command, -6)
            assert not output.exists(), "partial OOM weights must be deleted before retry"
            assert _edge(command) == 288
            assert _arg(command, "--max-seq-length") == "4096"
            assert _arg(command, "--dataset") == "/trusted/curriculum"
            assert _arg(command, "--adapter-path") == "/certified/adapter"
            output.write_bytes(b"complete-safe-weights")
            return subprocess.CompletedProcess(command, 0)

        code = compat.supervise_training(_base(output), run_fn=fake_run, retry_delay_seconds=0)
        assert code == 0
        assert len(calls) == 2


def _bounded_image_ladder_never_changes_sequence_cap() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[tuple[int, int]] = []

        def always_oom(command: list[str], **_kwargs):
            calls.append((_edge(command), int(_arg(command, "--max-seq-length"))))
            output.write_bytes(b"partial")
            return subprocess.CompletedProcess(command, -6)

        code = compat.supervise_training(_base(output), run_fn=always_oom, retry_delay_seconds=0)
        assert code == -6
        assert calls == [(320, 4096), (288, 4096), (256, 4096)]
        assert not output.exists(), "failed lowest-profile weights must be discarded"


def _accepted_minimum_sequence_is_preserved() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        seen: list[tuple[int, int]] = []

        def success(command: list[str], **_kwargs):
            seen.append((_edge(command), int(_arg(command, "--max-seq-length"))))
            return subprocess.CompletedProcess(command, 0)

        code = compat.supervise_training(
            _base(output, max_seq_length=2048), run_fn=success, retry_delay_seconds=0
        )
        assert code == 0
        assert seen == [(320, 2048)]


def _unsafe_short_sequence_profile_is_rejected() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        called = False

        def should_not_run(command: list[str], **_kwargs):
            nonlocal called
            called = True
            return subprocess.CompletedProcess(command, 0)

        try:
            compat.supervise_training(
                _base(output, max_seq_length=1536),
                run_fn=should_not_run,
                retry_delay_seconds=0,
            )
        except SystemExit as exc:
            assert "below 2048" in str(exc)
            assert "desynchronize Qwen image tokens and image features" in str(exc)
        else:
            raise AssertionError("unsafe 1536 multimodal sequence cap must be rejected")
        assert called is False


def _python_observed_oom_is_also_retried_without_seq_change() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[tuple[int, int]] = []

        def worker_oom_then_success(command: list[str], **_kwargs):
            calls.append((_edge(command), int(_arg(command, "--max-seq-length"))))
            code = compat.OOM_EXIT_CODE if len(calls) == 1 else 0
            return subprocess.CompletedProcess(command, code)

        code = compat.supervise_training(
            _base(output), run_fn=worker_oom_then_success, retry_delay_seconds=0
        )
        assert code == 0
        assert calls == [(320, 4096), (288, 4096)]


def _non_oom_failure_is_not_retried() -> None:
    with tempfile.TemporaryDirectory() as raw:
        output = Path(raw) / "adapter" / "adapters.safetensors"
        output.parent.mkdir()
        calls: list[list[str]] = []

        def fail(command: list[str], **_kwargs):
            calls.append(list(command))
            return subprocess.CompletedProcess(command, 2)

        code = compat.supervise_training(_base(output), run_fn=fail, retry_delay_seconds=0)
        assert code == 2
        assert len(calls) == 1


def main() -> int:
    _repeat_scalar_compat_is_narrow_and_idempotent()
    _sigabrt_then_success_preserves_requested_seq()
    _bounded_image_ladder_never_changes_sequence_cap()
    _accepted_minimum_sequence_is_preserved()
    _unsafe_short_sequence_profile_is_rejected()
    _python_observed_oom_is_also_retried_without_seq_change()
    _non_oom_failure_is_not_retried()
    print("PASS Qwen3 scalar repeat shim converts only integer-like scalar counts")
    print("PASS Qwen3 scalar repeat shim delegates every unrelated MLX attribute/call")
    print("PASS compat parent starts at 320 and survives Metal SIGABRT")
    print("PASS exact requested 4096 multimodal sequence cap survives every OOM retry")
    print("PASS image-only memory ladder is bounded 320/4096 -> 288/4096 -> 256/4096")
    print("PASS explicit safe 2048 sequence cap is preserved, not rewritten")
    print("PASS unsafe multimodal max_seq_length below 2048 is rejected before MLX starts")
    print("PASS partial OOM weights are discarded while dataset and certified resume adapter stay unchanged")
    print("PASS non-OOM training failures are never retried as memory failures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
