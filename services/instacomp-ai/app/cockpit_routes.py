from __future__ import annotations

import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse

from .config import settings
from .system_doctor import SystemDoctor

_STARTED_MONOTONIC = time.monotonic()
_STARTED_AT = datetime.now(timezone.utc)

_ASSETS = {
    "cockpit.css": "text/css",
    "cockpit.js": "application/javascript",
    "cockpit-doctor.js": "application/javascript",
}

_LOGS = {
    "service-out": "service.stdout.log",
    "service-error": "service.stderr.log",
    "checklist-out": "checklist-sync.stdout.log",
    "checklist-error": "checklist-sync.stderr.log",
}


def build_cockpit_router(require_api_key) -> APIRouter:
    router = APIRouter()
    service_root = settings.service_root
    cockpit_root = service_root / "cockpit"
    logs_root = service_root / "data" / "logs"
    doctor = SystemDoctor(settings)

    @router.get("/control", response_class=HTMLResponse)
    async def cockpit() -> str:
        template_path = cockpit_root / "index.html"
        if not template_path.exists():
            raise HTTPException(status_code=500, detail="Cockpit interface is missing")
        page = template_path.read_text(encoding="utf-8")
        replacements = {
            "__APP_NAME__": settings.app_name,
            "__CODENAME__": settings.codename,
            "__VERSION__": settings.version,
            "__MODEL__": settings.ollama_model,
            "__DEFAULT_BACKUP__": str(
                settings.resolve_local_path(settings.backup_default_destination)
            ),
        }
        for marker, value in replacements.items():
            page = page.replace(marker, _escape_html(value))
        page = page.replace(
            "</body>",
            '<script defer src="/control/assets/cockpit-doctor.js"></script></body>',
        )
        return page

    @router.get("/control/assets/{asset_name}")
    async def cockpit_asset(asset_name: str):
        media_type = _ASSETS.get(asset_name)
        if not media_type:
            raise HTTPException(status_code=404, detail="Asset not found")
        path = cockpit_root / asset_name
        if not path.exists():
            raise HTTPException(status_code=404, detail="Asset not found")
        return FileResponse(path, media_type=media_type)

    @router.get(
        "/v1/system/status",
        dependencies=[Depends(require_api_key)],
    )
    async def system_status():
        usage = shutil.disk_usage(service_root)
        database_path = settings.resolve_local_path(settings.database_path)
        registry_path = settings.resolve_local_path(settings.registry_path)
        image_root = settings.resolve_local_path(settings.image_store_path)
        receipts_root = service_root / "data" / "receipts"
        quarantine_root = service_root / "data" / "quarantine"
        backup_root = settings.resolve_local_path(settings.backup_default_destination)
        checklist_source = settings.resolved_checklist_source()
        latest_backup = _latest_file(backup_root, "*.zip")
        return {
            "schema": "tcos.instacomp-ai.cockpit-status.v1",
            "app": settings.app_name,
            "codename": settings.codename,
            "version": settings.version,
            "local_only": settings.host in {"127.0.0.1", "localhost"},
            "host": settings.host,
            "port": settings.port,
            "started_at": _STARTED_AT.isoformat(),
            "uptime_seconds": int(time.monotonic() - _STARTED_MONOTONIC),
            "ollama": {
                "base_url": settings.ollama_base_url,
                "model": settings.ollama_model,
            },
            "security": {
                "api_key_configured": bool(settings.api_key),
            },
            "paths": {
                "service_root": str(service_root),
                "database": str(database_path),
                "registry": str(registry_path),
                "images": str(image_root),
                "checklist_source": str(checklist_source) if checklist_source else None,
                "backup_default": str(backup_root),
            },
            "storage": {
                "disk_total_bytes": usage.total,
                "disk_used_bytes": usage.used,
                "disk_free_bytes": usage.free,
                "database_bytes": _size(database_path),
                "registry_bytes": _size(registry_path),
                "image_files": _count_files(image_root),
                "image_bytes": _tree_size(image_root),
                "receipt_files": _count_files(receipts_root),
                "quarantine_files": _count_files(quarantine_root),
            },
            "latest_backup": _file_summary(latest_backup),
        }

    @router.get(
        "/v1/system/doctor",
        dependencies=[Depends(require_api_key)],
    )
    async def system_doctor():
        return doctor.run()

    @router.get(
        "/v1/system/logs/{log_name}",
        dependencies=[Depends(require_api_key)],
    )
    async def system_log(
        log_name: str,
        lines: int = Query(default=120, ge=10, le=1000),
    ):
        filename = _LOGS.get(log_name)
        if not filename:
            raise HTTPException(status_code=404, detail="Unknown log")
        path = logs_root / filename
        return {
            "schema": "tcos.instacomp-ai.log-tail.v1",
            "log": log_name,
            "path": str(path),
            "exists": path.exists(),
            "lines": _tail(path, lines),
        }

    return router


def _escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _size(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


def _count_files(root: Path) -> int:
    if not root.exists():
        return 0
    try:
        return sum(1 for item in root.rglob("*") if item.is_file())
    except OSError:
        return 0


def _tree_size(root: Path) -> int:
    if not root.exists():
        return 0
    total = 0
    try:
        for item in root.rglob("*"):
            if item.is_file():
                try:
                    total += item.stat().st_size
                except OSError:
                    continue
    except OSError:
        return total
    return total


def _latest_file(root: Path, pattern: str) -> Path | None:
    if not root.exists():
        return None
    candidates = []
    try:
        candidates = [item for item in root.glob(pattern) if item.is_file()]
    except OSError:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime, default=None)


def _file_summary(path: Path | None) -> dict[str, object] | None:
    if path is None:
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    return {
        "name": path.name,
        "path": str(path),
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def _tail(path: Path, line_count: int) -> list[str]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.readlines()[-line_count:]
    except OSError:
        return []
