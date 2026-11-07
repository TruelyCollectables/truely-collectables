#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text("utf-8"))
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _receipt_is_resumable(payload: dict[str, Any], *, current_sha: str) -> bool:
    if payload.get("complete") is not True:
        return False
    if int(payload.get("target") or 0) != 100 or int(payload.get("tested") or 0) != 100:
        return False
    results = payload.get("results")
    if not isinstance(results, list) or len(results) != 100:
        return False
    if payload.get("graduation_gate_passed") is True:
        return False
    if str(payload.get("adapter_weights_sha256") or "").strip().lower() != current_sha.lower():
        return False
    return True


def find_resumable(completion_path: Path, benchmark_dir: Path) -> Path | None:
    completion = _read_json(completion_path)
    if completion is None or not benchmark_dir.is_dir():
        return None
    adapter = Path(str(completion.get("adapter_directory") or "")).expanduser()
    weights = adapter / "adapters.safetensors"
    if not weights.is_file():
        return None
    current_sha = _sha256(weights)
    paths = sorted(
        benchmark_dir.glob("unseen-holdout-*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in paths:
        payload = _read_json(path)
        if payload is not None and _receipt_is_resumable(payload, current_sha=current_sha):
            return path
    return None


def _self_test() -> int:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        adapter = root / "adapter"
        adapter.mkdir()
        weights = adapter / "adapters.safetensors"
        weights.write_bytes(b"known-good-adapter")
        current_sha = _sha256(weights)
        completion = root / "completion.json"
        completion.write_text(json.dumps({"adapter_directory": str(adapter)}) + "\n", "utf-8")
        benchmarks = root / "benchmarks"
        benchmarks.mkdir()

        base = {
            "complete": True,
            "target": 100,
            "tested": 100,
            "results": [{"row_id": str(i)} for i in range(100)],
            "graduation_gate_passed": False,
            "adapter_weights_sha256": current_sha,
        }

        partial = benchmarks / "unseen-holdout-20260101T000001Z.json"
        partial.write_text(json.dumps({**base, "complete": False}) + "\n", "utf-8")
        assert not _receipt_is_resumable(json.loads(partial.read_text("utf-8")), current_sha=current_sha)

        graduated = benchmarks / "unseen-holdout-20260101T000002Z.json"
        graduated.write_text(json.dumps({**base, "graduation_gate_passed": True}) + "\n", "utf-8")
        assert not _receipt_is_resumable(json.loads(graduated.read_text("utf-8")), current_sha=current_sha)

        wrong_adapter = benchmarks / "unseen-holdout-20260101T000003Z.json"
        wrong_adapter.write_text(json.dumps({**base, "adapter_weights_sha256": "f" * 64}) + "\n", "utf-8")
        assert not _receipt_is_resumable(json.loads(wrong_adapter.read_text("utf-8")), current_sha=current_sha)

        valid = benchmarks / "unseen-holdout-20260101T000004Z.json"
        valid.write_text(json.dumps(base) + "\n", "utf-8")
        found = find_resumable(completion, benchmarks)
        assert found == valid

        weights.write_bytes(b"new-certified-adapter")
        assert find_resumable(completion, benchmarks) is None

    print("PASS unseen resume gate requires complete 100/100 non-graduating receipt")
    print("PASS unseen resume gate requires the exact current certified adapter SHA")
    print("PASS unseen resume gate rejects partial, graduated, and prior-adapter receipts")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find a complete non-graduating unseen exam that belongs to the current certified adapter."
    )
    parser.add_argument("completion_receipt", nargs="?", type=Path)
    parser.add_argument("benchmark_dir", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return _self_test()
    if args.completion_receipt is None or args.benchmark_dir is None:
        parser.error("completion_receipt and benchmark_dir are required unless --self-test is used")
    value = find_resumable(args.completion_receipt, args.benchmark_dir)
    print(value or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
