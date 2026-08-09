from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest


SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
SCRIPT = SERVICE_ROOT / "scripts" / "run_lora_training.py"


def run_help(cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--help"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def load_launcher_module():
    spec = importlib.util.spec_from_file_location("instacomp_run_lora_training", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_lora_launcher_imports_app_from_repo_root() -> None:
    result = run_help(REPO_ROOT)
    assert result.returncode == 0, result.stderr
    assert "Train a private InstaComp vision LoRA adapter" in result.stdout
    assert "--resume-adapter" in result.stdout
    assert "--image-resize-shape" in result.stdout
    assert "--iters" in result.stdout


def test_lora_launcher_imports_app_from_service_root() -> None:
    result = run_help(SERVICE_ROOT)
    assert result.returncode == 0, result.stderr
    assert "--preflight-only" in result.stdout


def test_lora_launcher_rejects_known_broken_multi_image_runtime() -> None:
    module = load_launcher_module()
    with pytest.raises(SystemExit, match="too old for InstaComp front\\+back training"):
        module._validated_mlx_vlm_version("0.5.0")


def test_lora_launcher_accepts_upstream_multi_image_fix_release() -> None:
    module = load_launcher_module()
    assert str(module._validated_mlx_vlm_version("0.6.8")) == "0.6.8"


def test_lora_command_memory_bounds_images_and_resumes_checkpoint(tmp_path: Path) -> None:
    module = load_launcher_module()
    checkpoint = tmp_path / "checkpoint.safetensors"
    checkpoint.write_bytes(b"checkpoint")
    dataset = tmp_path / "dataset"
    output = tmp_path / "next.safetensors"

    command = module.build_lora_command(
        training_python="/tmp/lora-python",
        model="mlx-community/Qwen3-VL-2B-Instruct-4bit",
        dataset_path=dataset,
        output_path=output,
        batch_size=1,
        epochs=2,
        iters=296,
        learning_rate=2e-4,
        lora_rank=16,
        lora_alpha=32,
        image_resize_shape=(768, 768),
        resume_adapter=checkpoint,
    )

    assert command[command.index("--iters") + 1] == "296"
    assert "--epochs" not in command
    resize_index = command.index("--image-resize-shape")
    assert command[resize_index + 1 : resize_index + 3] == ["768", "768"]
    assert command[command.index("--adapter-path") + 1] == str(checkpoint)
    assert command[command.index("--steps-per-save") + 1] == "25"


def test_lora_command_rejects_missing_resume_checkpoint(tmp_path: Path) -> None:
    module = load_launcher_module()
    with pytest.raises(SystemExit, match="Resume adapter does not exist"):
        module.build_lora_command(
            training_python="/tmp/lora-python",
            model="mlx-community/Qwen3-VL-2B-Instruct-4bit",
            dataset_path=tmp_path / "dataset",
            output_path=tmp_path / "next.safetensors",
            batch_size=1,
            epochs=2,
            iters=296,
            learning_rate=2e-4,
            lora_rank=16,
            lora_alpha=32,
            image_resize_shape=(768, 768),
            resume_adapter=tmp_path / "missing.safetensors",
        )
