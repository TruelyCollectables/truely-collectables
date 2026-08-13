from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SERVICE_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_SCRIPT = SCRIPT_DIR / "inventory_training_git_snapshot.py"
EXPORTER_SCRIPT = SCRIPT_DIR / "export_inventory_training_snapshot.py"
RESILIENT_SCRIPT = SCRIPT_DIR / "sync_all_inventory_training_truth_resilient.py"
WORKFLOW = SERVICE_ROOT.parents[1] / ".github" / "workflows" / "instacomp-inventory-training-snapshot-20260812.yml"


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
        "source": "supabase_management_database_query_read_only_keyset_v3",
        "row_counts": {name: len(rows) for name, rows in tables.items()},
        "tables": tables,
    }


def _encoded_snapshot(module, payload=None):
    payload = payload or _snapshot_payload(module)
    return gzip.compress(json.dumps(payload).encode("utf-8"), mtime=0)


def _envelope(module, service_key: str = "service-role-test-key", ciphertext: bytes = b"ciphertext"):
    _enc_pass, mac_key = module._snapshot_keys(service_key)
    return {
        "schema_version": module.ENVELOPE_SCHEMA,
        "algorithm": module.ENVELOPE_ALGORITHM,
        "pbkdf2_iterations": 200000,
        "hmac_sha256": hmac.new(mac_key, ciphertext, hashlib.sha256).hexdigest(),
        "ciphertext_base64": base64.b64encode(ciphertext).decode("ascii"),
    }


def test_decode_snapshot_validates_schema_counts_and_tables():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_decode")
    payload = module.decode_snapshot_bytes(_encoded_snapshot(module))
    assert payload["row_counts"]["inventory_items"] == 1
    assert payload["tables"]["inventory_items"][0]["sku"] == "COLLX-1"


def test_decode_snapshot_rejects_stale_or_truncated_count_contract():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_count")
    payload = _snapshot_payload(module)
    payload["row_counts"]["inventory_items"] = 2
    with pytest.raises(module.SnapshotInvalid, match="count mismatch"):
        module.decode_snapshot_bytes(_encoded_snapshot(module, payload))


def test_envelope_rejects_plaintext_or_wrong_schema():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_envelope_schema")
    raw_snapshot = json.dumps(_snapshot_payload(module)).encode("utf-8")
    with pytest.raises(module.SnapshotInvalid, match="envelope schema mismatch"):
        module.decode_envelope_bytes(raw_snapshot)


def test_decrypt_rejects_wrong_service_key_before_openssl(monkeypatch: pytest.MonkeyPatch):
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_wrong_key")
    envelope = _envelope(module, service_key="correct-key")

    def should_not_run(*args, **kwargs):
        raise AssertionError("OpenSSL must not run when HMAC authentication fails")

    monkeypatch.setattr(module.subprocess, "run", should_not_run)
    with pytest.raises(module.SnapshotInvalid, match="authentication failed"):
        module.decrypt_snapshot_envelope(envelope, "wrong-key")


def test_decrypt_authenticated_envelope_uses_secret_via_env_not_argv(monkeypatch: pytest.MonkeyPatch):
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_decrypt")
    service_key = "service-role-test-key"
    envelope = _envelope(module, service_key=service_key)
    compressed = _encoded_snapshot(module)
    calls = []

    def fake_run(args, **kwargs):
        calls.append((list(args), kwargs))
        assert service_key not in " ".join(args)
        assert args[0:4] == ["openssl", "enc", "-d", "-aes-256-cbc"]
        assert kwargs["env"].get("INSTACOMP_SNAPSHOT_ENC_PASS")
        return SimpleNamespace(returncode=0, stdout=compressed, stderr=b"")

    monkeypatch.setattr(module.subprocess, "run", fake_run)
    payload = module.decrypt_snapshot_envelope(envelope, service_key)
    assert payload["row_counts"]["inventory_items"] == 1
    assert len(calls) == 1


def test_snapshot_reader_is_drop_in_read_only_table_source():
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_reader")
    payload = _snapshot_payload(module)
    reader = module.SnapshotSupabaseReader("ignored", "ignored", snapshot=payload)
    rows = reader.table("inventory_items")
    assert rows == [{"id": "item-1", "sku": "COLLX-1"}]
    rows[0]["sku"] = "mutated"
    assert payload["tables"]["inventory_items"][0]["sku"] == "COLLX-1"
    reader.close()


