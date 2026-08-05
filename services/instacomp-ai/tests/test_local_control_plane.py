from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.backup import BackupManager
from app.cockpit_routes import build_cockpit_router
from app.config import Settings
from app.local_settings import LocalSettingsManager, LocalSettingsUpdate
from app.settings_routes import build_settings_router


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "database_path": tmp_path / "data" / "memory.sqlite3",
        "image_store_path": tmp_path / "data" / "images",
        "backup_default_destination": tmp_path / "backups",
        "backup_allowed_roots": str(tmp_path / "backups"),
        "local_cache_source_path": "",
        "api_key": None,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_local_settings_are_atomic_and_receipted(tmp_path: Path) -> None:
    service_root = tmp_path / "service"
    service_root.mkdir()
    env_path = service_root / ".env"
    env_path.write_text('INSTACOMP_AI_API_KEY="keep-secret"\n', encoding="utf-8")
    settings = make_settings(tmp_path)
    manager = LocalSettingsManager(settings, service_root=service_root)

    result = manager.save(
        LocalSettingsUpdate(
            local_cache_source_path="./cache-source",
            backup_default_destination=str(tmp_path / "backups"),
            backup_allowed_roots=str(tmp_path / "backups"),
            ollama_model="qwen2.5vl:7b",
            restart_service=False,
        )
    )

    assert result["ok"] is True
    assert result["receipt_created"] is True
    updated = env_path.read_text(encoding="utf-8")
    assert 'INSTACOMP_AI_API_KEY="keep-secret"' in updated
    assert "INSTACOMP_AI_LOCAL_CACHE_SOURCE_PATH" in updated
    assert not (service_root / ".env.partial").exists()

    receipt = json.loads(
        (service_root / "data" / "receipts" / "settings" / "latest.json").read_text(
            encoding="utf-8"
        )
    )
    assert receipt["canonical_identity_authority"] == "central_checklist_registry"
    assert "keep-secret" not in json.dumps(receipt)


def test_relative_settings_paths_cannot_escape_service_root(tmp_path: Path) -> None:
    service_root = tmp_path / "service"
    service_root.mkdir()
    manager = LocalSettingsManager(make_settings(tmp_path), service_root=service_root)

    with pytest.raises(ValueError, match="may not escape"):
        manager.save(
            LocalSettingsUpdate(
                backup_default_destination="../outside",
                backup_allowed_roots="../outside",
                restart_service=False,
            )
        )


def test_settings_restart_runs_as_after_response_background_task(tmp_path: Path) -> None:
    service_root = tmp_path / "service"
    service_root.mkdir()
    manager = LocalSettingsManager(make_settings(tmp_path), service_root=service_root)
    calls: list[str] = []

    app = FastAPI()
    app.include_router(
        build_settings_router(
            lambda: None,
            manager=manager,
            restart_launcher=lambda: calls.append("restarted"),
        )
    )
    response = TestClient(app).post(
        "/v1/settings/local",
        json={
            "backup_default_destination": str(tmp_path / "backups"),
            "backup_allowed_roots": str(tmp_path / "backups"),
            "ollama_model": "qwen2.5vl:7b",
            "restart_service": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["restart_scheduled"] is True
    assert response.json()["restart_timing"] == "after_response"
    assert calls == ["restarted"]


def test_backup_is_limited_to_approved_roots(tmp_path: Path) -> None:
    service_root = tmp_path / "service"
    service_root.mkdir()
    (service_root / "app").mkdir()
    (service_root / "app" / "example.py").write_text("value = 1\n", encoding="utf-8")
    allowed = tmp_path / "allowed"
    settings = make_settings(
        tmp_path,
        backup_default_destination=allowed,
        backup_allowed_roots=str(allowed),
    )
    manager = BackupManager(settings, service_root=service_root)

    result = manager.create(str(allowed))
    archive = Path(result["archive"])
    assert archive.is_file()
    assert result["file_count"] == 1
    with zipfile.ZipFile(archive) as backup:
        assert backup.namelist() == ["app/example.py"]

    with pytest.raises(ValueError, match="outside the approved"):
        manager.create(str(tmp_path / "not-approved"))


class FakeStore:
    def ready(self) -> bool:
        return True


class FakeReader:
    async def health(self) -> bool:
        return False


class FakeRegistry:
    async def health(self) -> bool:
        return True


def test_cockpit_declares_central_registry_authority() -> None:
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
    assert "checklist_result.identity_id" in main_source
    assert "Exact Registry identity locked" in main_source
    assert "RegistryChecklistGateway" in checklist_source
    assert "/api/instacomp/checklist-lookup" in checklist_source
    assert "registry_identity:" in checklist_source
    assert "registry_fingerprint:" in checklist_source
    assert "from .registry" not in main_source
