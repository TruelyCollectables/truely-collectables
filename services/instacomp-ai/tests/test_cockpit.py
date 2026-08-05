from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.cockpit_routes import build_cockpit_router


def _allow_without_key() -> None:
    return None


def build_client() -> TestClient:
    app = FastAPI()
    app.include_router(build_cockpit_router(_allow_without_key))
    return TestClient(app)


def test_cockpit_page_contains_primary_modules():
    client = build_client()
    response = client.get("/control")

    assert response.status_code == 200
    assert "InstaComp AI" in response.text
    assert "Scan Bay" in response.text
    assert "Registry Control" in response.text
    assert "Learning Core" in response.text
    assert "Full Backup Vault" in response.text
    assert "Logs & Diagnostics" in response.text
    assert "/control/assets/cockpit-doctor.js" in response.text


def test_cockpit_assets_are_local_and_available():
    client = build_client()

    css = client.get("/control/assets/cockpit.css")
    javascript = client.get("/control/assets/cockpit.js")
    doctor_javascript = client.get("/control/assets/cockpit-doctor.js")

    assert css.status_code == 200
    assert "text/css" in css.headers["content-type"]
    assert javascript.status_code == 200
    assert "javascript" in javascript.headers["content-type"]
    assert doctor_javascript.status_code == 200
    assert "javascript" in doctor_javascript.headers["content-type"]


def test_system_status_reports_local_paths_and_storage():
    client = build_client()
    response = client.get("/v1/system/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema"] == "tcos.instacomp-ai.cockpit-status.v1"
    assert payload["local_only"] is True
    assert payload["paths"]["service_root"]
    assert payload["storage"]["disk_total_bytes"] > 0


def test_system_doctor_is_available_from_cockpit_api():
    client = build_client()
    response = client.get("/v1/system/doctor")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema"] == "tcos.instacomp-ai.system-doctor.v1"
    assert "checks" in payload
    assert payload["summary"]["total"] == len(payload["checks"])


def test_unknown_cockpit_asset_is_rejected():
    client = build_client()
    response = client.get("/control/assets/not-real.js")
    assert response.status_code == 404
