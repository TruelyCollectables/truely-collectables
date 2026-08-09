from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SERVICE_ROOT / "scripts" / "run_lora_training_checkpoint_safe.py"


def load_module():
    spec = importlib.util.spec_from_file_location("instacomp_lora_checkpoint_safe", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_config(path: Path, *, rank: int = 16) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({
            "fine_tune_type": "lora",
            "lora_parameters": {
                "rank": rank,
                "dropout": 0.05,
                "scale": 2.0,
            },
        }),
        encoding="utf-8",
    )


def test_repairs_checkpoint_directory_from_unambiguous_existing_config(tmp_path: Path) -> None:
    module = load_module()
    adapter_root = tmp_path / "adapters"
    donor = adapter_root / "resume-bundles" / "original" / "adapter_config.json"
    write_config(donor)

    checkpoint = adapter_root / "instacomp-safe-150"
    checkpoint.mkdir(parents=True)
    (checkpoint / "adapters.safetensors").write_bytes(b"safe-iteration-150")

    module._repair_resume_directory(checkpoint, adapter_root=adapter_root)

    repaired = checkpoint / "adapter_config.json"
    assert repaired.is_file()
    assert json.loads(repaired.read_text("utf-8"))["lora_parameters"]["rank"] == 16


def test_repair_fails_closed_when_configs_conflict(tmp_path: Path) -> None:
    module = load_module()
    adapter_root = tmp_path / "adapters"
    write_config(adapter_root / "resume-bundles" / "rank16" / "adapter_config.json", rank=16)
    write_config(adapter_root / "resume-bundles" / "rank8" / "adapter_config.json", rank=8)

    checkpoint = adapter_root / "instacomp-safe-150"
    checkpoint.mkdir(parents=True)
    (checkpoint / "adapters.safetensors").write_bytes(b"safe-iteration-150")

    with pytest.raises(SystemExit, match="multiple incompatible LoRA configs"):
        module._repair_resume_directory(checkpoint, adapter_root=adapter_root)
