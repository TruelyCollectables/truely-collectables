from __future__ import annotations

import subprocess
from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from .config import settings
from .local_settings import LocalSettingsManager, LocalSettingsUpdate


RestartLauncher = Callable[[], None]


def launch_local_restart() -> None:
    restart_script = settings.service_root / "scripts" / "restart-local-service.sh"
    subprocess.Popen(
        [str(restart_script)],
        cwd=str(settings.service_root),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def build_settings_router(
    require_api_key,
    manager: LocalSettingsManager | None = None,
    restart_launcher: RestartLauncher = launch_local_restart,
) -> APIRouter:
    router = APIRouter()
    settings_manager = manager or LocalSettingsManager(settings)

    @router.get(
        "/v1/settings/local",
        dependencies=[Depends(require_api_key)],
    )
    async def local_settings():
        return settings_manager.current()

    @router.post(
        "/v1/settings/local",
        dependencies=[Depends(require_api_key)],
    )
    async def update_local_settings(
        request: LocalSettingsUpdate,
        background_tasks: BackgroundTasks,
    ):
        try:
            result = settings_manager.save(request)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        restart_scheduled = False
        if request.restart_service:
            background_tasks.add_task(restart_launcher)
            restart_scheduled = True

        return {
            **result,
            "restart_scheduled": restart_scheduled,
            "restart_timing": "after_response" if restart_scheduled else "not_requested",
        }

    return router
