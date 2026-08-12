from __future__ import annotations

import gzip
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SNAPSHOT_SCRIPT = SCRIPT_DIR / "inventory_training_git_snapshot.py"
RESILIENT_SCRIPT = SCRIPT_DIR / "sync_all_inventory_training_truth_resilient.py"


def _load(path: Path, name: str):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _snapshot_payload(module):
    tables = {
        "inventory_items": [{"id": "item-1", "sku": "COLLX-1"}],
        "inventory_images": [{"inventory_item_id": "item-1", "image_url": "https://example/front.jpg"}],
        "inventory_attributes": [{"inventory_item_id": "item-1", "attribute_name": "year", "attribute_value": "2025"}],
        "products": [{"id": 1, "title": "Card"}],
    }
    return {
        "schema_version": module.SNAPSHOT_SCHEMA,
        "generated_at": "2026-08-12T00:00:00+00:00",
        "source": "supabase_management_database_query_read_only",
        "row_counts": {name: len(rows) for name, rows in tables.items()},
        "tables": tables,
    }


def _encoded_snapshot(module, payload=None):
    payload = payload or _snapshot_payload(module)
    return gzip.compress(json.dumps(payload).encode("utf-8"), mtime=0)


def test_decode_snapshot_validates_schema_counts_and_tables():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_decode")
    payload = module.decode_snapshot_bytes(_encoded_snapshot(module))
    assert payload["row_counts"]["inventory_items"] == 1
    assert payload["tables"]["inventory_items"][0]["sku"] == "COLLX-1"


def test_decode_snapshot_rejects_stale_or_truncated_count_contract():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_count")
    payload = _snapshot_payload(module)
    payload["row_counts"]["inventory_items"] = 2
    with pytest.raises(module.SnapshotUnavailable, match="count mismatch"):
        module.decode_snapshot_bytes(_encoded_snapshot(module, payload))


def test_snapshot_reader_is_drop_in_read_only_table_source():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_reader")
    payload = _snapshot_payload(module)
    reader = module.SnapshotSupabaseReader("ignored", "ignored", snapshot=payload)
    rows = reader.table("inventory_items")
    assert rows == [{"id": "item-1", "sku": "COLLX-1"}]
    rows[0]["sku"] = "mutated"
    assert payload["tables"]["inventory_items"][0]["sku"] == "COLLX-1"
    reader.close()


def test_git_snapshot_fetch_uses_existing_authenticated_git_remote(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_fetch")
    encoded = _encoded_snapshot(module)
    calls = []

    def fake_run(args, **kwargs):
        calls.append(list(args))
        if args[1] == "fetch":
            return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
        if args[1] == "show":
            return SimpleNamespace(returncode=0, stdout=encoded, stderr=b"")
        raise AssertionError(args)

    monkeypatch.setattr(module.subprocess, "run", fake_run)
    payload = module.fetch_snapshot_from_git(repo_root=tmp_path)
    assert payload["row_counts"]["products"] == 1
    assert calls[0][0:3] == ["git", "fetch", "--quiet"]
    assert calls[1][0:2] == ["git", "show"]


def test_resilient_sync_prefers_snapshot_source_before_postgrest(monkeypatch: pytest.MonkeyPatch):
    module = _load(RESILIENT_SCRIPT, "inventory_resilient_snapshot_preferred")
    snapshot_module = sys.modules.get("inventory_training_git_snapshot")
    assert snapshot_module is not None
    snapshot = _snapshot_payload(snapshot_module)

    monkeypatch.setattr(module, "fetch_snapshot_from_git", lambda: snapshot)

    class FakeTarget:
        SupabaseReader = None

        @staticmethod
        def main():
            assert FakeTarget.SupabaseReader is not module.ResilientSupabaseReader
            reader = FakeTarget.SupabaseReader("ignored", "ignored")
            assert reader.table("inventory_items")[0]["sku"] == "COLLX-1"
            return 0

    monkeypatch.setitem(sys.modules, "sync_all_inventory_training_truth_v2", FakeTarget)
    assert module.main() == 0
