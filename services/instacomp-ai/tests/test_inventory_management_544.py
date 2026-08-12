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
