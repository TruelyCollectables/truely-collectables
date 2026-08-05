from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .config import Settings

_ENV_KEYS = {
    "checklist_source_path": "INSTACOMP_AI_CHECKLIST_SOURCE_PATH",
    "backup_default_destination": "INSTACOMP_AI_BACKUP_DEFAULT_DESTINATION",
    "backup_allowed_roots": "INSTACOMP_AI_BACKUP_ALLOWED_ROOTS",
    "ollama_model": "INSTACOMP_AI_OLLAMA_MODEL",
}

_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")


class LocalSettingsUpdate(BaseModel):
    checklist_source_path: str = Field(default="", max_length=4096)
    backup_default_destination: str = Field(default="./backups", min_length=1, max_length=4096)
    backup_allowed_roots: str = Field(default="", max_length=8192)
    ollama_model: str = Field(default="qwen2.5vl:7b", min_length=1, max_length=200)
    restart_service: bool = True

    @field_validator(
        "checklist_source_path",
        "backup_default_destination",
        "backup_allowed_roots",
        "ollama_model",
        mode="before",
    )
    @classmethod
    def trim(cls, value: object) -> str:
        return str(value or "").strip()

    @field_validator("ollama_model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if not _MODEL_PATTERN.fullmatch(value):
            raise ValueError("Ollama model contains unsupported characters")
        return value


class LocalSettingsManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.service_root = settings.service_root
        self.env_path = self.service_root / ".env"
        self.receipt_root = self.service_root / "data" / "receipts" / "settings"

    def current(self) -> dict[str, Any]:
        source = self.settings.resolved_checklist_source()
        default_backup = self.settings.resolve_local_path(
            self.settings.backup_default_destination
        )
        return {
            "schema": "tcos.instacomp-ai.local-settings.v1",
            "checklist_source_path": str(source) if source else "",
            "checklist_source_available": bool(source and source.is_dir()),
            "backup_default_destination": str(default_backup),
            "backup_allowed_roots": ",".join(
                str(path) for path in self.settings.resolved_allowed_backup_roots()
            ),
            "ollama_model": self.settings.ollama_model,
            "host": self.settings.host,
            "port": self.settings.port,
            "api_key_configured": bool(self.settings.api_key),
            "env_path": str(self.env_path),
        }

    def save(self, request: LocalSettingsUpdate) -> dict[str, Any]:
        self.receipt_root.mkdir(parents=True, exist_ok=True)
        self._validate_backup_paths(request)

        timestamp = datetime.now(timezone.utc)
        stamp = timestamp.strftime("%Y%m%dT%H%M%S.%fZ")
        previous_backup: Path | None = None
        if self.env_path.exists():
            previous_backup = self.receipt_root / f"env-before-{stamp}.backup"
            shutil.copy2(self.env_path, previous_backup)

        updates = {
            _ENV_KEYS["checklist_source_path"]: request.checklist_source_path,
            _ENV_KEYS["backup_default_destination"]: request.backup_default_destination,
            _ENV_KEYS["backup_allowed_roots"]: request.backup_allowed_roots,
            _ENV_KEYS["ollama_model"]: request.ollama_model,
        }
        updated_text = self._replace_env_values(
            self.env_path.read_text(encoding="utf-8") if self.env_path.exists() else "",
            updates,
        )
        temporary = self.env_path.with_suffix(".env.partial")
        temporary.write_text(updated_text, encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.env_path)

        warnings = self._warnings(request)
        receipt = {
            "schema": "tcos.instacomp-ai.local-settings-change.v1",
            "created_at": timestamp.isoformat(),
            "env_path": str(self.env_path),
            "previous_env_backup": str(previous_backup) if previous_backup else None,
            "changed_keys": list(updates),
            "restart_requested": request.restart_service,
            "warnings": warnings,
        }
        receipt_path = self.receipt_root / f"settings-{stamp}.json"
        latest_path = self.receipt_root / "latest.json"
        self._atomic_json(receipt_path, receipt)
        self._atomic_json(latest_path, receipt)
        return {
            "ok": True,
            "restart_required": True,
            "restart_requested": request.restart_service,
            "receipt_path": str(receipt_path),
            "warnings": warnings,
        }

    def _validate_backup_paths(self, request: LocalSettingsUpdate) -> None:
        default_destination = self._resolve_user_path(request.backup_default_destination)
        default_destination.mkdir(parents=True, exist_ok=True)
        if not default_destination.is_dir() or not os.access(
            default_destination, os.R_OK | os.W_OK
        ):
            raise ValueError("Default backup destination is not readable and writable")

        roots = [
            item.strip()
            for item in request.backup_allowed_roots.split(",")
            if item.strip()
        ]
        for root_value in roots:
            root = self._resolve_user_path(root_value)
            root.mkdir(parents=True, exist_ok=True)
            if not root.is_dir() or not os.access(root, os.R_OK | os.W_OK):
                raise ValueError(f"Approved backup root is not readable and writable: {root}")

        effective_roots = roots or [request.backup_default_destination]
        if not any(
            self._inside(default_destination, self._resolve_user_path(root))
            or default_destination == self._resolve_user_path(root)
            for root in effective_roots
        ):
            raise ValueError(
                "Default backup destination must be inside an approved backup root"
            )

    def _warnings(self, request: LocalSettingsUpdate) -> list[str]:
        warnings: list[str] = []
        if not request.checklist_source_path:
            warnings.append("Google Drive checklist source is still not configured.")
        else:
            checklist = self._resolve_user_path(request.checklist_source_path)
            if not checklist.is_dir():
                warnings.append(
                    f"Checklist source does not currently exist or is not mounted: {checklist}"
                )
        return warnings

    def _resolve_user_path(self, value: str) -> Path:
        path = Path(value).expanduser()
        return path.resolve() if path.is_absolute() else (self.service_root / path).resolve()

    @staticmethod
    def _replace_env_values(text: str, updates: dict[str, str]) -> str:
        remaining = dict(updates)
        output: list[str] = []
        for line in text.splitlines():
            stripped = line.lstrip()
            if not stripped or stripped.startswith("#") or "=" not in line:
                output.append(line)
                continue
            key = line.split("=", 1)[0].strip()
            if key in remaining:
                output.append(f"{key}={LocalSettingsManager._quote(remaining.pop(key))}")
            else:
                output.append(line)
        if remaining:
            if output and output[-1] != "":
                output.append("")
            output.append("# Updated by the local InstaComp AI cockpit")
            for key, value in remaining.items():
                output.append(f"{key}={LocalSettingsManager._quote(value)}")
        return "\n".join(output).rstrip() + "\n"

    @staticmethod
    def _quote(value: str) -> str:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'

    @staticmethod
    def _inside(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False

    @staticmethod
    def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
        temporary = path.with_suffix(path.suffix + ".partial")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(temporary, path)
