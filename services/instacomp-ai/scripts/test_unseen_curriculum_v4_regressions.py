#!/usr/bin/env python3
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import train_lora_from_unseen_benchmarks_v4 as v4
from app.models import CardIdentity, ChecklistOutcome

ROW_ID = "232c2cdf-61bf-45a9-93a9-f2586b26c508"
OLD_UUID = "b00121db-a36d-4350-aed5-8f6fd5b5b1cf"
OLD_FP = "b72cf17187db8f9c006c3274405d2daf5363c226e9f4253db6a52b69bb923e2d"
CURRENT_UUID = "a82860a8-1e28-4599-81ec-5af50e1fac4d"
CURRENT_FP = "c13fc274630371b64e06dbe0a06d2df7023af0f64b39ed83d2214602c674784d"


def wanted() -> dict[str, Any]:
    return {
        "row_id": ROW_ID,
        "registry_identity_id": OLD_UUID,
        "registry_fingerprint_sha256": OLD_FP,
        "source_benchmark": "/tmp/unseen-holdout-20260820T025713Z.json",
        "card_uuid": "pius-suter-physical-card",
        "expected_identity": {
            "sport": "Hockey",
            "league": "NHL",
            "year": "2021-22",
            "manufacturer": "Upper Deck",
            "brand": "Credentials",
            "set_name": "2020-21 Update - Debut Ticket Access",
            "player": "Pius Suter",
            "team": "Chicago Blackhawks",
            "card_number": "138",
            "parallel": "Base",
            "autograph": False,
            "memorabilia": False,
        },
    }


async def exact_pius_supersession_quarantines() -> None:
    original_canonical = v4.v3.v2._canonical_revalidate
    original_bootstrap = v4.v3.v2._player_card_bootstrap
    calls: list[str] = []

    async def fake_canonical(_gateway: Any, identity: Any, *, expected_registry: str, expected_fingerprint: str):
        calls.append(expected_registry)
        if expected_registry == OLD_UUID:
            return (
                SimpleNamespace(outcome=ChecklistOutcome.EXACT_MATCH, identity=identity),
                {
                    "registry_receipt_revalidation_attempted": True,
                    "registry_receipt_revalidation_accepted": False,
                    "registry_identity_id": CURRENT_UUID,
                    "registry_fingerprint_sha256": CURRENT_FP,
                    "registry_attempts": 1,
                },
            )
        assert expected_registry == CURRENT_UUID
        assert expected_fingerprint == CURRENT_FP
        return (
            SimpleNamespace(outcome=ChecklistOutcome.EXACT_MATCH, identity=identity),
            {
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": True,
                "registry_identity_id": CURRENT_UUID,
                "registry_fingerprint_sha256": CURRENT_FP,
                "registry_attempts": 1,
            },
        )

    async def fake_bootstrap(**_kwargs: Any):
        return (
            SimpleNamespace(
                registry_id=CURRENT_UUID,
                fingerprint=CURRENT_FP,
                identity=CardIdentity.model_validate(wanted()["expected_identity"]),
            ),
            "strict_release_evidence",
        )

    v4.v3.v2._canonical_revalidate = fake_canonical
    v4.v3.v2._player_card_bootstrap = fake_bootstrap
    try:
        example = SimpleNamespace(
            training_example_id=ROW_ID,
            confirmed_identity=CardIdentity(player="Pius Suter", card_number="138"),
        )
        try:
            await v4._revalidate_one(
                row_id=ROW_ID,
                wanted=wanted(),
                example=example,
                semaphore=asyncio.Semaphore(1),
            )
        except v4.HistoricalBenchmarkSuperseded as exc:
            text = str(exc)
            assert OLD_UUID in text
            assert CURRENT_UUID in text
        else:
            raise AssertionError("Exact Pius Suter old->current Registry UUID supersession must quarantine")
        assert calls == [OLD_UUID, CURRENT_UUID]
    finally:
        v4.v3.v2._canonical_revalidate = original_canonical
        v4.v3.v2._player_card_bootstrap = original_bootstrap


async def current_current_contradiction_is_fatal() -> None:
    original_canonical = v4.v3.v2._canonical_revalidate
    original_bootstrap = v4.v3.v2._player_card_bootstrap

    async def fake_canonical(_gateway: Any, identity: Any, *, expected_registry: str, expected_fingerprint: str):
        if expected_registry == OLD_UUID:
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
        return (
            SimpleNamespace(outcome=ChecklistOutcome.EXACT_MATCH, identity=identity),
            {
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": False,
                "registry_identity_id": "00000000-0000-4000-8000-000000000099",
                "registry_fingerprint_sha256": CURRENT_FP,
                "registry_attempts": 1,
            },
        )

    async def fake_bootstrap(**_kwargs: Any):
        return (
            SimpleNamespace(
                registry_id=CURRENT_UUID,
                fingerprint=CURRENT_FP,
                identity=CardIdentity.model_validate(wanted()["expected_identity"]),
            ),
            "strict_release_evidence",
        )

    v4.v3.v2._canonical_revalidate = fake_canonical
    v4.v3.v2._player_card_bootstrap = fake_bootstrap
    try:
        example = SimpleNamespace(
            training_example_id="current-current-conflict",
            confirmed_identity=CardIdentity(player="Pius Suter", card_number="138"),
        )
        try:
            await v4._revalidate_one(
                row_id="current-current-conflict",
                wanted=wanted(),
                example=example,
                semaphore=asyncio.Semaphore(1),
            )
        except RuntimeError as exc:
            assert "inconsistent current Registry resolution" in str(exc)
        else:
            raise AssertionError("Current bootstrap/canonical contradiction must hard fail")
    finally:
        v4.v3.v2._canonical_revalidate = original_canonical
        v4.v3.v2._player_card_bootstrap = original_bootstrap


def stale_local_receipt_is_not_authority() -> None:
    example = SimpleNamespace(
        registry_identity_id=CURRENT_UUID,
        registry_fingerprint_sha256=CURRENT_FP,
    )
    actual = v4._historical_local_receipt_nonfatal(example, wanted())
    assert actual == (CURRENT_UUID, CURRENT_FP)


def main() -> int:
    asyncio.run(exact_pius_supersession_quarantines())
    asyncio.run(current_current_contradiction_is_fatal())
    stale_local_receipt_is_not_authority()
    print("PASS exact Pius Suter benchmark UUID supersession is quarantined after current canonical revalidation")
    print("PASS contradiction between indexed current truth and canonical current truth remains fatal")
    print("PASS stale local Registry receipt cannot override live current Registry admission")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
