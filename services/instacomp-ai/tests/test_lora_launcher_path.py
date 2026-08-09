from __future__ import annotations

import subprocess
import sys
from pathlib import Path


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


def test_lora_launcher_imports_app_from_repo_root() -> None:
    result = run_help(REPO_ROOT)
    assert result.returncode == 0, result.stderr
    assert "Train a private InstaComp vision LoRA adapter" in result.stdout


def test_lora_launcher_imports_app_from_service_root() -> None:
    result = run_help(SERVICE_ROOT)
    assert result.returncode == 0, result.stderr
    assert "--preflight-only" in result.stdout
