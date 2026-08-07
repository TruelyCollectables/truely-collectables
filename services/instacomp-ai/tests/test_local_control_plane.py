from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.cockpit_routes import build_cockpit_router


class FakeStore:
    def ready(self):
        return True


class FakeReader:
    async def health(self):
        return True


class FakeRegistry:
    async def health(self):
        return True


def test_control_plane_reports_registry_as_authority():
    app = FastAPI()
    app.include_router(
        build_cockpit_router(
            lambda: None,
            FakeStore(),
            FakeReader(),
            FakeRegistry(),
        )
    )
    client = TestClient(app)

    page = client.get("/control")
    assert page.status_code == 200
    assert "central Checklist Registry" in page.text
    assert "cannot publish listings" in page.text

    status = client.get("/v1/control/status")
    assert status.status_code == 200
    payload = status.json()
    assert payload["canonical_identity_authority"] == "central_checklist_registry"
    assert payload["local_cache_is_authoritative"] is False
    assert payload["seller_mutations_allowed"] is False
    assert payload["beta_1_0_passed"] is False


def test_current_scanner_keeps_central_registry_boundary() -> None:
    root = Path(__file__).resolve().parents[1]
    main_source = (root / "app" / "main.py").read_text(encoding="utf-8")
    checklist_source = (root / "app" / "checklist.py").read_text(encoding="utf-8")

    assert "checklist_gateway.match" in main_source
    assert "suggestion_registry.identity_id" in main_source
    assert 'receipt.startswith("registry_fingerprint:")' in main_source
    assert 'match_source = "ollama_backup"' in main_source
    assert "RegistryChecklistGateway" in checklist_source
    assert "/api/instacomp/checklist-lookup" in checklist_source
    assert "registry_identity:" in checklist_source
    assert "registry_fingerprint:" in checklist_source
    assert "from .registry" not in main_source
