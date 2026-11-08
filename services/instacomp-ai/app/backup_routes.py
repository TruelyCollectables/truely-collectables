from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .backup import BackupManager
from .config import settings


class BackupRequest(BaseModel):
    destination: str | None = Field(default=None, max_length=4096)


def build_backup_router(
    require_api_key,
    manager: BackupManager | None = None,
) -> APIRouter:
    router = APIRouter()
    backup_manager = manager or BackupManager(settings)

    @router.post(
        "/v1/control/backup",
        dependencies=[Depends(require_api_key)],
    )
    async def create_backup(request: BackupRequest):
        try:
            return await run_in_threadpool(
                backup_manager.create,
                request.destination,
            )
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
