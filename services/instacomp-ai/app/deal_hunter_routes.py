from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from .config import settings
from .deal_hunter import DealHunterScheduler
from .deal_hunter_store import DealHunterStore
from .deal_hunter_targeted import ALLOWED_TARGET_LANES, run_targeted_lane


_store = DealHunterStore(settings.resolve_local_path(settings.database_path))
_scheduler = DealHunterScheduler(settings, _store)


def build_deal_hunter_router(require_api_key) -> APIRouter:
    router = APIRouter(prefix="/v1/deal-hunter", tags=["Deal Hunter"])

    @router.on_event("startup")
    async def start_deal_hunter_scheduler() -> None:
        await _scheduler.start()

    @router.on_event("shutdown")
    async def stop_deal_hunter_scheduler() -> None:
        await _scheduler.stop()

    @router.get("/status", dependencies=[Depends(require_api_key)])
    async def deal_hunter_status():
        state = _store.scheduler_state()
        return {
            "schema_version": "truely.deal-hunter.scheduler.v1",
            "enabled": bool(state.get("enabled")),
            "running": bool(state.get("running")),
            "interval_minutes": state.get("interval_minutes"),
            "active_run_id": state.get("active_run_id"),
            "last_started_at": state.get("last_started_at"),
            "last_completed_at": state.get("last_completed_at"),
            "next_run_at": state.get("next_run_at"),
            "last_status": state.get("last_status"),
            "last_error": state.get("last_error"),
            "site_url": settings.deal_hunter_site_url,
            "max_candidates_per_run": settings.deal_hunter_max_candidates_per_run,
            "candidate_cooldown_hours": settings.deal_hunter_candidate_cooldown_hours,
            "mac_evaluation_key_configured": bool(settings.api_key),
        }

    @router.post("/run", dependencies=[Depends(require_api_key)])
    async def run_deal_hunter_now():
        return await _scheduler.run_now(trigger="manual")

    @router.post("/run-targeted", dependencies=[Depends(require_api_key)])
    async def run_deal_hunter_targeted(
        lane: str = Query(...),
        force: bool = Query(default=False),
        limit: int = Query(default=10, ge=1, le=20),
    ):
        if lane not in ALLOWED_TARGET_LANES:
            raise HTTPException(status_code=400, detail="Unknown Deal Hunter lane")
        return await run_targeted_lane(
            _scheduler,
            lane=lane,
            force=force,
            limit=limit,
        )

    @router.get("/runs", dependencies=[Depends(require_api_key)])
    async def deal_hunter_runs(limit: int = Query(default=20, ge=1, le=200)):
        return {"runs": _store.recent_runs(limit)}

    @router.get("/candidates", dependencies=[Depends(require_api_key)])
    async def deal_hunter_candidates(
        limit: int = Query(default=100, ge=1, le=500),
        actionable_only: bool = Query(default=False),
    ):
        return {
            "candidates": _store.recent_candidates(
                limit=limit,
                actionable_only=actionable_only,
            )
        }

    return router
