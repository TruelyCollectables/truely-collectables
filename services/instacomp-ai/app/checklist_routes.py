from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from .config import settings

_SYNC_LOCK = asyncio.Lock()


def build_checklist_router(require_api_key) -> APIRouter:
    router = APIRouter()
    service_root = settings.service_root
    receipt_path = service_root / "data" / "receipts" / "checklist-sync" / "latest-inventory.json"
    registry_receipt_path = service_root / "data" / "registry" / "latest-build.json"

    @router.get("/v1/checklists/status", dependencies=[Depends(require_api_key)])
    async def checklist_status():
        return {
            "schema": "tcos.instacomp-ai.checklist-status.v1",
            "source_path": os.environ.get("INSTACOMP_AI_CHECKLIST_SOURCE_PATH"),
            "sync_running": _SYNC_LOCK.locked(),
            "last_sync": _load_json(receipt_path),
            "registry": _load_json(registry_receipt_path),
        }

    @router.post("/v1/checklists/sync", dependencies=[Depends(require_api_key)])
    async def sync_checklists_now():
        if _SYNC_LOCK.locked():
            raise HTTPException(status_code=409, detail="Checklist sync is already running")
        async with _SYNC_LOCK:
            process = await asyncio.create_subprocess_exec(
                str(service_root / "scripts" / "run-checklist-sync.sh"),
                cwd=str(service_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            if process.returncode not in {0, 3}:
                raise HTTPException(
                    status_code=500,
                    detail={
                        "message": "Checklist sync failed",
                        "exit_code": process.returncode,
                        "stderr": stderr.decode("utf-8", errors="replace")[-8000:],
                    },
                )
            return {
                "ok": process.returncode == 0,
                "registry_ready": process.returncode == 0,
                "exit_code": process.returncode,
                "stdout": stdout.decode("utf-8", errors="replace")[-12000:],
                "stderr": stderr.decode("utf-8", errors="replace")[-4000:],
                "last_sync": _load_json(receipt_path),
            }

    return router


def _load_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"error": f"Could not read {path}"}
