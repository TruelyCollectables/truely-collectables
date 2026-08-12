from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import httpx
import pytest


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
RESILIENT_SCRIPT = SCRIPT_DIR / "sync_all_inventory_training_truth_resilient.py"
GUARD_SCRIPT = SCRIPT_DIR / "sync_all_inventory_training_truth_guarded.py"


def _load(path: Path, name: str):
    script_dir = str(SCRIPT_DIR)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code: int, payload, *, headers: dict[str, str] | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}
        self.text = text

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, effects):
        self.effects = list(effects)
        self.calls: list[dict] = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        effect = self.effects.pop(0)
        if isinstance(effect, BaseException):
            raise effect
        return effect


def _reader(module, effects):
    reader = object.__new__(module.ResilientSupabaseReader)
    reader.rest_url = "https://example.supabase.co/rest/v1"
    reader.client = FakeClient(effects)
    return reader


def test_read_timeout_retries_same_page_then_succeeds(monkeypatch: pytest.MonkeyPatch):
    module = _load(RESILIENT_SCRIPT, "inventory_resilient_timeout")
    request = httpx.Request("GET", "https://example.supabase.co/rest/v1/inventory_items")
    reader = _reader(
        module,
        [
            httpx.ReadTimeout("slow page", request=request),
            FakeResponse(206, [{"id": "one"}]),
        ],
    )
    sleeps: list[float] = []
    monkeypatch.setattr(module.time, "sleep", sleeps.append)

    rows = reader.table("inventory_items")

    assert rows == [{"id": "one"}]
    assert len(reader.client.calls) == 2
    assert reader.client.calls[0]["headers"]["Range"] == "0-499"
    assert reader.client.calls[1]["headers"]["Range"] == "0-499"
    assert sleeps == [1.0]


def test_transient_http_503_retries_and_honors_retry_after(monkeypatch: pytest.MonkeyPatch):
    module = _load(RESILIENT_SCRIPT, "inventory_resilient_503")
    reader = _reader(
        module,
        [
            FakeResponse(503, [], headers={"retry-after": "3"}, text="busy"),
            FakeResponse(200, [{"id": "one"}]),
        ],
    )
    sleeps: list[float] = []
    monkeypatch.setattr(module.time, "sleep", sleeps.append)

    rows = reader.table("inventory_items")

    assert rows == [{"id": "one"}]
    assert len(reader.client.calls) == 2
    assert sleeps == [3.0]


def test_permanent_http_401_fails_immediately(monkeypatch: pytest.MonkeyPatch):
    module = _load(RESILIENT_SCRIPT, "inventory_resilient_401")
    reader = _reader(module, [FakeResponse(401, [], text="unauthorized")])
    sleeps: list[float] = []
    monkeypatch.setattr(module.time, "sleep", sleeps.append)

    with pytest.raises(SystemExit, match="HTTP 401"):
        reader.table("inventory_items")

    assert len(reader.client.calls) == 1
    assert sleeps == []


def test_guard_routes_to_resilient_sync():
    module = _load(GUARD_SCRIPT, "inventory_sync_guard_resilient_target")
    assert module.TARGET.name == "sync_all_inventory_training_truth_resilient.py"
