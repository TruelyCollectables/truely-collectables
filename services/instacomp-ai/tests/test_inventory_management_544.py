from __future__ import annotations

import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
RELIABLE_EXPORTER = SCRIPT_DIR / "export_inventory_training_snapshot_reliable.py"


def _load(path: Path, name: str):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SuccessResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_management_http_544_retries_then_recovers(monkeypatch: pytest.MonkeyPatch):
    reliable = _load(RELIABLE_EXPORTER, "inventory_management_544_reliable")
    target = reliable.target
    assert 544 in target.TRANSIENT_HTTP

    effects = [
        urllib.error.HTTPError(
            "https://api.supabase.com/v1/projects/ref/database/query",
            544,
            "connection timeout",
            hdrs=None,
            fp=io.BytesIO(json.dumps({"message": "Connection terminated due to connection timeout"}).encode("utf-8")),
        ),
        SuccessResponse([{"column_name": "id"}]),
    ]
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request.full_url, timeout))
        effect = effects.pop(0)
        if isinstance(effect, BaseException):
            raise effect
        return effect

    sleeps: list[float] = []
    monkeypatch.setattr(target.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(target.time, "sleep", sleeps.append)

    payload = target._request(
        "token",
        "POST",
        "/projects/ref/database/query",
        {"query": "select 1", "parameters": [], "read_only": True},
        retries=2,
    )

    assert payload == [{"column_name": "id"}]
    assert len(calls) == 2
    assert sleeps == [1]


def test_reliable_batch_uses_one_management_sql_call_and_paces(monkeypatch: pytest.MonkeyPatch):
    reliable = _load(RELIABLE_EXPORTER, "inventory_management_single_query")
    target = reliable.target
    columns = {
        "inventory_items": ["id", "legacy_product_id", "card_uuid", "sku", "title"],
        "inventory_images": ["id", "inventory_item_id", "image_url"],
        "inventory_attributes": ["id", "inventory_item_id", "attribute_name", "attribute_value"],
        "products": ["id", "card_uuid", "title"],
    }
    item_id = "3a40789e-0011-41b5-9430-d071a5fe4810"
    product_id = "45f746d0-8b91-40e2-acb6-d3e525d0eb1f"
    calls: list[str] = []

    def fake_sql(token: str, ref: str, query: str):
        calls.append(query)
        return [{
            "inventory_items": [{
                "id": item_id,
                "legacy_product_id": product_id,
                "card_uuid": None,
                "sku": "COLLX-123",
                "title": "Test Card",
            }],
            "inventory_images": [{
                "id": "image-1",
                "inventory_item_id": item_id,
                "image_url": "https://example.test/front.jpg",
            }],
            "inventory_attributes": [{
                "id": "attribute-1",
                "inventory_item_id": item_id,
                "attribute_name": "year",
                "attribute_value": "2025",
            }],
            "products": [{"id": product_id, "card_uuid": None, "title": "Test Card"}],
        }]

    sleeps: list[float] = []
    monkeypatch.setattr(target, "_sql", fake_sql)
    monkeypatch.setattr(reliable.time, "sleep", sleeps.append)

    items, images, attributes, products = reliable._fetch_inventory_batch_single_query(
        "token",
        "ref",
        columns,
        last_id=None,
        batch_size=50,
    )

    assert len(calls) == 1
    query = calls[0]
    assert "with item_page as materialized" in query.lower()
    assert "image_page as materialized" in query.lower()
    assert "attribute_page as materialized" in query.lower()
    assert "product_page as materialized" in query.lower()
    assert items[0]["id"] == item_id
    assert images[0]["inventory_item_id"] == item_id
    assert attributes[0]["attribute_name"] == "year"
    assert products[0]["id"] == product_id
    assert sleeps == [reliable.SUCCESS_BATCH_PACE_SECONDS]
    assert target._fetch_inventory_batch is reliable._fetch_inventory_batch_single_query


def test_reliable_batch_waits_through_57p03_and_retries_same_query(monkeypatch: pytest.MonkeyPatch):
    reliable = _load(RELIABLE_EXPORTER, "inventory_management_57p03_recovery")
    target = reliable.target
    columns = {
        "inventory_items": ["id", "legacy_product_id", "card_uuid", "sku", "title"],
        "inventory_images": ["id", "inventory_item_id", "image_url"],
        "inventory_attributes": ["id", "inventory_item_id", "attribute_name", "attribute_value"],
        "products": ["id", "card_uuid", "title"],
    }
    item_id = "3a40789e-0011-41b5-9430-d071a5fe4810"
    calls: list[str] = []
    effects = [
        target.ManagementAPIError(
            400,
            {"message": "FATAL: 57P03: the database system is not accepting connections; Hot standby mode is disabled."},
            "POST /projects/ref/database/query",
        ),
        [{
            "inventory_items": [{
                "id": item_id,
                "legacy_product_id": None,
                "card_uuid": None,
                "sku": "COLLX-123",
                "title": "Test Card",
            }],
            "inventory_images": [],
            "inventory_attributes": [],
            "products": [],
        }],
    ]

    def fake_sql(token: str, ref: str, query: str):
        calls.append(query)
        effect = effects.pop(0)
        if isinstance(effect, BaseException):
            raise effect
        return effect

    sleeps: list[float] = []
    monkeypatch.setattr(target, "_sql", fake_sql)
    monkeypatch.setattr(reliable.time, "sleep", sleeps.append)

    items, images, attributes, products = reliable._fetch_inventory_batch_single_query(
        "token",
        "ref",
        columns,
        last_id=None,
        batch_size=50,
    )

    assert len(calls) == 2
    assert calls[0] == calls[1]
    assert items[0]["id"] == item_id
    assert images == []
    assert attributes == []
    assert products == []
    assert sleeps == [
        reliable.DATABASE_RECOVERY_DELAYS_SECONDS[0],
        reliable.SUCCESS_BATCH_PACE_SECONDS,
    ]
