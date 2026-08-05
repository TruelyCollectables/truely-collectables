from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings


async def run_system_doctor(
    settings: Settings,
    store,
    reader,
    checklist_gateway,
) -> dict[str, Any]:
    service_root = settings.service_root.resolve()
    database_path = settings.resolve_local_path(settings.database_path)
    image_store = settings.resolve_local_path(settings.image_store_path)
    backup_destination = settings.resolve_local_path(
        settings.backup_default_destination
    )

    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str, required: bool = True) -> None:
        checks.append(
            {
                "name": name,
                "ok": ok,
                "required": required,
                "detail": detail,
            }
        )

    add(
        "service_root",
        service_root.is_dir() and os.access(service_root, os.R_OK | os.W_OK),
        "Protected service folder is readable and writable.",
    )
    add(
        "database",
        bool(store.ready()),
        f"Local evidence database path is prepared: {database_path.name}",
    )
    add(
        "image_store",
        image_store.is_dir() and os.access(image_store, os.R_OK | os.W_OK),
        "Local image evidence folder is readable and writable.",
    )
    add(
        "backup_destination",
        backup_destination.is_dir()
        and os.access(backup_destination, os.R_OK | os.W_OK),
        "Default backup destination is readable and writable.",
    )

    registry_ready = await checklist_gateway.health()
    add(
        "central_registry",
        bool(registry_ready),
        "Central Checklist Registry is configured."
        if registry_ready
        else "Central Checklist Registry is not configured; identity and pricing remain blocked.",
    )

    ollama_ready = await reader.health()
    add(
        "ollama",
        bool(ollama_ready),
        f"Ollama model {settings.ollama_model} is reachable."
        if ollama_ready
        else f"Ollama model {settings.ollama_model} is unavailable.",
        required=False,
    )

    cache_source = settings.resolved_cache_source()
    add(
        "local_cache_source",
        bool(cache_source and cache_source.is_dir()),
        "Optional local checklist cache source is mounted."
        if cache_source and cache_source.is_dir()
        else "Optional local checklist cache source is not mounted; it is never canonical authority.",
        required=False,
    )

    required_ok = all(check["ok"] for check in checks if check["required"])
    return {
        "schema": "tcos.instacomp-ai.system-doctor.v2",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": required_ok,
        "beta_1_0_passed": False,
        "canonical_identity_authority": "central_checklist_registry",
        "local_cache_is_authoritative": False,
        "checks": checks,
    }
