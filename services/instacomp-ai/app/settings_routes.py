from __future__ import annotations

import subprocess
from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from .config import settings
from .deal_hunter_routes import build_deal_hunter_router
from .local_settings import LocalSettingsManager, LocalSettingsUpdate
from .runtime_identity import RUNTIME_IDENTITY_FILES, runtime_source_fingerprint
from .sentinel_routes import build_sentinel_router


RestartLauncher = Callable[[], None]


def launch_local_restart() -> None:
    restart_script = settings.service_root / "scripts" / "restart-local-service.sh"
    subprocess.Popen(
        ["bash", str(restart_script)],
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

    # InstaComp AI owns Checklist Sentinel as an internal service process. The
    # existing settings router is loaded by app.main on every startup, so
    # mounting Sentinel here keeps scheduling, checkpoints, and APIs inside the
    # InstaComp AI service without a separate ChatGPT task or external cron.
    router.include_router(
        build_sentinel_router(
            require_api_key,
            settings.resolve_local_path(settings.database_path),
            settings.service_root,
        )
    )

    # Deal Hunter is owned by the same always-on Mac service. It keeps its own
    # durable scheduler state while using InstaComp's exact front/back identity
    # path and canonical Registry truth.
    router.include_router(build_deal_hunter_router(require_api_key))

    @router.get("/v1/runtime-identity")
    async def runtime_identity():
        return {
            "schema_version": "tcos.instacomp-ai.runtime-identity.v1",
            "runtime_source_fingerprint": runtime_source_fingerprint(),
            "tracked_files": list(RUNTIME_IDENTITY_FILES),
            "version": settings.version,
        }

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
