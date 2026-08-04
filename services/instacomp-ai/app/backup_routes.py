from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .backup import BackupError, FullBackupManager
from .config import settings


class BackupRequest(BaseModel):
    destination: str | None = Field(default=None, max_length=2048)
    label: str | None = Field(default=None, max_length=80)


def build_backup_router(require_api_key) -> APIRouter:
    router = APIRouter()
    manager = FullBackupManager(settings.service_root, settings.database_path)

    def resolve_destination(requested: str | None) -> Path:
        destination = Path(requested).expanduser().resolve() if requested else settings.backup_default_destination.expanduser().resolve()
        allowed_roots = settings.resolved_allowed_backup_roots()
        if not any(_inside(destination, root) or destination == root for root in allowed_roots):
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Backup destination is outside the configured safe locations.",
                    "allowed_roots": [str(root) for root in allowed_roots],
                },
            )
        return destination

    @router.get("/control", response_class=HTMLResponse)
    async def control_page() -> str:
        default_destination = str(settings.backup_default_destination.expanduser().resolve())
        return f"""<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>InstaComp AI Control</title>
<style>body{{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 18px;background:#111;color:#eee}}section{{background:#1b1b1b;padding:24px;border-radius:14px}}input,button{{font:inherit;padding:12px;border-radius:8px;border:1px solid #555}}input{{width:100%;box-sizing:border-box;background:#090909;color:#fff;margin:6px 0 14px}}button{{cursor:pointer;font-weight:700}}pre{{white-space:pre-wrap;background:#080808;padding:14px;border-radius:8px}}</style></head>
<body><h1>InstaComp AI™</h1><section><h2>Full Disaster-Recovery Backup</h2>
<p>This creates one ZIP containing the entire InstaComp AI folder, including the AI database, card images, checklist registry, receipts, configuration, logs, code and recovery manifest.</p>
<label>Backup location</label><input id=\"destination\" value=\"{default_destination}\">
<label>Optional label</label><input id=\"label\" placeholder=\"Before checklist import\">
<label>API key, only when configured</label><input id=\"key\" type=\"password\">
<button id=\"backup\">BACK UP EVERYTHING NOW</button><pre id=\"result\">Ready.</pre></section>
<script>document.getElementById('backup').onclick=async()=>{{const out=document.getElementById('result');out.textContent='Building full backup…';const key=document.getElementById('key').value;try{{const response=await fetch('/v1/backups/full',{{method:'POST',headers:{{'content-type':'application/json',...(key?{{'x-instacomp-ai-key':key}}:{{}})}},body:JSON.stringify({{destination:document.getElementById('destination').value,label:document.getElementById('label').value}})}});const body=await response.json();out.textContent=JSON.stringify(body,null,2)}}catch(error){{out.textContent=String(error)}}}};</script></body></html>"""

    @router.get("/v1/backups/status", dependencies=[Depends(require_api_key)])
    async def backup_status():
        return {
            "schema": "tcos.instacomp-ai.backup-status.v1",
            "service_root": str(settings.service_root),
            "default_destination": str(settings.backup_default_destination.expanduser().resolve()),
            "allowed_roots": [str(root) for root in settings.resolved_allowed_backup_roots()],
            "includes_secrets": True,
            "archive_scope": "entire InstaComp AI service folder",
        }

    @router.post("/v1/backups/full", dependencies=[Depends(require_api_key)])
    async def create_full_backup(request: BackupRequest):
        destination = resolve_destination(request.destination)
        try:
            result = manager.create(destination, request.label)
        except (BackupError, OSError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {
            "ok": True,
            "schema": "tcos.instacomp-ai.full-backup-result.v1",
            "archive_path": str(result.archive_path),
            "checksum_path": str(result.checksum_path),
            "manifest_path": str(result.manifest_path),
            "sha256": result.sha256,
            "size_bytes": result.size_bytes,
            "file_count": result.file_count,
            "created_at": result.created_at.isoformat(),
            "warning": "The ZIP can contain secrets. Move it to encrypted offsite storage.",
        }

    return router


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
