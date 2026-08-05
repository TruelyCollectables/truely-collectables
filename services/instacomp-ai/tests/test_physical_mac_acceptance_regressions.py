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


def test_registry_token_supports_service_and_seller_channels(monkeypatch) -> None:
    monkeypatch.setenv("INSTACOMP_AI_REGISTRY_TOKEN", "physical-mac-test-token")
    headers = checklist._registry_headers()
    assert headers["authorization"] == "Bearer physical-mac-test-token"
    assert (
        headers["x-tcos-instacomp-service-token"]
        == "physical-mac-test-token"
    )
