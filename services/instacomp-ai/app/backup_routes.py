from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .backup import BackupError, FullBackupManager
from .config import settings


class BackupRequest(BaseModel):
    destination: str | None = Field(default=None, max_length=2048)
    label: str | None = Field(default=None, max_length=80)


def build_backup_router(require_api_key) -> APIRouter:
    router = APIRouter()
    manager = FullBackupManager(
        settings.service_root,
        settings.resolve_local_path(settings.database_path),
    )

    def resolve_destination(requested: str | None) -> Path:
        destination = (
            settings.resolve_local_path(Path(requested))
            if requested
            else settings.resolve_local_path(settings.backup_default_destination)
        )
        allowed_roots = settings.resolved_allowed_backup_roots()
        if not any(_inside(destination, root) or destination == root for root in allowed_roots):
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Backup destination is outside the configured safe locations.",
                    "allowed_roots": [str(root) for root in allowed_roots],
                },
            )
        return destination

    @router.get("/v1/backups/status", dependencies=[Depends(require_api_key)])
    async def backup_status():
        return {
            "schema": "tcos.instacomp-ai.backup-status.v1",
            "service_root": str(settings.service_root),
            "default_destination": str(
                settings.resolve_local_path(settings.backup_default_destination)
            ),
            "allowed_roots": [str(root) for root in settings.resolved_allowed_backup_roots()],
            "includes_secrets": True,
            "archive_scope": "entire InstaComp AI service folder",
        }

    @router.post("/v1/backups/full", dependencies=[Depends(require_api_key)])
    async def create_full_backup(request: BackupRequest):
        destination = resolve_destination(request.destination)
        try:
            result = manager.create(destination, request.label)
        except (BackupError, OSError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {
            "ok": True,
            "schema": "tcos.instacomp-ai.full-backup-result.v1",
            "archive_path": str(result.archive_path),
            "checksum_path": str(result.checksum_path),
            "manifest_path": str(result.manifest_path),
            "sha256": result.sha256,
            "size_bytes": result.size_bytes,
            "file_count": result.file_count,
            "created_at": result.created_at.isoformat(),
            "warning": "The ZIP can contain secrets. Move it to encrypted offsite storage.",
        }

    return router


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
