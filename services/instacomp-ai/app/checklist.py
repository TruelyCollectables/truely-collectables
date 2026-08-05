from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .models import CardIdentity, ChecklistResult
from .registry import SQLiteChecklistRegistry


class ChecklistGateway(Protocol):
    async def match(self, identity: CardIdentity) -> ChecklistResult: ...

    async def health(self) -> bool: ...


SERVICE_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = SERVICE_ROOT / "data" / "registry" / "checklist-registry.sqlite3"

checklist_gateway: ChecklistGateway = SQLiteChecklistRegistry(REGISTRY_PATH)
