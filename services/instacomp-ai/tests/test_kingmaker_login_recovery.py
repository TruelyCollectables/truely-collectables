from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.kingmaker_accounting_routes import build_kingmaker_accounting_router
from app.kingmaker_commercial_inventory import _ebay_credential_paths


def test_empty_inventory_list_does_not_require_ebay(tmp_path):
    app = FastAPI()
    app.include_router(build_kingmaker_accounting_router(lambda: None, tmp_path / "kingmaker_accounting.sqlite3", tmp_path / "scans.sqlite3"))
    with patch("app.kingmaker_accounting_routes.fetch_ebay_seller_snapshot", side_effect=AssertionError("list must not call eBay")):
        response = TestClient(app).post("/v1/kingmaker/accounting/commercial-inventory", json={"action": "list", "items": []})
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["ebaySnapshot"]["refreshed"] is False


def test_credential_path_overrides_are_respected(monkeypatch, tmp_path):
    monkeypatch.setenv("KINGMAKER_EBAY_ENV_PATH", str(tmp_path / "configured.env"))
    monkeypatch.setenv("KINGMAKER_EBAY_TOKEN_PATH", str(tmp_path / "configured.json"))
    assert _ebay_credential_paths() == (tmp_path / "configured.env", tmp_path / "configured.json")
