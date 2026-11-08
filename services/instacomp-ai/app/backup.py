from __future__ import annotations

import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings


_EXCLUDED_PARTS = {
    ".git",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "backups",
    "desktop",
}


class BackupManager:
    def __init__(self, settings: Settings, service_root: Path | None = None) -> None:
        self.settings = settings
        self.service_root = (service_root or settings.service_root).resolve()

    def create(self, destination: str | None = None) -> dict[str, Any]:
        root = self._resolve_destination(
            destination or str(self.settings.backup_default_destination)
        )
        root.mkdir(parents=True, exist_ok=True)
        if not root.is_dir() or not os.access(root, os.R_OK | os.W_OK):
            raise ValueError("Backup destination is not readable and writable")

        timestamp = datetime.now(timezone.utc)
        stamp = timestamp.strftime("%Y%m%dT%H%M%S.%fZ")
        archive = root / f"InstaComp-AI-FULL-{stamp}.zip"
        temporary = archive.with_suffix(".zip.partial")
        manifest_path = archive.with_suffix(".zip.manifest.json")
        digest_path = archive.with_suffix(".zip.sha256")

        file_count = 0
        total_bytes = 0
        with zipfile.ZipFile(
            temporary,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as output:
            for path in sorted(self.service_root.rglob("*")):
                if not path.is_file() or self._excluded(path, root):
                    continue
                relative = path.relative_to(self.service_root)
                output.write(path, relative.as_posix())
                file_count += 1
                total_bytes += path.stat().st_size

        os.replace(temporary, archive)
        digest = self._sha256(archive)
        digest_path.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
        manifest = {
            "schema": "tcos.instacomp-ai.full-backup.v2",
            "created_at": timestamp.isoformat(),
            "archive_name": archive.name,
            "archive_sha256": digest,
            "file_count": file_count,
            "uncompressed_bytes": total_bytes,
            "canonical_identity_authority": "central_checklist_registry",
            "local_cache_is_authoritative": False,
        }
        self._atomic_json(manifest_path, manifest)
        return {
            "ok": True,
            "schema": manifest["schema"],
            "archive": str(archive),
            "sha256": digest,
            "manifest": str(manifest_path),
            "file_count": file_count,
            "uncompressed_bytes": total_bytes,
        }

    def _resolve_destination(self, value: str) -> Path:
        destination = self._resolve_user_path(value)
        allowed = [
            self._resolve_user_path(str(root))
            for root in self.settings.resolved_allowed_backup_roots()
        ]
        if not any(
            destination == root or self._inside(destination, root)
            for root in allowed
        ):
            raise ValueError("Backup destination is outside the approved backup roots")
        return destination

    def _resolve_user_path(self, value: str) -> Path:
        path = Path(value).expanduser()
        if path.is_absolute():
            return path.resolve()
        resolved = (self.service_root / path).resolve()
        if resolved != self.service_root and not self._inside(resolved, self.service_root):
            raise ValueError("Relative paths may not escape the protected service folder")
        return resolved

    def _excluded(self, path: Path, destination: Path) -> bool:
        relative_parts = set(path.relative_to(self.service_root).parts)
        if relative_parts.intersection(_EXCLUDED_PARTS):
            return True
        return path == destination or self._inside(path, destination)

    @staticmethod
    def _inside(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
        temporary = path.with_suffix(path.suffix + ".partial")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(temporary, path)
