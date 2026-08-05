from __future__ import annotations

from typing import Protocol

from .config import settings
from .models import CardIdentity, ChecklistResult
from .registry import SQLiteChecklistRegistry


class ChecklistGateway(Protocol):
    async def match(self, identity: CardIdentity) -> ChecklistResult: ...

    async def health(self) -> bool: ...


checklist_gateway: ChecklistGateway = SQLiteChecklistRegistry(
    settings.resolve_local_path(settings.registry_path)
)
