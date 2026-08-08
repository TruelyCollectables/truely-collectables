from __future__ import annotations

import os
from typing import Any, Protocol

import httpx

from .models import CardIdentity, ChecklistOutcome, ChecklistResult


class ChecklistGateway(Protocol):
    async def match(
        self,
        identity: CardIdentity,
        ocr_text: str | None = None,
    ) -> ChecklistResult: ...

    async def health(self) -> bool: ...


def _text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _bounded_ocr(value: str | None) -> str | None:
    normalized = " ".join(str(value or "").replace("\x00", " ").split())
    return normalized[:12_000] or None


def _registry_base_url() -> str | None:
    value = os.getenv("INSTACOMP_AI_REGISTRY_URL", "").strip().rstrip("/")
    return value or None


def _registry_headers() -> dict[str, str]:
    headers = {
        "content-type": "application/json",
        "x-instacomp-client": "mac-mini-local-v1",
    }
    token = os.getenv("INSTACOMP_AI_REGISTRY_TOKEN", "").strip()
    if token:
        # Keep bearer support for seller-session compatibility while also sending
        # the dedicated internal-service header expected by the website route.
        headers["authorization"] = f"Bearer {token}"
        headers["x-tcos-instacomp-service-token"] = token
    return headers


class RegistryChecklistGateway:
    """Calls the website's authenticated Checklist Registry resolver.

    Trusted image memory and bounded OCR evidence run before the Ollama backup.
    Exact identity remains owned by the central Registry, and pricing stays
    blocked unless that resolver returns both an identity ID and fingerprint.
    """

    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self.timeout_seconds = timeout_seconds

    async def match(
        self,
        identity: CardIdentity,
        ocr_text: str | None = None,
    ) -> ChecklistResult:
        base_url = _registry_base_url()
        if not base_url:
            return ChecklistResult(
                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["INSTACOMP_AI_REGISTRY_URL is not configured."],
            )

        # The Registry may use bounded OCR to infer player/year/manufacturer,
        # but exact locking must also prove product-family/brand and set/subset.
        # Card number remains the minimum pre-query field so the server can load
        # a bounded candidate space without scanning the full Registry.
        if not identity.card_number:
            return ChecklistResult(
                outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                reasons=["Missing identity field: card_number"],
            )

        payload = {
            "year": identity.year,
            "manufacturer": identity.manufacturer,
            "brand": identity.brand,
            "setName": identity.set_name,
            "cardNumber": identity.card_number,
            "player": identity.player,
            "serialNumber": identity.serial_number,
            "isAuto": identity.autograph,
            "isRelic": identity.memorabilia,
            "parallel": identity.parallel,
            "variation": identity.variation,
            "ocrText": _bounded_ocr(ocr_text),
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    f"{base_url}/api/instacomp/checklist-lookup",
                    headers=_registry_headers(),
                    json=payload,
                )
        except httpx.HTTPError as error:
            return ChecklistResult(
                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=[f"Checklist Registry request failed: {error}"],
            )

        data = response.json() if response.content else {}
        if response.status_code in {401, 403}:
            return ChecklistResult(
                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["Checklist Registry authentication failed."],
            )
        if not response.is_success or data.get("ok") is not True:
            return ChecklistResult(
                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                reasons=[_text(data.get("error")) or "Checklist Registry lookup failed."],
            )

        status = _text(data.get("status"))
        registry_identity_id = _text(
            data.get("registryIdentityId") or data.get("identityId")
        )
        registry_fingerprint = _text(
            data.get("registryFingerprintSha256") or data.get("fingerprintSha256")
        )
        reasons = [str(value) for value in data.get("reasons", []) if value]
        candidate_count = int(data.get("candidateCount") or 0)

        if status == "exact_match" and registry_identity_id and registry_fingerprint:
            locked = data.get("lockedFields") or data.get("identity") or {}
            canonical = CardIdentity(
                sport=_text(locked.get("sport")) or identity.sport,
                league=_text(locked.get("league")) or identity.league,
                year=_text(locked.get("year")) or identity.year,
                manufacturer=_text(locked.get("manufacturer"))
                or identity.manufacturer,
                brand=_text(locked.get("brand")) or identity.brand,
                set_name=_text(locked.get("setName") or locked.get("set_name"))
                or identity.set_name,
                subset=_text(locked.get("subset")) or identity.subset,
                player=_text(locked.get("player")) or identity.player,
                team=_text(locked.get("team")) or identity.team,
                card_number=_text(
                    locked.get("cardNumber") or locked.get("card_number")
                )
                or identity.card_number,
                parallel=_text(locked.get("parallel")) or identity.parallel,
                variation=_text(locked.get("variation")) or identity.variation,
                serial_number=identity.serial_number,
                serial_run=identity.serial_run,
                rookie=identity.rookie,
                autograph=identity.autograph,
                inscription=identity.inscription,
                inscription_text=identity.inscription_text,
                memorabilia=identity.memorabilia,
                memorabilia_type=identity.memorabilia_type,
            )
            return ChecklistResult(
                outcome=ChecklistOutcome.EXACT_MATCH,
                identity_id=registry_identity_id,
                identity=canonical,
                candidate_count=max(candidate_count, 1),
                reasons=reasons,
                source_receipts=[
                    f"registry_identity:{registry_identity_id}",
                    f"registry_fingerprint:{registry_fingerprint}",
                ],
            )

        outcome = (
            ChecklistOutcome.SET_ABSENT
            if status in {"set_absent", "no_release_match"}
            else ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH
        )
        return ChecklistResult(
            outcome=outcome,
            candidate_count=candidate_count,
            reasons=reasons or ["Checklist Registry requires operator review."],
        )

    async def health(self) -> bool:
        return _registry_base_url() is not None


checklist_gateway: ChecklistGateway = RegistryChecklistGateway()
