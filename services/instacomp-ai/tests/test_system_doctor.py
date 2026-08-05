from pathlib import Path

from app.config import Settings
from app.system_doctor import SystemDoctor


def test_system_doctor_reports_blocking_missing_checklist(tmp_path: Path):
    settings = Settings(
        database_path=tmp_path / "data" / "instacomp.sqlite3",
        image_store_path=tmp_path / "data" / "images",
        checklist_source_path=None,
        checklist_mirror_path=tmp_path / "data" / "checklists" / "mirror",
        registry_path=tmp_path / "data" / "registry" / "registry.sqlite3",
        backup_default_destination=tmp_path / "backups",
        backup_allowed_roots=str(tmp_path / "backups"),
    )

    result = SystemDoctor(settings).run()

    assert result["schema"] == "tcos.instacomp-ai.system-doctor.v1"
    checklist = next(
        check for check in result["checks"] if check["id"] == "checklist-source"
    )
    assert checklist["status"] == "fail"
    assert "INSTACOMP_AI_CHECKLIST_SOURCE_PATH" in checklist["repair"]
    assert result["summary"]["failures"] >= 1


def test_system_doctor_accepts_readable_checklist_folder(tmp_path: Path):
    checklist = tmp_path / "drive" / "checklists"
    checklist.mkdir(parents=True)
    settings = Settings(
        database_path=tmp_path / "data" / "instacomp.sqlite3",
        image_store_path=tmp_path / "data" / "images",
        checklist_source_path=checklist,
        checklist_mirror_path=tmp_path / "data" / "checklists" / "mirror",
        registry_path=tmp_path / "data" / "registry" / "registry.sqlite3",
        backup_default_destination=tmp_path / "backups",
        backup_allowed_roots=str(tmp_path / "backups"),
    )

    result = SystemDoctor(settings).run()
    source_check = next(
        check for check in result["checks"] if check["id"] == "checklist-source"
    )

    assert source_check["status"] == "pass"
    assert source_check["message"] == str(checklist)


def test_cockpit_doctor_asset_contains_required_checks():
    root = Path(__file__).resolve().parents[1]
    javascript = (root / "cockpit" / "cockpit-doctor.js").read_text(encoding="utf-8")

    assert "/v1/system/doctor" in javascript
    assert "RUN SYSTEM DOCTOR" in javascript
    assert "MISSION READY" in javascript
    assert "REPAIR:" in javascript
