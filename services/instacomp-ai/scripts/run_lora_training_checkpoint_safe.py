#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = SERVICE_ROOT / "scripts" / "run_lora_training.py"
ADAPTER_ROOT = SERVICE_ROOT / "data" / "training" / "adapters"


def _load_launcher():
    spec = importlib.util.spec_from_file_location("instacomp_run_lora_training", LAUNCHER)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Unable to load LoRA launcher: {LAUNCHER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _config_fingerprint(path: Path) -> tuple[str, str]:
    payload = json.loads(path.read_text("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("adapter config is not an object")
    params = payload.get("lora_parameters")
    if not isinstance(params, dict):
        raise ValueError("adapter config is missing lora_parameters")
    # Only compare the architecture-defining LoRA settings. Runtime bookkeeping
    # fields can legitimately differ between MLX-VLM releases/runs.
    stable = {
        "fine_tune_type": payload.get("fine_tune_type", "lora"),
        "lora_parameters": params,
    }
    canonical = json.dumps(stable, sort_keys=True, separators=(",", ":"))
    return canonical, path.read_text("utf-8")


def _find_unambiguous_config(adapter_root: Path) -> Path:
    candidates: list[Path] = []
    direct = adapter_root / "adapter_config.json"
    if direct.is_file():
        candidates.append(direct)
    candidates.extend(sorted((adapter_root / "resume-bundles").glob("*/adapter_config.json")))
    candidates.extend(sorted(adapter_root.glob("instacomp-*/adapter_config.json")))

    valid: dict[str, list[Path]] = {}
    for path in candidates:
        try:
            fingerprint, _raw = _config_fingerprint(path)
        except Exception:
            continue
        valid.setdefault(fingerprint, []).append(path)

    if not valid:
        raise SystemExit(
            "Cannot repair resumable LoRA checkpoint: no valid adapter_config.json "
            f"exists under {adapter_root}."
        )
    if len(valid) != 1:
        details = "; ".join(
            ", ".join(str(p) for p in paths[:3]) for paths in valid.values()
        )
        raise SystemExit(
            "Cannot repair resumable LoRA checkpoint safely because multiple incompatible "
            f"LoRA configs exist: {details}"
        )
    return next(iter(valid.values()))[0]


def _repair_resume_directory(source: Path, *, adapter_root: Path) -> None:
    if not source.is_dir():
        return
    weights = source / "adapters.safetensors"
    config = source / "adapter_config.json"
    if config.is_file() or not weights.is_file() or weights.stat().st_size <= 0:
        return

    donor = _find_unambiguous_config(adapter_root)
    source.mkdir(parents=True, exist_ok=True)
    shutil.copy2(donor, config)
    print(
        f"Repaired resumable checkpoint config: {config} (from {donor})",
        flush=True,
    )


def main() -> int:
    module = _load_launcher()
    original_prepare = module.prepare_resume_adapter_bundle
    original_build = module.build_lora_command

    def prepare_resume_adapter_bundle(resume_adapter, *, adapter_root):
        if resume_adapter is not None:
            _repair_resume_directory(Path(resume_adapter).expanduser().resolve(), adapter_root=Path(adapter_root))
        return original_prepare(resume_adapter, adapter_root=adapter_root)

    def build_lora_command(**kwargs):
        resume_adapter = kwargs.get("resume_adapter")
        output_path = Path(kwargs["output_path"])
        if resume_adapter is not None:
            resume_dir = Path(resume_adapter)
            config_source = resume_dir / "adapter_config.json"
            if not config_source.is_file():
                raise SystemExit(
                    "Refusing to start resumable training without adapter_config.json in "
                    f"the validated resume bundle: {resume_dir}"
                )
            output_dir = output_path.parent
            output_dir.mkdir(parents=True, exist_ok=True)
            config_dest = output_dir / "adapter_config.json"
            shutil.copy2(config_source, config_dest)
            print(f"Seeded resumable output config: {config_dest}", flush=True)
        return original_build(**kwargs)

    module.prepare_resume_adapter_bundle = prepare_resume_adapter_bundle
    module.build_lora_command = build_lora_command
    return int(module.main())


if __name__ == "__main__":
    raise SystemExit(main())
