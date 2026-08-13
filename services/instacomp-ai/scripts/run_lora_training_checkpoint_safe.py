#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = SERVICE_ROOT / "scripts" / "run_lora_training.py"
ADAPTER_ROOT = SERVICE_ROOT / "data" / "training" / "adapters"
STATUS_PATH = SERVICE_ROOT / "data" / "training" / "lora-training-status.json"
DEFAULT_CHUNK_TIMEOUT_SECONDS = 3600
DEFAULT_TIMEOUT_RETRIES = 2


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


def _arg_value(command: list[str], flag: str) -> str | None:
    try:
        index = command.index(flag)
    except ValueError:
        return None
    if index + 1 >= len(command):
        return None
    return command[index + 1]


def _set_arg(command: list[str], flag: str, value: str) -> list[str]:
    updated = list(command)
    try:
        index = updated.index(flag)
    except ValueError:
        updated.extend([flag, value])
        return updated
    if index + 1 >= len(updated):
        updated.append(value)
    else:
        updated[index + 1] = value
    return updated


def _write_status(**payload) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_PATH.with_suffix(".json.tmp")
    body = {
        "schema_version": "tcos.instacomp-ai.lora-training-status.v1",
        "updated_at_epoch": int(time.time()),
        **payload,
    }
    tmp.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n", "utf-8")
    tmp.replace(STATUS_PATH)


def _checkpoint_is_valid(bundle: Path) -> bool:
    weights = bundle / "adapters.safetensors"
    config = bundle / "adapter_config.json"
    return (
        bundle.is_dir()
        and weights.is_file()
        and weights.stat().st_size > 0
        and config.is_file()
        and config.stat().st_size > 0
    )


def _checkpoint_was_written(bundle: Path, started_at: float) -> bool:
    if not _checkpoint_is_valid(bundle):
        return False
    return (bundle / "adapters.safetensors").stat().st_mtime >= started_at - 2.0


def _is_training_command(command) -> bool:
    if not isinstance(command, (list, tuple)):
        return False
    values = [str(item) for item in command]
    return "mlx_vlm.lora" in values and "--help" not in values


