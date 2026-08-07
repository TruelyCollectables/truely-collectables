from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
from contextlib import suppress
from pathlib import Path
from typing import Any, Callable

import httpx
from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
)

from .sentinel import ChecklistSentinel
from .sentinel_sources import targets_from_payload

_MAX_RELAY_BYTES = 50_000_000
_BACKLOG_DRAIN_POLL_SECONDS = 60.0


def _constant_time_text_equal(left: str, right: str) -> bool:
    return bool(left and right and hmac.compare_digest(left.encode(), right.encode()))


def _archive_token_valid(
    provided: str | None,
    authorization: str | None = None,
) -> bool:
    expected = os.getenv("INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN", "").strip()
    if _constant_time_text_equal((provided or "").strip(), expected):
        return True
    scheme, _, encoded = (authorization or "").partition(" ")
    if scheme.lower() != "basic" or not encoded.strip():
        return False
    try:
        decoded = base64.b64decode(encoded.strip(), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return False
    username, separator, password = decoded.partition(":")
    return bool(
        separator
        and username == "sentinel"
        and _constant_time_text_equal(password, expected)
    )


def _pending_backlog_ready(
    status: dict[str, Any],
    *,
    has_due_targets: bool,
) -> bool:
    targets = status.get("targets") or {}
    latest = status.get("latest_job") or {}
    try:
        pending = int(targets.get("pending") or 0)
    except (TypeError, ValueError):
        pending = 0
    running = str(latest.get("status") or "") == "running"
    return pending > 0 and has_due_targets and not running


def build_sentinel_router(
    require_api_key: Callable[..., None],
    database_path: Path,
    service_root: Path,
) -> APIRouter:
    sentinel = ChecklistSentinel(
        database_path=database_path,
        service_root=service_root,
    )
    outer = APIRouter()
    protected = APIRouter(
        prefix="/v1/checklist-sentinel",
        tags=["InstaComp AI Checklist Sentinel"],
        dependencies=[Depends(require_api_key)],
    )
    backlog_drain_stop = asyncio.Event()
    backlog_drain_task: asyncio.Task[None] | None = None

    async def _drain_pending_backlog() -> None:
        while not backlog_drain_stop.is_set():
            try:
                snapshot = sentinel.status()
                has_due_targets = bool(sentinel.store.due_targets(1))
                if _pending_backlog_ready(
                    snapshot,
                    has_due_targets=has_due_targets,
                ):
                    await sentinel.trigger(trigger="pending-backlog-drain")
            except Exception:
                # Fail closed: the normal 24-hour scheduler remains intact if
                # backlog draining cannot safely inspect or start the next batch.
                pass

            try:
                await asyncio.wait_for(
                    backlog_drain_stop.wait(),
                    timeout=_BACKLOG_DRAIN_POLL_SECONDS,
                )
            except asyncio.TimeoutError:
                continue

    @outer.on_event("startup")
    async def _start_sentinel() -> None:
        nonlocal backlog_drain_task
        await sentinel.start()
        backlog_drain_stop.clear()
        if backlog_drain_task is None or backlog_drain_task.done():
            backlog_drain_task = asyncio.create_task(
                _drain_pending_backlog(),
                name="instacomp-ai-checklist-sentinel-backlog-drain",
            )

    @outer.on_event("shutdown")
    async def _stop_sentinel() -> None:
        nonlocal backlog_drain_task
        backlog_drain_stop.set()
        if backlog_drain_task:
            backlog_drain_task.cancel()
            with suppress(asyncio.CancelledError):
                await backlog_drain_task
            backlog_drain_task = None
        await sentinel.stop()

    @protected.get("/status")
    async def status() -> dict[str, Any]:
        return sentinel.status()

    @protected.post("/run")
    async def run_now(
        trigger: str = Body(default="manual-api", embed=True),
    ) -> dict[str, Any]:
        return await sentinel.trigger(trigger=trigger[:100])

    @protected.post("/refresh-targets")
    async def refresh_targets() -> dict[str, Any]:
        counts = await sentinel.refresh_targets()
        return {"ok": True, "targets": counts}

    @protected.post("/targets")
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

    @protected.get("/targets")
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

    @protected.get("/findings")
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

    @protected.get("/downloads")
    async def downloads(
        limit: int = Query(default=200, ge=1, le=5000),
    ) -> dict[str, Any]:
        return {"downloads": sentinel.store.list_downloads(limit=limit)}

    @protected.get("/sources")
    async def sources() -> dict[str, Any]:
        return {"sources": sentinel.store.list_sources()}

    # Sentinel posts a multipart source file to localhost. The relay validates
    # the dedicated archive credential and exact bytes, then sends only a small
    # signed metadata request to Vercel. Production independently re-fetches the
    # public source and verifies the same SHA-256 before private archival.
    @outer.post(
        "/v1/checklist-sentinel/registry-import-relay",
        tags=["InstaComp AI Checklist Sentinel"],
    )
    async def registry_import_relay(
        file: UploadFile = File(...),
        target_key: str = Form(alias="targetKey"),
        sport: str = Form(default=""),
        year: str = Form(default=""),
        season: str = Form(default=""),
        manufacturer: str = Form(default=""),
        product: str = Form(default=""),
        source_url: str = Form(alias="sourceUrl"),
        sha256: str = Form(...),
        source: str = Form(default="instacomp-ai-checklist-sentinel"),
        archive_token_header: str | None = Header(
            default=None,
            alias="x-instacomp-sentinel-archive-token",
        ),
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        if not _archive_token_valid(archive_token_header, authorization):
            raise HTTPException(
                status_code=401,
                detail="Valid Sentinel archive token required.",
            )

        central_url = os.getenv(
            "INSTACOMP_AI_SENTINEL_CENTRAL_IMPORT_URL",
            "",
        ).strip()
        archive_token = os.getenv(
            "INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN",
            "",
        ).strip()
        if not central_url.startswith("https://"):
            raise HTTPException(
                status_code=503,
                detail="Central Sentinel archive endpoint is not configured.",
            )
        if not archive_token:
            raise HTTPException(
                status_code=503,
                detail="Sentinel archive authentication is not configured.",
            )

        expected_sha = sha256.strip().lower()
        if len(expected_sha) != 64 or any(
            ch not in "0123456789abcdef" for ch in expected_sha
        ):
            raise HTTPException(status_code=400, detail="Invalid SHA-256 receipt.")

        digest = hashlib.sha256()
        byte_count = 0
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            byte_count += len(chunk)
            if byte_count > _MAX_RELAY_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Checklist source exceeds 50 MB limit.",
                )
            digest.update(chunk)

        actual_sha = digest.hexdigest()
        if actual_sha != expected_sha:
            raise HTTPException(
                status_code=409,
                detail="Local checklist SHA-256 receipt mismatch.",
            )

        payload = {
            "targetKey": target_key[:500],
            "sport": sport[:120],
            "year": year[:40],
            "season": season[:40],
            "manufacturer": manufacturer[:200],
            "product": product[:300],
            "sourceUrl": source_url[:4000],
            "sha256": expected_sha,
            "source": source[:120],
            "byteCount": byte_count,
            "contentType": (file.content_type or "application/octet-stream")[:200],
            "fileName": (file.filename or "checklist-source.bin")[:300],
        }
        headers = {
            "content-type": "application/json",
            "x-instacomp-sentinel-archive-token": archive_token,
        }
        try:
            async with httpx.AsyncClient(
                timeout=180.0,
                follow_redirects=False,
                headers=headers,
            ) as client:
                response = await client.post(central_url, json=payload)
            data = response.json() if response.content else {}
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Central Registry archive request failed: {str(exc)[:500]}",
            ) from exc

        if not response.is_success or data.get("ok") is not True:
            raise HTTPException(
                status_code=502,
                detail=str(
                    data.get("error")
                    or f"Central archive HTTP {response.status_code}"
                )[:1000],
            )
        return data

    outer.include_router(protected)
    return outer
