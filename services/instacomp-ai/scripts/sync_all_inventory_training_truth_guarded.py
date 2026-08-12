#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
TARGET = SERVICE_ROOT / "scripts" / "sync_all_inventory_training_truth_resilient.py"
DEFAULT_RECEIPT = SERVICE_ROOT / "data" / "training" / "inventory-training-import-latest.json"
DEFAULT_LOG = SERVICE_ROOT / "data" / "training" / "inventory-training-sync-latest.log"
WRAPPER_SCHEMA = "tcos.instacomp-ai.inventory-training-sync-guard.v1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def _guard_payload(*, status: str, started_at: str, exit_code: int | None = None, tail: list[str] | None = None) -> dict:
    payload = {
        "schema_version": WRAPPER_SCHEMA,
        "status": status,
        "started_at": started_at,
        "updated_at": utc_now(),
        "source": "production_inventory_read_only",
        "message": (
            "Guard receipt for the all-inventory InstaComp truth sync. A completed v3 inventory receipt "
            "replaces this file when the underlying sync reaches receipt generation."
        ),
    }
    if exit_code is not None:
        payload["exit_code"] = exit_code
    if tail:
        payload["output_tail"] = tail[-80:]
    return payload


def _receipt_is_guard(path: Path) -> bool:
    try:
        payload = json.loads(path.read_text("utf-8"))
    except Exception:
        return False
    return payload.get("schema_version") == WRAPPER_SCHEMA


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run the complete inventory truth sync with durable stdout/stderr logging and a non-stale "
            "failure receipt if the underlying process exits before writing its normal receipt."
        )
    )
    parser.add_argument("--allow-vercel-env-pull", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    args = parser.parse_args()

    receipt = args.receipt.expanduser().resolve()
    log_path = args.log.expanduser().resolve()
    started_at = utc_now()
    _atomic_json(receipt, _guard_payload(status="running", started_at=started_at))
    log_path.parent.mkdir(parents=True, exist_ok=True)

    command = [sys.executable, "-u", str(TARGET), "--receipt", str(receipt)]
    if args.allow_vercel_env_pull:
        command.append("--allow-vercel-env-pull")
    if args.dry_run:
        command.append("--dry-run")

    tail: deque[str] = deque(maxlen=120)
    with log_path.open("w", encoding="utf-8", buffering=1) as log:
        log.write(f"started_at={started_at}\n")
        log.write("command=" + " ".join(command) + "\n")
        log.flush()
        try:
            process = subprocess.Popen(
                command,
                cwd=REPO_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            assert process.stdout is not None
            for raw in process.stdout:
                line = raw.rstrip("\n")
                print(line, flush=True)
                log.write(raw)
                tail.append(line)
            exit_code = process.wait()
        except BaseException as exc:
            line = f"guard_exception:{type(exc).__name__}:{exc}"
            print(line, file=sys.stderr, flush=True)
            log.write(line + "\n")
            tail.append(line)
            if _receipt_is_guard(receipt):
                _atomic_json(
                    receipt,
                    _guard_payload(status="guard_failed", started_at=started_at, exit_code=97, tail=list(tail)),
                )
            raise

    if exit_code != 0 and _receipt_is_guard(receipt):
        _atomic_json(
            receipt,
            _guard_payload(status="sync_failed_before_receipt", started_at=started_at, exit_code=exit_code, tail=list(tail)),
        )

    if exit_code == 0 and _receipt_is_guard(receipt):
        _atomic_json(
            receipt,
            _guard_payload(
                status="sync_exited_without_final_receipt",
                started_at=started_at,
                exit_code=exit_code,
                tail=list(tail),
            ),
        )
        print("ERROR: inventory sync exited 0 without replacing the guard receipt", file=sys.stderr, flush=True)
        return 98

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
