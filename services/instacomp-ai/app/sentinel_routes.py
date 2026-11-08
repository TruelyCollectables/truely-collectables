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
from starlette.requests import Request

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
    auto_drain = os.getenv("INSTACOMP_AI_SENTINEL_BACKLOG_DRAIN_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    return auto_drain and pending > 0 and has_due_targets and not running


def build_sentinel_router(
    require_api_key: Callable[..., None],
    database_path: Path,
    service_root: Path,
) -> APIRouter:
    sentinel = ChecklistSentinel(
        database_path=database_path,
        service_root=service_root,
        coordinated_runs=True,
    )
    external_worker_mode = os.getenv(
        "INSTACOMP_AI_EXTERNAL_BACKGROUND_WORKERS", ""
    ).strip().lower() in {"1", "true", "yes", "on"}
    refresh_request_path = service_root / "data" / "sentinel-worker-refresh.request"
    outer = APIRouter()
    protected = APIRouter(
        prefix="/v1/checklist-sentinel",
        tags=["InstaComp AI Checklist Sentinel"],
        dependencies=[Depends(require_api_key)],
    )
    backlog_drain_stop = asyncio.Event()
    backlog_drain_task: asyncio.Task[None] | None = None

    async def _drain_pending_backlog() -> None:
        # Keep API startup fast, but never drain a stale inventory queue. The
        # background drain owns the first live inventory refresh and blocks its
        # own work selection until that refresh is complete.
        try:
            await sentinel.refresh_inventory_targets()
            await sentinel.refresh_targets()
        except Exception:
            pass
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
        if external_worker_mode:
            sentinel.store.initialize()
            return
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
        if external_worker_mode:
            return
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
    async def run_now(payload: Any = Body(default=None)) -> dict[str, Any]:
        trigger = "manual-api"
        target_keys = None
        if isinstance(payload, dict):
            trigger = str(payload.get("trigger") or trigger)
            raw_keys = payload.get("target_keys") or payload.get("targetKeys")
            if isinstance(raw_keys, list):
                target_keys = [str(value).strip() for value in raw_keys if str(value).strip()][:500]
        if external_worker_mode:
            requeue = None
            if target_keys:
                requeue = sentinel.store.requeue_targets(target_keys, priority=1)
            return {
                "accepted": True,
                "queued": True,
                "external_worker": True,
                "requeue": requeue,
            }
        return await sentinel.trigger(trigger=trigger[:100], target_keys=target_keys)

    @protected.post("/refresh-targets")
    async def refresh_targets() -> dict[str, Any]:
        if external_worker_mode:
            refresh_request_path.parent.mkdir(parents=True, exist_ok=True)
            refresh_request_path.touch()
            return {"ok": True, "queued": True, "external_worker": True}
        inventory = await sentinel.refresh_inventory_targets()
        counts = await sentinel.refresh_targets()
        return {"ok": True, "inventory": inventory, "targets": counts}

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

    @protected.post("/requeue-targets")
    async def requeue_targets(payload: Any = Body(...)) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Object payload required.")
        raw_keys = payload.get("target_keys") or payload.get("targetKeys") or []
        if not isinstance(raw_keys, list):
            raise HTTPException(status_code=400, detail="target_keys must be a list.")
        target_keys = [str(value).strip() for value in raw_keys if str(value).strip()]
        if not target_keys or len(target_keys) > 500:
            raise HTTPException(
                status_code=400,
                detail="Provide between 1 and 500 target keys.",
            )
        try:
            priority = int(payload.get("priority") or 1)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="priority must be an integer.")

        result = sentinel.store.requeue_targets(target_keys, priority=priority)
        launch = None
        if result.get("requeued"):
            launch = await sentinel.trigger(trigger="priority-requeue")
        return {
            "ok": True,
            "requeue": result,
            "launch": launch,
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
    # the dedicated archive credential, bounded byte count, and exact SHA-256,
    # then forwards those exact bytes to the protected central Registry route.
    # This supports public sources that reject cloud/datacenter re-fetches while
    # still requiring Registry parsing/validation before a target is recovered.
    @outer.post(
        "/v1/checklist-sentinel/registry-import-relay",
        tags=["InstaComp AI Checklist Sentinel"],
    )
    async def registry_import_relay(request: Request) -> dict[str, Any]:
        archive_token_header = request.headers.get("x-instacomp-sentinel-archive-token")
        authorization = request.headers.get("authorization")
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

        content_type = (request.headers.get("content-type") or "").lower()
        payload: dict[str, Any]
        source_file: UploadFile | None = None
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            payload = {
                "targetKey": form.get("targetKey"),
                "sport": form.get("sport"),
                "year": form.get("year"),
                "season": form.get("season"),
                "manufacturer": form.get("manufacturer"),
                "product": form.get("product"),
                "sourceUrl": form.get("sourceUrl"),
                "sha256": form.get("sha256"),
                "source": form.get("source"),
            }
            candidate = form.get("sourceFile") or form.get("file")
            if candidate is not None and hasattr(candidate, "read"):
                source_file = candidate  # type: ignore[assignment]
        else:
            try:
                body = await request.json()
            except Exception:
                body = {}
            if not isinstance(body, dict):
                body = {}
            payload = {
                "targetKey": body.get("targetKey") or body.get("target_key"),
                "sport": body.get("sport"),
                "year": body.get("year"),
                "season": body.get("season"),
                "manufacturer": body.get("manufacturer"),
                "product": body.get("product"),
                "sourceUrl": body.get("sourceUrl") or body.get("source_url"),
                "sha256": body.get("sha256"),
                "source": body.get("source"),
            }

        target_key = str(payload.get("targetKey") or "").strip()
        sport = str(payload.get("sport") or "").strip()
        year = str(payload.get("year") or "").strip()
        season = str(payload.get("season") or "").strip()
        manufacturer = str(payload.get("manufacturer") or "").strip()
        product = str(payload.get("product") or "").strip()
        source_url = str(payload.get("sourceUrl") or "").strip()
        sha256 = str(payload.get("sha256") or "").strip().lower()
        source = str(payload.get("source") or "instacomp-ai-checklist-sentinel").strip()

        if len(sha256) != 64 or any(ch not in "0123456789abcdef" for ch in sha256):
            raise HTTPException(status_code=400, detail="Invalid SHA-256 receipt.")

        byte_count = 0
        source_bytes: bytes
        content_type = "application/octet-stream"
        file_name = "checklist-source.bin"
        if source_file is not None:
            digest = hashlib.sha256()
            chunks: list[bytes] = []
            while True:
                chunk = await source_file.read(1024 * 1024)
                if not chunk:
                    break
                byte_count += len(chunk)
                if byte_count > _MAX_RELAY_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Checklist source exceeds 50 MB limit.",
                    )
                digest.update(chunk)
                chunks.append(bytes(chunk))
            if byte_count <= 0:
                raise HTTPException(status_code=400, detail="Checklist source is empty.")
            actual_sha = digest.hexdigest()
            if actual_sha != sha256:
                raise HTTPException(
                    status_code=409,
                    detail="Local checklist SHA-256 receipt mismatch.",
                )
            source_bytes = b"".join(chunks)
            content_type = (source_file.content_type or "application/octet-stream")[:200]
            file_name = (source_file.filename or "checklist-source.bin")[:300]
        else:
            if not source_url:
                raise HTTPException(
                    status_code=400,
                    detail="Checklist sourceUrl is required when sourceFile is omitted.",
                )
            source_fetch = await fetchVerifiedSource(source_url, 0)
            source_bytes = source_fetch.bytes
            byte_count = source_fetch.byteCount
            content_type = source_fetch.contentType[:200]
            file_name = safeFileName(source_fetch.finalUrl.rsplit("/", 1)[-1] or "checklist-source", content_type)
            actual_sha = createHash("sha256").update(source_bytes).digest("hex")
            if actual_sha != sha256:
                raise HTTPException(
                    status_code=409,
                    detail="Fetched checklist SHA-256 did not match the receipt.",
                )
        payload = {
            "targetKey": target_key[:500],
            "sport": sport[:120],
            "year": year[:40],
            "season": season[:40],
            "manufacturer": manufacturer[:200],
            "product": product[:300],
            "sourceUrl": source_url[:4000],
            "sha256": sha256,
            "source": source[:120],
            "byteCount": str(byte_count),
            "contentType": content_type,
            "fileName": file_name,
        }
        headers = {
            "x-instacomp-sentinel-archive-token": archive_token,
        }
        try:
            async with httpx.AsyncClient(
                timeout=180.0,
                follow_redirects=False,
                headers=headers,
            ) as client:
                response = await client.post(
                    central_url,
                    data=payload,
                    files={
                        "sourceFile": (
                            file_name,
                            source_bytes,
                            content_type,
                        ),
                        "file": (
                            file_name,
                            source_bytes,
                            content_type,
                        ),
                    },
                )
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
