from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class BackupResult:
    archive_path: Path
    checksum_path: Path
    manifest_path: Path
    sha256: str
    size_bytes: int
    file_count: int
    created_at: datetime


class BackupError(RuntimeError):
    pass


class FullBackupManager:
    """Create a portable disaster-recovery archive of the whole service folder."""

    def __init__(self, service_root: Path, database_path: Path):
        self.service_root = service_root.resolve()
        self.database_path = database_path.resolve()

    def create(self, destination: Path, label: str | None = None) -> BackupResult:
        destination = destination.expanduser().resolve()
        destination.mkdir(parents=True, exist_ok=True)
        if not destination.is_dir():
            raise BackupError("Backup destination is not a directory")

        created_at = datetime.now(timezone.utc)
        safe_label = self._safe_label(label)
        timestamp = created_at.strftime("%Y%m%dT%H%M%SZ")
        archive_name = f"InstaComp-AI-FULL-{timestamp}{('-' + safe_label) if safe_label else ''}.zip"
        final_archive = destination / archive_name
        partial_archive = destination / f".{archive_name}.partial"
        checksum_path = destination / f"{archive_name}.sha256"
        manifest_path = destination / f"{archive_name}.manifest.json"

        if final_archive.exists() or partial_archive.exists():
            raise BackupError("A backup with this timestamp already exists")

        with tempfile.TemporaryDirectory(prefix="instacomp-ai-backup-") as temporary:
            staging = Path(temporary) / "InstaComp AI 1.0 Beta"
            self._copy_service_tree(staging, destination)
            self._replace_database_with_consistent_snapshot(staging)
            manifest = self._build_manifest(staging, created_at, archive_name)
            (staging / "BACKUP-MANIFEST.json").write_text(
                json.dumps(manifest, indent=2), encoding="utf-8"
            )
            self._write_zip(staging, partial_archive)
            archive_sha256 = self._sha256_file(partial_archive)
            os.replace(partial_archive, final_archive)

        checksum_path.write_text(
            f"{archive_sha256}  {final_archive.name}\n", encoding="utf-8"
        )
        final_manifest = {
            **manifest,
            "archive": final_archive.name,
            "archive_sha256": archive_sha256,
            "archive_size_bytes": final_archive.stat().st_size,
            "warning": "This full recovery archive may contain API keys and other secrets. Store it securely.",
        }
        manifest_path.write_text(json.dumps(final_manifest, indent=2), encoding="utf-8")

        return BackupResult(
            archive_path=final_archive,
            checksum_path=checksum_path,
            manifest_path=manifest_path,
            sha256=archive_sha256,
            size_bytes=final_archive.stat().st_size,
            file_count=int(manifest["file_count"]),
            created_at=created_at,
        )

    def _copy_service_tree(self, staging: Path, destination: Path) -> None:
        destination_inside_root = self._is_relative_to(destination, self.service_root)

        def ignore(directory: str, names: list[str]) -> set[str]:
            directory_path = Path(directory).resolve()
            ignored = {"__pycache__", ".pytest_cache", ".mypy_cache", ".DS_Store"}
            ignored.update(name for name in names if name.endswith((".pyc", ".partial")))
            if destination_inside_root:
                for name in names:
                    candidate = (directory_path / name).resolve()
                    if candidate == destination or self._is_relative_to(candidate, destination):
                        ignored.add(name)
            return ignored

        shutil.copytree(self.service_root, staging, ignore=ignore, symlinks=False)

    def _replace_database_with_consistent_snapshot(self, staging: Path) -> None:
        if not self.database_path.exists():
            return
        try:
            relative_database = self.database_path.relative_to(self.service_root)
        except ValueError as exc:
            raise BackupError("Database must live inside the InstaComp AI service folder") from exc

        staged_database = staging / relative_database
        staged_database.parent.mkdir(parents=True, exist_ok=True)
        staged_database.unlink(missing_ok=True)
        source = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        target = sqlite3.connect(staged_database)
        try:
            source.backup(target)
            integrity = target.execute("PRAGMA integrity_check").fetchone()
            if not integrity or integrity[0] != "ok":
                raise BackupError(f"SQLite snapshot failed integrity check: {integrity}")
            target.commit()
        finally:
            target.close()
            source.close()

    def _build_manifest(
        self, staging: Path, created_at: datetime, archive_name: str
    ) -> dict[str, object]:
        files: list[dict[str, object]] = []
        total = 0
        for path in sorted(item for item in staging.rglob("*") if item.is_file()):
            relative = path.relative_to(staging).as_posix()
            size = path.stat().st_size
            total += size
            files.append({"path": relative, "size_bytes": size, "sha256": self._sha256_file(path)})
        return {
            "schema": "tcos.instacomp-ai.full-backup.v1",
            "product": "InstaComp AI™",
            "codename": "InstaComp AI 1.0 Beta",
            "created_at": created_at.isoformat(),
            "requested_archive": archive_name,
            "service_root_name": self.service_root.name,
            "file_count": len(files),
            "uncompressed_size_bytes": total,
            "files": files,
        }

    @staticmethod
    def _write_zip(staging: Path, target: Path) -> None:
        with zipfile.ZipFile(target, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    archive.write(path, Path(staging.name) / path.relative_to(staging))

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _safe_label(label: str | None) -> str:
        if not label:
            return ""
        value = "".join(character if character.isalnum() or character in "-_" else "-" for character in label.strip())
        return value.strip("-")[:48]

    @staticmethod
    def _is_relative_to(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False
