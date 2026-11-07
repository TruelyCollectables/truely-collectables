from __future__ import annotations

import json

import httpx
import pytest

from app import authoritative_registry_gateway as gateway_module
from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import CardIdentity, ChecklistOutcome


class _InstantExactClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        request = httpx.Request("POST", url)
        payload = {
            "ok": True,
            "registryLock": True,
            "resolverStatus": "internal_exact_match",
            "status": "exact_match",
            "reasons": ["bounded_direct_registry_exact_recovery"],
            "candidateCount": 1,
            "registryIdentityId": "11111111-1111-4111-8111-111111111111",
            "registryFingerprintSha256": "a" * 64,
            "lockedFields": {
                "sport": "Basketball",
                "league": "WNBA",
                "year": "2024",
                "manufacturer": "Panini",
                "brand": "Panini Instant",
                "setName": "Panini Instant WNBA",
                "player": "Caitlin Clark",
                "team": "Indiana Fever",
                "cardNumber": "198",
                "parallel": "Base",
                "variation": None,
                "serialRun": None,
                "isAuto": False,
                "isRelic": False,
            },
        }
        return httpx.Response(
            200,
            content=globals()["json"].dumps(payload).encode("utf-8"),
            request=request,
        )


@pytest.mark.asyncio
async def test_registry_exact_lock_clears_instant_print_run_from_serial_fields(monkeypatch):
    monkeypatch.setattr(
        gateway_module,
        "_registry_base_url",
        lambda: "https://registry.example",
    )
    monkeypatch.setattr(gateway_module, "_registry_headers", lambda: {})
    monkeypatch.setattr(gateway_module.httpx, "AsyncClient", _InstantExactClient)

    gateway = AuthoritativeRegistryChecklistGateway(retry_backoff_seconds=0)
    result, diagnostics = await gateway.match_with_diagnostics(
        CardIdentity(
            sport="Basketball",
            year="2024",
            manufacturer="Panini",
            player="Caitlin Clark",
            card_number="198",
            serial_number="1/15219",
            serial_run=15219,
            autograph=False,
            memorabilia=False,
        ),
        "No. 198 CAITLIN CLARK 1 of 15219 2024-25 PANINI - INSTANT WNBA BASKETBALL",
    )

    assert result.outcome == ChecklistOutcome.EXACT_MATCH
    assert result.identity is not None
    assert result.identity.card_number == "198"
    assert result.identity.set_name == "Panini Instant WNBA"
    assert result.identity.serial_number is None
    assert result.identity.serial_run is None
    assert result.identity.autograph is False
    assert result.identity.memorabilia is False
    assert diagnostics["registry_status"] == "exact_match"
