from pathlib import Path
import sqlite3
import zipfile

from app.backup import FullBackupManager


def test_full_backup_contains_database_files_and_manifest(tmp_path: Path):
    service = tmp_path / "InstaComp AI"
    data = service / "data"
    data.mkdir(parents=True)
    database = data / "instacomp_ai.sqlite3"
    connection = sqlite3.connect(database)
    connection.execute("create table lessons(id integer primary key, value text)")
    connection.execute("insert into lessons(value) values ('verified memory')")
    connection.commit()
    connection.close()
    (service / ".env").write_text("SECRET=test\n", encoding="utf-8")
    (service / "checklists").mkdir()
    (service / "checklists" / "registry.csv").write_text("id,name\n1,card\n", encoding="utf-8")

    destination = tmp_path / "offsite"
    result = FullBackupManager(service, database).create(destination, "manual")

    assert result.archive_path.exists()
    assert result.checksum_path.exists()
    assert result.manifest_path.exists()
    with zipfile.ZipFile(result.archive_path) as archive:
        names = set(archive.namelist())
        root = "InstaComp AI 1.0 Beta/"
        assert root + "data/instacomp_ai.sqlite3" in names
        assert root + ".env" in names
        assert root + "checklists/registry.csv" in names
        assert root + "BACKUP-MANIFEST.json" in names
        restored = tmp_path / "restored.sqlite3"
        restored.write_bytes(archive.read(root + "data/instacomp_ai.sqlite3"))
        check = sqlite3.connect(restored)
        assert check.execute("select value from lessons").fetchone()[0] == "verified memory"
        check.close()
