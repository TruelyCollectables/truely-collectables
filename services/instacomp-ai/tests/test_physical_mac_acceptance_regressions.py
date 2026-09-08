from __future__ import annotations

from pathlib import Path

from app import checklist


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def test_mac_launcher_does_not_require_bash_mapfile() -> None:
    launcher = (SERVICE_ROOT / "scripts" / "run-local.sh").read_text(encoding="utf-8")
    assert "mapfile" not in launcher
    assert "IFS='|' read -r host port api_key_state" in launcher


def test_mac_launcher_exports_protected_env_for_launchd() -> None:
    launcher = (SERVICE_ROOT / "scripts" / "run-local.sh").read_text(encoding="utf-8")
    assert 'if [[ -f "$service_root/.env" ]]' in launcher
    assert "set -a" in launcher
    assert 'source "$service_root/.env"' in launcher
    assert "set +a" in launcher


def test_macos_installer_rejects_python_314_and_prefers_313() -> None:
    installer = (SERVICE_ROOT / "scripts" / "install-macos.sh").read_text(
        encoding="utf-8"
    )
    assert "<= (3, 13)" in installer
    assert "python3.13" in installer
    assert "Python 3.14 is not supported" in installer


def test_registry_auth_is_mac_local_only(monkeypatch) -> None:
    monkeypatch.setenv("INSTACOMP_AI_REGISTRY_URL", "http://127.0.0.1:8787")
    monkeypatch.setenv("INSTACOMP_AI_API_KEY", "physical-mac-test-key")
    monkeypatch.setenv("INSTACOMP_AI_REGISTRY_TOKEN", "must-not-be-used")
    monkeypatch.setenv("INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN", "must-not-be-used-either")
    headers = checklist._registry_headers()
    assert headers["x-instacomp-ai-key"] == "physical-mac-test-key"
    assert "authorization" not in headers
    assert "x-tcos-instacomp-service-token" not in headers
    assert "x-instacomp-sentinel-archive-token" not in headers
