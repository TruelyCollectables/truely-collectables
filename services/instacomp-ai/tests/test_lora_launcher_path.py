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
