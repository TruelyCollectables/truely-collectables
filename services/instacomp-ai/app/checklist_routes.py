from __future__ import annotations

import asyncio
import html
import json
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from .config import settings

_SYNC_LOCK = asyncio.Lock()


def build_checklist_router(require_api_key) -> APIRouter:
    router = APIRouter()
    service_root = settings.service_root
    receipt_path = service_root / "data" / "receipts" / "checklist-sync" / "latest-inventory.json"
    registry_receipt_path = service_root / "data" / "registry" / "latest-build.json"

    @router.get("/control/checklists", response_class=HTMLResponse)
    async def checklist_control() -> str:
        source = html.escape(os.environ.get("INSTACOMP_AI_CHECKLIST_SOURCE_PATH", "Not configured"))
        return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>InstaComp AI Checklist Control</title><style>body{{font-family:system-ui;max-width:820px;margin:40px auto;padding:0 18px;background:#111;color:#eee}}section{{background:#1b1b1b;padding:24px;border-radius:14px;margin-bottom:18px}}button,input{{font:inherit;padding:12px;border-radius:8px;border:1px solid #555}}button{{font-weight:800;cursor:pointer}}input{{width:100%;box-sizing:border-box;background:#080808;color:#fff}}pre{{white-space:pre-wrap;background:#080808;padding:14px;border-radius:8px;max-height:480px;overflow:auto}}</style></head>
<body><h1>InstaComp AI™ Checklist Control</h1><section><p><b>Source folder:</b> {source}</p><label>API key, only when configured</label><input id='key' type='password'><p><button id='sync'>SYNC CHECKLISTS NOW</button> <button id='status'>REFRESH STATUS</button></p><pre id='result'>Ready.</pre></section>
<script>const out=document.getElementById('result');const headers=()=>{{const k=document.getElementById('key').value;return k?{{'x-instacomp-ai-key':k}}:{{}}}};document.getElementById('status').onclick=async()=>{{out.textContent='Loading…';const r=await fetch('/v1/checklists/status',{{headers:headers()}});out.textContent=JSON.stringify(await r.json(),null,2)}};document.getElementById('sync').onclick=async()=>{{out.textContent='Synchronizing and rebuilding registry…';const r=await fetch('/v1/checklists/sync',{{method:'POST',headers:headers()}});out.textContent=JSON.stringify(await r.json(),null,2)}};</script></body></html>"""

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