def test_git_envelope_fetch_uses_existing_authenticated_git_remote(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    module = _load(SNAPSHOT_SCRIPT, "inventory_git_snapshot_fetch")
    encoded = json.dumps(_envelope(module)).encode("utf-8")
    calls = []

    def fake_run(args, **kwargs):
        calls.append(list(args))
        if args[1] == "fetch":
            return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
        if args[1] == "show":
            return SimpleNamespace(returncode=0, stdout=encoded, stderr=b"")
        raise AssertionError(args)

    monkeypatch.setattr(module.subprocess, "run", fake_run)
    envelope = module.fetch_envelope_from_git(repo_root=tmp_path)
    assert envelope["schema_version"] == module.ENVELOPE_SCHEMA
    assert calls[0][0:3] == ["git", "fetch", "--quiet"]
    assert calls[1][0:2] == ["git", "show"]


def test_resilient_sync_prefers_encrypted_snapshot_before_postgrest(monkeypatch: pytest.MonkeyPatch):
    module = _load(RESILIENT_SCRIPT, "inventory_resilient_snapshot_preferred")
    snapshot_module = sys.modules.get("inventory_training_git_snapshot")
    assert snapshot_module is not None
    snapshot = _snapshot_payload(snapshot_module)
    envelope = _envelope(snapshot_module)

    monkeypatch.setattr(module, "fetch_envelope_from_git", lambda: envelope)
    monkeypatch.setattr(snapshot_module, "decrypt_snapshot_envelope", lambda supplied, key: snapshot)

    class FakeTarget:
        SupabaseReader = None

        @staticmethod
        def main():
            assert FakeTarget.SupabaseReader is not module.ResilientSupabaseReader
            reader = FakeTarget.SupabaseReader("ignored", "service-role-test-key")
            assert reader.table("inventory_items")[0]["sku"] == "COLLX-1"
            return 0

    monkeypatch.setitem(sys.modules, "sync_all_inventory_training_truth_v2", FakeTarget)
    assert module.main() == 0


def test_invalid_snapshot_does_not_fall_back_to_postgrest(monkeypatch: pytest.MonkeyPatch):
    module = _load(RESILIENT_SCRIPT, "inventory_resilient_invalid_snapshot")
    snapshot_module = sys.modules.get("inventory_training_git_snapshot")
    assert snapshot_module is not None

    def invalid():
        raise snapshot_module.SnapshotInvalid("tampered snapshot")

    monkeypatch.setattr(module, "fetch_envelope_from_git", invalid)
    with pytest.raises(snapshot_module.SnapshotInvalid, match="tampered snapshot"):
        module.main()


def test_direct_db_batch_is_keyset_and_only_queries_linked_rows(monkeypatch: pytest.MonkeyPatch):
    module = _load(EXPORTER_SCRIPT, "inventory_snapshot_exporter_keyset")
    item_id = "00000000-0000-4000-8000-000000000123"
    queries = []
    columns = {
        "inventory_items": ["id", "sku", "title", "legacy_product_id"],
        "inventory_images": ["inventory_item_id", "image_url"],
        "inventory_attributes": ["inventory_item_id", "attribute_name", "attribute_value"],
        "products": ["id", "title"],
    }

    def fake_sql(token, ref, query):
        del token, ref
        queries.append(query)
        if "from public.inventory_items" in query and "order by id limit" in query:
            return [{"id": item_id, "sku": "COLLX-1", "title": "Card", "legacy_product_id": 1}]
        if "from public.inventory_images" in query:
            return []
        if "from public.inventory_attributes" in query:
            return []
        if "from public.products" in query:
            return [{"id": 1, "title": "Card"}]
        raise AssertionError(query)

    monkeypatch.setattr(module, "_sql", fake_sql)
    batch = module._fetch_inventory_batch("token", "ref", columns, last_id=None, batch_size=50)
    assert len(batch[0]) == 1
    assert all(" offset " not in query.lower() for query in queries)
    assert "order by id limit 50" in queries[0].lower()
    linked_queries = "\n".join(queries[1:]).lower()
    assert item_id in linked_queries
    assert "inventory_item_id in" in linked_queries


def test_direct_db_export_shrinks_on_postgres_statement_timeout(monkeypatch: pytest.MonkeyPatch):
    module = _load(EXPORTER_SCRIPT, "inventory_snapshot_exporter_shrink")
    item_id = "00000000-0000-4000-8000-000000000124"
    calls = []

    monkeypatch.setattr(
        module,
        "_existing_columns",
        lambda token, ref, table: list(module.REQUIRED_COLUMNS[table]),
    )

    def fake_batch(token, ref, columns, *, last_id, batch_size):
        del token, ref, columns, last_id
        calls.append(batch_size)
        if batch_size == 50:
            raise module.ManagementAPIError(
                400,
                {"message": "ERROR: 57014: canceling statement due to statement timeout"},
                "database/query",
            )
        return ([{"id": item_id, "sku": "COLLX-1", "title": "Card"}], [], [], [])

    monkeypatch.setattr(module, "_fetch_inventory_batch", fake_batch)
    payload = module.build_snapshot("token", "ref")
    assert calls == [50, 25]
    assert payload["row_counts"]["inventory_items"] == 1


def test_snapshot_workflow_only_publishes_encrypted_exporter_output():
    workflow = WORKFLOW.read_text("utf-8")
    exporter = EXPORTER_SCRIPT.read_text("utf-8")
    assert "inventory-training-production-snapshot.enc.json" in workflow
    assert "export_inventory_training_snapshot.py" in workflow
    assert "git add -f" in workflow
    assert "DEFAULT_BATCH_SIZE = 50" in exporter
    assert "MIN_BATCH_SIZE = 10" in exporter
    assert "where id >" in exporter
    assert " offset " not in exporter.lower()
    assert "-aes-256-cbc" in exporter
    assert "hmac_sha256" in exporter
    assert "select * from public.inventory_items" not in exporter
