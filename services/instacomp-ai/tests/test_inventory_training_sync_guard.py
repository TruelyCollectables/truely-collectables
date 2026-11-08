from __future__ import annotations

import importlib.util
import json
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync_all_inventory_training_truth_guarded.py"


def _module():
    spec = importlib.util.spec_from_file_location("inventory_sync_guard", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_guard_receipt_replaces_stale_inventory_receipt(tmp_path):
    module = _module()
    receipt = tmp_path / "inventory-training-import-latest.json"
    receipt.write_text(json.dumps({"schema_version": "old", "status": "stale"}), encoding="utf-8")

    payload = module._guard_payload(status="running", started_at="2026-08-12T01:00:00+00:00")
    module._atomic_json(receipt, payload)

    current = json.loads(receipt.read_text("utf-8"))
    assert current["schema_version"] == module.WRAPPER_SCHEMA
    assert current["status"] == "running"
    assert module._receipt_is_guard(receipt)


def test_guard_failure_payload_preserves_exit_code_and_output_tail():
    module = _module()
    payload = module._guard_payload(
        status="sync_failed_before_receipt",
        started_at="2026-08-12T01:00:00+00:00",
        exit_code=7,
        tail=["before", "Traceback: boom"],
    )
    assert payload["status"] == "sync_failed_before_receipt"
    assert payload["exit_code"] == 7
    assert payload["output_tail"][-1] == "Traceback: boom"
