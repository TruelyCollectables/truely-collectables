#!/usr/bin/env python3
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import train_lora_from_unseen_benchmarks_v3 as v3
from app.models import CardIdentity, ChecklistOutcome

OBSERVED_ROW_ID = "00b8493f-9e86-4609-ade8-7978cbb6e1aa"
OBSERVED_ABSENT_REASON = "trusted_holdout_player_card_absent_from_active_registry"


def _wanted() -> dict[str, Any]:
    return {
        "row_id": OBSERVED_ROW_ID,
        "registry_identity_id": "00000000-0000-4000-8000-000000000001",
        "registry_fingerprint_sha256": "a" * 64,
        "source_benchmark": "/tmp/unseen-holdout-20260820T025713Z.json",
        "card_uuid": "card-1",
        "expected_identity": {
            "sport": "Hockey",
            "year": "2025",
            "brand": "Upper Deck",
            "set_name": "Base",
            "player": "Observed Failure Player",
            "card_number": "77",
            "parallel": "Base",
        },
    }


async def _observed_failure_is_quarantined() -> None:
    original_canonical = v3.v2._canonical_revalidate
    original_bootstrap = v3.v2._player_card_bootstrap

    async def fake_canonical(*_args: Any, **_kwargs: Any):
        return (
            SimpleNamespace(outcome=ChecklistOutcome.INPUT_INCOMPLETE, identity=None),
            {
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": False,
                "registry_identity_id": None,
                "registry_fingerprint_sha256": None,
                "registry_attempts": 1,
            },
        )

    async def fake_bootstrap(**_kwargs: Any):
        return None, OBSERVED_ABSENT_REASON

    v3.v2._canonical_revalidate = fake_canonical
    v3.v2._player_card_bootstrap = fake_bootstrap
    try:
        example = SimpleNamespace(
            training_example_id=OBSERVED_ROW_ID,
            confirmed_identity=CardIdentity(player="stale", card_number="77"),
        )
        try:
            await v3._revalidate_one(
                row_id=OBSERVED_ROW_ID,
                wanted=_wanted(),
                example=example,
                semaphore=asyncio.Semaphore(1),
            )
        except v3.CurriculumUnverifiable as exc:
            text = str(exc)
            assert "input_incomplete" in text
            assert OBSERVED_ABSENT_REASON in text
        else:
            raise AssertionError("Observed input_incomplete + active-Registry-absent row must quarantine")
    finally:
        v3.v2._canonical_revalidate = original_canonical
        v3.v2._player_card_bootstrap = original_bootstrap


async def _real_uuid_contradiction_is_fatal() -> None:
    original_canonical = v3.v2._canonical_revalidate
    original_bootstrap = v3.v2._player_card_bootstrap
    bootstrap_called = False

    async def fake_canonical(*_args: Any, **_kwargs: Any):
        return (
            SimpleNamespace(outcome=ChecklistOutcome.INPUT_INCOMPLETE, identity=None),
            {
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": False,
                "registry_identity_id": "00000000-0000-4000-8000-000000000099",
                "registry_fingerprint_sha256": "a" * 64,
                "registry_attempts": 1,
            },
        )

    async def fake_bootstrap(**_kwargs: Any):
        nonlocal bootstrap_called
        bootstrap_called = True
        return None, "should_not_run"

    v3.v2._canonical_revalidate = fake_canonical
    v3.v2._player_card_bootstrap = fake_bootstrap
    try:
        example = SimpleNamespace(
            training_example_id="contradiction",
            confirmed_identity=CardIdentity(player="truth", card_number="77"),
        )
        try:
            await v3._revalidate_one(
                row_id="contradiction",
                wanted={**_wanted(), "row_id": "contradiction"},
                example=example,
                semaphore=asyncio.Semaphore(1),
            )
        except RuntimeError as exc:
            assert "Registry UUID changed" in str(exc)
        else:
            raise AssertionError("Current Registry UUID contradiction must remain fatal")
        assert bootstrap_called is False
    finally:
        v3.v2._canonical_revalidate = original_canonical
        v3.v2._player_card_bootstrap = original_bootstrap


def _ephemeral_label_override_does_not_mutate_store_object() -> None:
    original_overrides = dict(v3._LABEL_OVERRIDES)
    registry_id = "00000000-0000-4000-8000-000000000001"
    fingerprint = "a" * 64
    original = SimpleNamespace(
        training_example_id="row-label",
        confirmed_identity=CardIdentity(player="Stale Local Label", card_number="77"),
        registry_identity_id=None,
        registry_fingerprint_sha256=None,
        local_vision=None,
        predicted_identity=None,
    )
    v3._LABEL_OVERRIDES = {
        "row-label": {
            "identity": {
                "sport": "Basketball",
                "year": "2025",
                "brand": "Prizm",
                "set_name": "Base",
                "player": "Canonical Registry Label",
                "card_number": "77",
                "parallel": "Base",
            },
            "registry_identity_id": registry_id,
            "registry_fingerprint_sha256": fingerprint,
        }
    }

    def fake_dataset_row(example: Any, *, image_store_path: Path) -> dict[str, Any]:
        assert image_store_path == Path("/tmp/images")
        return {
            "player": example.confirmed_identity.player,
            "registry_identity_id": example.registry_identity_id,
            "registry_fingerprint_sha256": example.registry_fingerprint_sha256,
        }

    try:
        row = v3._dataset_row(
            original,
            image_store_path=Path("/tmp/images"),
            source_fn=fake_dataset_row,
        )
        assert row["player"] == "Canonical Registry Label"
        assert row["registry_identity_id"] == registry_id
        assert row["registry_fingerprint_sha256"] == fingerprint
        assert original.confirmed_identity.player == "Stale Local Label"
        assert original.registry_identity_id is None
        assert original.registry_fingerprint_sha256 is None
    finally:
        v3._LABEL_OVERRIDES = original_overrides


def main() -> int:
    asyncio.run(_observed_failure_is_quarantined())
    asyncio.run(_real_uuid_contradiction_is_fatal())
    _ephemeral_label_override_does_not_mutate_store_object()
    print("PASS exact 2026-08-20 curriculum failure is quarantined instead of killing generation")
    print("PASS real current Registry UUID contradiction remains fatal before fallback")
    print("PASS canonical forced-row label override is ephemeral and does not mutate stored truth")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
