from __future__ import annotations

import subprocess

from fastapi import APIRouter, Depends, HTTPException

from .config import settings
from .local_settings import LocalSettingsManager, LocalSettingsUpdate


def build_settings_router(require_api_key) -> APIRouter:
    router = APIRouter()
    manager = LocalSettingsManager(settings)

    @router.get(
        "/v1/settings/local",
        dependencies=[Depends(require_api_key)],
    )
    async def local_settings():
        return manager.current()

    @router.post(
        "/v1/settings/local",
        dependencies=[Depends(require_api_key)],
    )
    async def update_local_settings(request: LocalSettingsUpdate):
        try:
            result = manager.save(request)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        restart_started = False
        if request.restart_service:
            restart_script = settings.service_root / "scripts" / "restart-local-service.sh"
            try:
                subprocess.Popen(
                    [str(restart_script)],
                    cwd=str(settings.service_root),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                restart_started = True
            except OSError as exc:
                result["warnings"].append(
                    f"Settings were saved, but automatic restart could not start: {exc}"
                )

        return {**result, "restart_started": restart_started}

    return router
