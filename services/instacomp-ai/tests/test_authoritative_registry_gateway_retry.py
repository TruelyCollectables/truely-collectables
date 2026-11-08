from __future__ import annotations

import json

import httpx
import pytest

from app import authoritative_registry_gateway as gateway_module
from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import CardIdentity, ChecklistOutcome


GROOVY_UUID = "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044"
GROOVY_FP = "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad"


def _response_payload() -> dict:
    return {
        "ok": True,
        "registryLock": True,
        "resolver": "resolveChecklistRegistry",
        "resolverStatus": "internal_exact_match",
        "status": "exact_match",
        "reasons": ["one_internal_checklist_identity_matches_all_available_visible_evidence"],
        "candidateCount": 1,
        "registryIdentityId": GROOVY_UUID,
        "registryFingerprintSha256": GROOVY_FP,
        "lockedFields": {
            "sport": "Basketball",
            "league": "WNBA",
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Prizm",
            "setName": "Groovy",
            "player": "Sonia Citron",
            "team": "Washington Mystics",
            "cardNumber": "13",
            "parallel": "Groovy",
            "variation": None,
            "serialRun": None,
            "isAuto": False,
            "isRelic": False,
        },
    }


class _TimeoutThenSuccessClient:
    attempts = 0

    def __init__(self, *args, **kwargs):
        self.timeout = kwargs.get("timeout")

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        type(self).attempts += 1
        request = httpx.Request("POST", url)
        if type(self).attempts == 1:
            raise httpx.ReadTimeout("fixture timeout", request=request)
        return httpx.Response(
            200,
            content=globals()["json"].dumps(_response_payload()).encode("utf-8"),
            request=request,
        )


@pytest.mark.asyncio
async def test_read_timeout_retries_then_returns_exact_groovy_lock(monkeypatch) -> None:
    _TimeoutThenSuccessClient.attempts = 0
    monkeypatch.setattr(gateway_module, "_registry_base_url", lambda: "https://registry.example")
    monkeypatch.setattr(gateway_module, "_registry_headers", lambda: {"Authorization": "fixture"})
    monkeypatch.setattr(gateway_module.httpx, "AsyncClient", _TimeoutThenSuccessClient)

    gateway = AuthoritativeRegistryChecklistGateway(
        timeout_seconds=0.01,
        max_attempts=3,
        retry_backoff_seconds=0,
    )
    result, diagnostics = await gateway.match_with_diagnostics(
        CardIdentity(
            sport="Basketball",
            year="2025",
            manufacturer="Panini",
            brand="Panini Prizm WNBA",
            set_name="Groovy",
            player="Sonia Citron",
            team="Washington Mystics",
            card_number="13",
            parallel="Base",
        ),
        "GROOVY SONIA CITRON No. 13 2025 PANINI - WNBA PRIZM BASKETBALL",
    )

    assert result.outcome == ChecklistOutcome.EXACT_MATCH
    assert result.identity_id == GROOVY_UUID
    assert result.identity is not None
    assert result.identity.card_number == "13"
    assert result.identity.parallel == "Groovy"
    assert diagnostics["registry_http_status"] == 200
    assert diagnostics["registry_attempts"] == 2
    assert diagnostics["registry_transport_errors"] == ["ReadTimeout: fixture timeout"]
    assert diagnostics["registry_transport_error"] is None


class _AlwaysTimeoutClient(_TimeoutThenSuccessClient):
    attempts = 0

    async def post(self, url, *, headers, json):
        type(self).attempts += 1
        request = httpx.Request("POST", url)
        raise httpx.ReadTimeout("still unavailable", request=request)


@pytest.mark.asyncio
async def test_exhausted_transport_retries_fail_closed_with_attempt_receipt(monkeypatch) -> None:
    _AlwaysTimeoutClient.attempts = 0
    monkeypatch.setattr(gateway_module, "_registry_base_url", lambda: "https://registry.example")
    monkeypatch.setattr(gateway_module, "_registry_headers", lambda: {})
    monkeypatch.setattr(gateway_module.httpx, "AsyncClient", _AlwaysTimeoutClient)

    gateway = AuthoritativeRegistryChecklistGateway(
        timeout_seconds=0.01,
        max_attempts=3,
        retry_backoff_seconds=0,
    )
    result, diagnostics = await gateway.match_with_diagnostics(
        CardIdentity(player="Sonia Citron", card_number="13"),
        None,
    )

    assert result.outcome == ChecklistOutcome.NOT_CONFIGURED
    assert diagnostics["registry_attempts"] == 3
    assert diagnostics["registry_transport_error"] == "ReadTimeout: still unavailable"
    assert diagnostics["registry_transport_errors"] == [
        "ReadTimeout: still unavailable",
        "ReadTimeout: still unavailable",
        "ReadTimeout: still unavailable",
    ]
