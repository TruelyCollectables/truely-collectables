from __future__ import annotations

from typing import Protocol
from .models import CardIdentity, ChecklistOutcome, ChecklistResult


class ChecklistGateway(Protocol):
    async def match(self, identity: CardIdentity) -> ChecklistResult: ...

    async def health(self) -> bool: ...


class UnconfiguredChecklistGateway:
    """Deliberate stop point before real checklist ingestion."""

    async def match(self, identity: CardIdentity) -> ChecklistResult:
        missing = [
            name
            for name, value in {
                "year": identity.year,
                "set_name": identity.set_name,
                "player": identity.player,
                "card_number": identity.card_number,
            }.items()
            if not value
        ]
        if missing:
            return ChecklistResult(
                outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                reasons=[f"Missing identity fields: {', '.join(missing)}"],
            )
        return ChecklistResult(
            outcome=ChecklistOutcome.NOT_CONFIGURED,
            reasons=[
                "The scanner foundation is complete, but no checklist registry has been wired yet."
            ],
        )

    async def health(self) -> bool:
        return False


checklist_gateway: ChecklistGateway = UnconfiguredChecklistGateway()