def _run_training_supervised(command, *run_args, original_run, **run_kwargs):
    base_command = [str(item) for item in command]
    raw_iters = _arg_value(base_command, "--iters")
    output_path_raw = _arg_value(base_command, "--output-path")
    raw_steps = _arg_value(base_command, "--steps-per-save")

    timeout_seconds = max(
        60,
        int(os.environ.get("INSTACOMP_LORA_CHUNK_TIMEOUT_SECONDS", str(DEFAULT_CHUNK_TIMEOUT_SECONDS))),
    )
    max_timeout_retries = max(
        0,
        int(os.environ.get("INSTACOMP_LORA_TIMEOUT_RETRIES", str(DEFAULT_TIMEOUT_RETRIES))),
    )

    if raw_iters is None or output_path_raw is None:
        guarded_kwargs = dict(run_kwargs)
        guarded_kwargs["timeout"] = timeout_seconds
        _write_status(
            state="running_guarded",
            requested_iters=None,
            completed_iters=None,
            remaining_iters=None,
            timeout_seconds=timeout_seconds,
        )
        try:
            result = original_run(base_command, *run_args, **guarded_kwargs)
        except subprocess.TimeoutExpired:
            _write_status(
                state="stalled_timeout",
                requested_iters=None,
                completed_iters=None,
                remaining_iters=None,
                timeout_seconds=timeout_seconds,
                returncode=124,
            )
            return subprocess.CompletedProcess(base_command, 124)
        _write_status(
            state="completed" if result.returncode == 0 else "failed",
            requested_iters=None,
            completed_iters=None,
            remaining_iters=None,
            timeout_seconds=timeout_seconds,
            returncode=result.returncode,
        )
        return result

    requested_iters = int(raw_iters)
    if requested_iters <= 0:
        return original_run(base_command, *run_args, **run_kwargs)

    steps_per_save = max(1, int(raw_steps or "25"))
    output_path = Path(output_path_raw)
    if not output_path.is_absolute():
        cwd = Path(run_kwargs.get("cwd") or SERVICE_ROOT)
        output_path = (cwd / output_path).resolve()
    adapter_bundle = output_path.parent

    remaining = requested_iters
    completed_iters = 0
    chunk_number = 0
    current_command = list(base_command)
    resume_source = _arg_value(base_command, "--adapter-path")

    while remaining > 0:
        chunk_number += 1
        chunk_iters = min(steps_per_save, remaining)
        chunk_command = _set_arg(current_command, "--iters", str(chunk_iters))
        chunk_command = _set_arg(chunk_command, "--steps-per-save", str(chunk_iters))
        if completed_iters > 0:
            chunk_command = _set_arg(chunk_command, "--adapter-path", str(adapter_bundle))

        timeout_attempt = 0
        while True:
            timeout_attempt += 1
            started_at = time.time()
            _write_status(
                state="running",
                requested_iters=requested_iters,
                completed_iters=completed_iters,
                remaining_iters=remaining,
                current_chunk_iters=chunk_iters,
                chunk_number=chunk_number,
                timeout_attempt=timeout_attempt,
                timeout_seconds=timeout_seconds,
                output_bundle=str(adapter_bundle),
                initial_resume_source=resume_source,
            )
            guarded_kwargs = dict(run_kwargs)
            guarded_kwargs["timeout"] = timeout_seconds
            try:
                result = original_run(chunk_command, *run_args, **guarded_kwargs)
            except subprocess.TimeoutExpired:
                _repair_resume_directory(adapter_bundle, adapter_root=ADAPTER_ROOT)
                if _checkpoint_was_written(adapter_bundle, started_at):
                    completed_iters += chunk_iters
                    remaining -= chunk_iters
                    _write_status(
                        state="checkpoint_recovered_after_timeout",
                        requested_iters=requested_iters,
                        completed_iters=completed_iters,
                        remaining_iters=remaining,
                        current_chunk_iters=chunk_iters,
                        chunk_number=chunk_number,
                        timeout_attempt=timeout_attempt,
                        timeout_seconds=timeout_seconds,
                        output_bundle=str(adapter_bundle),
                        returncode=124,
                    )
                    current_command = _set_arg(current_command, "--adapter-path", str(adapter_bundle))
                    break
                if timeout_attempt <= max_timeout_retries:
                    _write_status(
                        state="retrying_stalled_chunk",
                        requested_iters=requested_iters,
                        completed_iters=completed_iters,
                        remaining_iters=remaining,
                        current_chunk_iters=chunk_iters,
                        chunk_number=chunk_number,
                        timeout_attempt=timeout_attempt,
                        timeout_seconds=timeout_seconds,
                        output_bundle=str(adapter_bundle),
                        returncode=124,
                    )
                    continue
                _write_status(
                    state="stalled_timeout",
                    requested_iters=requested_iters,
                    completed_iters=completed_iters,
                    remaining_iters=remaining,
                    current_chunk_iters=chunk_iters,
                    chunk_number=chunk_number,
                    timeout_attempt=timeout_attempt,
                    timeout_seconds=timeout_seconds,
                    output_bundle=str(adapter_bundle),
                    returncode=124,
                )
                return subprocess.CompletedProcess(base_command, 124)

            if result.returncode != 0:
                _write_status(
                    state="failed",
                    requested_iters=requested_iters,
                    completed_iters=completed_iters,
                    remaining_iters=remaining,
                    current_chunk_iters=chunk_iters,
                    chunk_number=chunk_number,
                    timeout_attempt=timeout_attempt,
                    timeout_seconds=timeout_seconds,
                    output_bundle=str(adapter_bundle),
                    returncode=result.returncode,
                )
                return result

            _repair_resume_directory(adapter_bundle, adapter_root=ADAPTER_ROOT)
            if not _checkpoint_was_written(adapter_bundle, started_at):
                _write_status(
                    state="checkpoint_missing_after_success",
                    requested_iters=requested_iters,
                    completed_iters=completed_iters,
                    remaining_iters=remaining,
                    current_chunk_iters=chunk_iters,
                    chunk_number=chunk_number,
                    timeout_attempt=timeout_attempt,
                    timeout_seconds=timeout_seconds,
                    output_bundle=str(adapter_bundle),
                    returncode=125,
                )
                return subprocess.CompletedProcess(base_command, 125)

            completed_iters += chunk_iters
            remaining -= chunk_iters
            current_command = _set_arg(current_command, "--adapter-path", str(adapter_bundle))
            _write_status(
                state="checkpoint_saved" if remaining else "completed",
                requested_iters=requested_iters,
                completed_iters=completed_iters,
                remaining_iters=remaining,
                current_chunk_iters=chunk_iters,
                chunk_number=chunk_number,
                timeout_attempt=timeout_attempt,
                timeout_seconds=timeout_seconds,
                output_bundle=str(adapter_bundle),
                returncode=0,
            )
            break

    return subprocess.CompletedProcess(base_command, 0)


def main() -> int:
    module = _load_launcher()
    original_prepare = module.prepare_resume_adapter_bundle
    original_build = module.build_lora_command
    original_run = module.subprocess.run

    def prepare_resume_adapter_bundle(resume_adapter, *, adapter_root):
        if resume_adapter is not None:
            _repair_resume_directory(
                Path(resume_adapter).expanduser().resolve(),
                adapter_root=Path(adapter_root),
            )
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

    def guarded_run(command, *args, **kwargs):
        if _is_training_command(command):
            return _run_training_supervised(command, *args, original_run=original_run, **kwargs)
        return original_run(command, *args, **kwargs)

    module.prepare_resume_adapter_bundle = prepare_resume_adapter_bundle
    module.build_lora_command = build_lora_command
    module.subprocess.run = guarded_run
    return int(module.main())


if __name__ == "__main__":
    raise SystemExit(main())
