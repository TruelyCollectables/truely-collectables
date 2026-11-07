from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
SCRIPT = SERVICE_ROOT / "scripts" / "run_lora_training.py"
SAFE_SCRIPT = SERVICE_ROOT / "scripts" / "run-lora-training-safe.sh"
RESUME_PATCH = SERVICE_ROOT / "scripts" / "lora-resume-freeze-patch" / "sitecustomize.py"


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


def write_bundle(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    (path / "adapters.safetensors").write_bytes(b"checkpoint")
    (path / "adapter_config.json").write_text(
        json.dumps({
            "fine_tune_type": "lora",
            "lora_parameters": {
                "rank": 16,
                "dropout": 0.05,
                "scale": 2.0,
                "keys": ["language_model.layers.0.self_attn.q_proj"],
            },
        }),
        encoding="utf-8",
    )
    return path


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


def test_safe_resume_launcher_enables_freeze_patch() -> None:
    shell = SAFE_SCRIPT.read_text("utf-8")
    patch = RESUME_PATCH.read_text("utf-8")
    assert "INSTACOMP_MLX_SAFE_RESUME=1" in shell
    assert "lora-resume-freeze-patch" in shell
    freeze_at = patch.index("trainer_utils.freeze_model(model)")
    apply_at = patch.index("_upstream_apply_lora_layers(model, adapter_path)")
    assert freeze_at < apply_at
    assert "non-LoRA base" in patch
    assert 'name.endswith("lora_a")' in patch
    assert 'name.endswith("lora_b")' in patch


def test_lora_launcher_rejects_known_broken_multi_image_runtime() -> None:
    module = load_launcher_module()
    with pytest.raises(SystemExit, match="too old for InstaComp front\\+back training"):
        module._validated_mlx_vlm_version("0.5.0")


def test_lora_launcher_accepts_upstream_multi_image_fix_release() -> None:
    module = load_launcher_module()
    assert str(module._validated_mlx_vlm_version("0.6.8")) == "0.6.8"


def test_legacy_checkpoint_is_packaged_as_mlx_vlm_resume_bundle(tmp_path: Path) -> None:
    module = load_launcher_module()
    adapter_root = tmp_path / "adapters"
    adapter_root.mkdir()
    checkpoint = adapter_root / "instacomp-old.safetensors"
    checkpoint.write_bytes(b"checkpoint-50")
    (adapter_root / "adapter_config.json").write_text(
        json.dumps({
            "fine_tune_type": "lora",
            "lora_parameters": {"rank": 16, "dropout": 0.05, "scale": 2.0},
        }),
        encoding="utf-8",
    )

    bundle = module.prepare_resume_adapter_bundle(checkpoint, adapter_root=adapter_root)

    assert bundle == (adapter_root / "resume-bundles" / checkpoint.stem).resolve()
    assert (bundle / "adapters.safetensors").read_bytes() == b"checkpoint-50"
    config = json.loads((bundle / "adapter_config.json").read_text("utf-8"))
    assert config["lora_parameters"]["rank"] == 16


def test_existing_resume_bundle_is_accepted_unchanged(tmp_path: Path) -> None:
    module = load_launcher_module()
    adapter_root = tmp_path / "adapters"
    bundle = write_bundle(tmp_path / "bundle")
    assert module.prepare_resume_adapter_bundle(bundle, adapter_root=adapter_root) == bundle.resolve()


def test_lora_command_memory_bounds_images_and_resumes_bundle(tmp_path: Path) -> None:
    module = load_launcher_module()
    bundle = write_bundle(tmp_path / "bundle")
    dataset = tmp_path / "dataset"
    output = tmp_path / "next" / "adapters.safetensors"

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
        resume_adapter=bundle,
    )

    assert command[command.index("--iters") + 1] == "296"
    assert "--epochs" not in command
    resize_index = command.index("--image-resize-shape")
    assert command[resize_index + 1 : resize_index + 3] == ["768", "768"]
    assert command[command.index("--adapter-path") + 1] == str(bundle)
    assert command[command.index("--steps-per-save") + 1] == "25"
    assert command[command.index("--output-path") + 1].endswith("next/adapters.safetensors")


def test_lora_command_rejects_file_instead_of_resume_bundle(tmp_path: Path) -> None:
    module = load_launcher_module()
    checkpoint = tmp_path / "checkpoint.safetensors"
    checkpoint.write_bytes(b"checkpoint")
    with pytest.raises(SystemExit, match="not a directory"):
        module.build_lora_command(
            training_python="/tmp/lora-python",
            model="mlx-community/Qwen3-VL-2B-Instruct-4bit",
            dataset_path=tmp_path / "dataset",
            output_path=tmp_path / "next" / "adapters.safetensors",
            batch_size=1,
            epochs=2,
            iters=296,
            learning_rate=2e-4,
            lora_rank=16,
            lora_alpha=32,
            image_resize_shape=(768, 768),
            resume_adapter=checkpoint,
        )


def test_legacy_checkpoint_without_config_fails_closed(tmp_path: Path) -> None:
    module = load_launcher_module()
    checkpoint = tmp_path / "checkpoint.safetensors"
    checkpoint.write_bytes(b"checkpoint")
    with pytest.raises(SystemExit, match="adapter_config.json is missing"):
        module.prepare_resume_adapter_bundle(checkpoint, adapter_root=tmp_path / "adapters")
