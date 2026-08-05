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
    "local_cache_source_path": "INSTACOMP_AI_LOCAL_CACHE_SOURCE_PATH",
    "backup_default_destination": "INSTACOMP_AI_BACKUP_DEFAULT_DESTINATION",
    "backup_allowed_roots": "INSTACOMP_AI_BACKUP_ALLOWED_ROOTS",
    "ollama_model": "INSTACOMP_AI_OLLAMA_MODEL",
}
_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")


class LocalSettingsUpdate(BaseModel):
    local_cache_source_path: str = Field(default="", max_length=4096)
    backup_default_destination: str = Field(
        default="./backups",
        min_length=1,
        max_length=4096,
    )
    backup_allowed_roots: str = Field(default="", max_length=8192)
    ollama_model: str = Field(default="qwen2.5vl:7b", min_length=1, max_length=200)
    restart_service: bool = True

    @field_validator(
        "local_cache_source_path",
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
    def __init__(self, settings: Settings, service_root: Path | None = None) -> None:
        self.settings = settings
        self.service_root = (service_root or settings.service_root).resolve()
        self.env_path = self.service_root / ".env"
        self.receipt_root = self.service_root / "data" / "receipts" / "settings"

    def current(self) -> dict[str, Any]:
        cache_source = self._resolve_optional_path(self.settings.local_cache_source_path)
        default_backup = self._resolve_user_path(
            str(self.settings.backup_default_destination)
        )
        allowed_roots = self._configured_allowed_roots(
            self.settings.backup_allowed_roots,
            str(self.settings.backup_default_destination),
        )
        return {
            "schema": "tcos.instacomp-ai.local-settings.v2",
            "local_cache_source_path": str(cache_source) if cache_source else "",
            "local_cache_source_available": bool(
                cache_source and cache_source.is_dir()
            ),
            "local_cache_is_authoritative": False,
            "backup_default_destination": str(default_backup),
            "backup_allowed_roots": ",".join(str(path) for path in allowed_roots),
            "ollama_model": self.settings.ollama_model,
            "host": self.settings.host,
            "port": self.settings.port,
            "api_key_configured": bool(self.settings.api_key),
            "central_registry_configured": bool(
                os.getenv("INSTACOMP_AI_REGISTRY_URL", "").strip()
            ),
        }

    def save(self, request: LocalSettingsUpdate) -> dict[str, Any]:
        self.receipt_root.mkdir(parents=True, exist_ok=True)
        self._validate_paths(request)

        timestamp = datetime.now(timezone.utc)
        stamp = timestamp.strftime("%Y%m%dT%H%M%S.%fZ")
        previous_backup: Path | None = None
        if self.env_path.exists():
            previous_backup = self.receipt_root / f"env-before-{stamp}.backup"
            shutil.copy2(self.env_path, previous_backup)
            os.chmod(previous_backup, 0o600)

        updates = {
            _ENV_KEYS["local_cache_source_path"]: request.local_cache_source_path,
            _ENV_KEYS["backup_default_destination"]: request.backup_default_destination,
            _ENV_KEYS["backup_allowed_roots"]: request.backup_allowed_roots,
            _ENV_KEYS["ollama_model"]: request.ollama_model,
        }
        existing = self.env_path.read_text(encoding="utf-8") if self.env_path.exists() else ""
        updated_text = self._replace_env_values(existing, updates)
        temporary = self.env_path.with_name(f"{self.env_path.name}.partial")
        temporary.write_text(updated_text, encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.env_path)

        warnings = self._warnings(request)
        receipt = {
            "schema": "tcos.instacomp-ai.local-settings-change.v2",
            "created_at": timestamp.isoformat(),
            "changed_keys": sorted(updates),
            "previous_env_backup_created": previous_backup is not None,
            "restart_requested": request.restart_service,
            "warnings": warnings,
            "canonical_identity_authority": "central_checklist_registry",
        }
        receipt_path = self.receipt_root / f"settings-{stamp}.json"
        self._atomic_json(receipt_path, receipt)
        self._atomic_json(self.receipt_root / "latest.json", receipt)
        return {
            "ok": True,
            "restart_required": True,
            "restart_requested": request.restart_service,
            "receipt_created": True,
            "warnings": warnings,
        }

    def _validate_paths(self, request: LocalSettingsUpdate) -> None:
        default_destination = self._resolve_user_path(
            request.backup_default_destination
        )
        roots = self._configured_allowed_roots(
            request.backup_allowed_roots,
            request.backup_default_destination,
        )
        for path in [default_destination, *roots]:
            path.mkdir(parents=True, exist_ok=True)
            if not path.is_dir() or not os.access(path, os.R_OK | os.W_OK):
                raise ValueError(f"Backup path is not readable and writable: {path}")

        if not any(
            default_destination == root or self._inside(default_destination, root)
            for root in roots
        ):
            raise ValueError(
                "Default backup destination must be inside an approved backup root"
            )

        if request.local_cache_source_path:
            self._resolve_user_path(request.local_cache_source_path)

    def _warnings(self, request: LocalSettingsUpdate) -> list[str]:
        warnings: list[str] = []
        if not request.local_cache_source_path:
            warnings.append(
                "Optional local checklist cache source is not configured. "
                "Canonical identity still comes from the central Checklist Registry."
            )
        else:
            cache_source = self._resolve_user_path(request.local_cache_source_path)
            if not cache_source.is_dir():
                warnings.append(
                    "Local cache source does not currently exist or is not mounted."
                )
        return warnings

    def _configured_allowed_roots(
        self,
        configured: str,
        default_destination: str,
    ) -> list[Path]:
        roots = [
            self._resolve_user_path(value.strip())
            for value in configured.split(",")
            if value.strip()
        ]
        return roots or [self._resolve_user_path(default_destination)]

    def _resolve_optional_path(self, value: str) -> Path | None:
        normalized = value.strip()
        return self._resolve_user_path(normalized) if normalized else None

    def _resolve_user_path(self, value: str) -> Path:
        path = Path(value).expanduser()
        if path.is_absolute():
            return path.resolve()
        resolved = (self.service_root / path).resolve()
        if not self._inside(resolved, self.service_root) and resolved != self.service_root:
            raise ValueError("Relative paths may not escape the protected service folder")
        return resolved

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
            output.append("# Updated by the local InstaComp AI control console")
            for key, value in remaining.items():
                output.append(f"{key}={LocalSettingsManager._quote(value)}")
        return "\n".join(output).rstrip() + "\n"

    @staticmethod
    def _quote(value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ValueError("Environment values may not contain line breaks")
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
