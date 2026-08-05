from pathlib import Path

from app.config import Settings


def test_relative_paths_are_anchored_to_service_folder():
    settings = Settings(
        database_path=Path("./data/test.sqlite3"),
        checklist_source_path=Path("./checklists/source"),
        backup_default_destination=Path("./backups"),
    )

    assert settings.resolve_local_path(settings.database_path).is_absolute()
    assert settings.resolve_local_path(settings.database_path).parent.name == "data"
    assert settings.resolved_checklist_source() == (
        settings.service_root / "checklists" / "source"
    ).resolve()
    assert settings.resolved_allowed_backup_roots() == [
        (settings.service_root / "backups").resolve()
    ]


def test_absolute_external_backup_root_remains_external(tmp_path: Path):
    external = tmp_path / "offsite"
    settings = Settings(
        backup_default_destination=Path("./backups"),
        backup_allowed_roots=str(external),
    )

    assert settings.resolved_allowed_backup_roots() == [external.resolve()]
