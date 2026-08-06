from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .sentinel import ChecklistSentinel
from .sentinel_sources import targets_from_payload


def build_sentinel_router(
    require_api_key: Callable[..., None],
    database_path: Path,
    service_root: Path,
) -> APIRouter:
    sentinel = ChecklistSentinel(
        database_path=database_path,
        service_root=service_root,
    )
    router = APIRouter(
        prefix="/v1/checklist-sentinel",
        tags=["InstaComp AI Checklist Sentinel"],
        dependencies=[Depends(require_api_key)],
    )

    @router.on_event("startup")
    async def _start_sentinel() -> None:
        await sentinel.start()

    @router.on_event("shutdown")
    async def _stop_sentinel() -> None:
        await sentinel.stop()

    @router.get("/status")
    async def status() -> dict[str, Any]:
        return sentinel.status()

    @router.post("/run")
    async def run_now(
        trigger: str = Body(default="manual-api", embed=True),
    ) -> dict[str, Any]:
        return await sentinel.trigger(trigger=trigger[:100])

    @router.post("/refresh-targets")
    async def refresh_targets() -> dict[str, Any]:
        counts = await sentinel.refresh_targets()
        return {"ok": True, "targets": counts}

    @router.post("/targets")
    async def add_targets(payload: Any = Body(...)) -> dict[str, Any]:
        targets = targets_from_payload(payload)
        if not targets:
            raise HTTPException(
                status_code=400,
                detail="No valid checklist targets were supplied.",
            )
        changed = sentinel.store.upsert_targets(targets)
        return {
            "ok": True,
            "received": len(targets),
            "database_changes": changed,
            "targets": sentinel.store.target_counts(),
        }

    @router.get("/targets")
    async def list_targets(
        limit: int = Query(default=500, ge=1, le=5000),
        status_filter: str | None = Query(default=None, alias="status"),
    ) -> dict[str, Any]:
        return {
            "targets": sentinel.store.list_targets(
                limit=limit,
                status=status_filter,
            ),
            "counts": sentinel.store.target_counts(),
        }

    @router.get("/findings")
    async def findings(
        limit: int = Query(default=200, ge=1, le=5000),
        status_filter: str | None = Query(default=None, alias="status"),
    ) -> dict[str, Any]:
        return {
            "findings": sentinel.store.list_findings(
                limit=limit,
                status=status_filter,
            )
        }

    @router.get("/downloads")
    async def downloads(
        limit: int = Query(default=200, ge=1, le=5000),
    ) -> dict[str, Any]:
        return {"downloads": sentinel.store.list_downloads(limit=limit)}

    @router.get("/sources")
    async def sources() -> dict[str, Any]:
        return {"sources": sentinel.store.list_sources()}

    return router
