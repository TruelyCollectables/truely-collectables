from __future__ import annotations

import hashlib
import importlib.util
import json
import zipfile
from pathlib import Path

import pytest


SERVICE_ROOT = Path(__file__).resolve().parents[1]
RESTORE_SCRIPT = SERVICE_ROOT / "scripts" / "restore-full-backup.py"


def load_restore_module():
    spec = importlib.util.spec_from_file_location(
        "instacomp_restore_full_backup",
        RESTORE_SCRIPT,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def create_verified_archive(tmp_path: Path) -> Path:
    archive = tmp_path / "InstaComp-AI-FULL-test.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
        output.writestr("app/example.py", "value = 1\n")
        output.writestr("data/receipts/example.json", "{}\n")
    checksum = digest(archive)
    archive.with_suffix(".zip.sha256").write_text(
        f"{checksum}  {archive.name}\n",
        encoding="utf-8",
    )
    archive.with_suffix(".zip.manifest.json").write_text(
        json.dumps(
            {
                "schema": "tcos.instacomp-ai.full-backup.v2",
                "archive_sha256": checksum,
                "file_count": 2,
            }
        ),
        encoding="utf-8",
    )
    return archive


def test_restore_verification_and_no_overwrite_apply(tmp_path: Path) -> None:
    restore = load_restore_module()
    archive = create_verified_archive(tmp_path)

    verification = restore.inspect_archive(archive)
    assert verification["archive_sha256"] == digest(archive)
    assert verification["file_count"] == 2
    assert verification["canonical_identity_authority"] == "central_checklist_registry"
    assert verification["local_cache_is_authoritative"] is False

    destination = tmp_path / "restored"
    receipt = restore.restore_archive(archive, destination, verification)
    assert (destination / "app" / "example.py").is_file()
    assert receipt.is_file()

    with pytest.raises(ValueError, match="must not already exist"):
        restore.restore_archive(archive, destination, verification)


def test_restore_rejects_path_traversal(tmp_path: Path) -> None:
    restore = load_restore_module()
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("../escape.txt", "blocked")

    with pytest.raises(ValueError, match="Unsafe archive path"):
        restore.inspect_archive(archive)


def test_restore_rejects_digest_mismatch(tmp_path: Path) -> None:
    restore = load_restore_module()
    archive = create_verified_archive(tmp_path)
    archive.with_suffix(".zip.sha256").write_text(
        f"{'0' * 64}  {archive.name}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="SHA-256 verification failed"):
        restore.inspect_archive(archive)


def test_mac_launchers_remain_local_and_fail_closed() -> None:
    run_local = (SERVICE_ROOT / "scripts" / "run-local.sh").read_text(
        encoding="utf-8"
    )
    launch_cockpit = (SERVICE_ROOT / "scripts" / "launch-cockpit.sh").read_text(
        encoding="utf-8"
    )
    install_macos = (SERVICE_ROOT / "scripts" / "install-macos.sh").read_text(
        encoding="utf-8"
    )

    assert "127.0.0.1" in run_local
    assert "Refusing to expose" in run_local
    assert "INSTACOMP_AI_API_KEY" in run_local
    assert "http://127.0.0.1" in launch_cockpit
    assert "launchctl kickstart" in launch_cockpit
    assert "Library/LaunchAgents" in install_macos
    assert "RunAtLoad" in install_macos
    assert "KeepAlive" in install_macos
    assert "scripts/run-local.sh" in install_macos


def test_desktop_installer_requires_approved_icon_and_safe_link() -> None:
    installer = (SERVICE_ROOT / "scripts" / "install-desktop-app.sh").read_text(
        encoding="utf-8"
    )
    asset_readme = (SERVICE_ROOT / "assets" / "README.md").read_text(
        encoding="utf-8"
    )

    assert "instacomp-ai-approved-icon.png" in installer
    assert "instacomp-ai-approved-icon.jpg" in installer
    assert "at least 512x512" in installer
    assert "Refusing to replace existing non-symlink" in installer
    assert "no generated placeholder" in asset_readme


def test_environment_template_preserves_central_registry_authority() -> None:
    template = (SERVICE_ROOT / ".env.example").read_text(encoding="utf-8")

    assert "INSTACOMP_AI_REGISTRY_URL" in template
    assert "INSTACOMP_AI_REGISTRY_TOKEN" in template
    assert "INSTACOMP_AI_LOCAL_CACHE_SOURCE_PATH" in template
    assert "Canonical identity always comes from" in template
    assert "INSTACOMP_AI_API_KEY" in template
