from __future__ import annotations

import asyncio
from typing import Any

import httpx

from . import checklist as checklist_module
from .checklist import _bounded_ocr, _registry_base_url, _registry_headers, _text
from .models import CardIdentity, ChecklistOutcome, ChecklistResult
from .visible_identity_hint_guard import registry_product_line_hint_from_text


class AuthoritativeRegistryChecklistGateway:
    """Post-AI exact Registry lock using the same resolver as Production scan."""

    def __init__(
        self,
        timeout_seconds: float = 20.0,
        *,
        max_attempts: int = 3,
        retry_backoff_seconds: float = 0.5,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max(1, int(max_attempts))
        self.retry_backoff_seconds = max(0.0, float(retry_backoff_seconds))

    async def match(
        self,
        identity: CardIdentity,
        ocr_text: str | None = None,
    ) -> ChecklistResult:
        result, _diagnostics = await self.match_with_diagnostics(identity, ocr_text)
        return result

    async def match_with_diagnostics(
        self,
        identity: CardIdentity,
        ocr_text: str | None = None,
        *,
        registry_identity_id: str | None = None,
        registry_fingerprint_sha256: str | None = None,
    ) -> tuple[ChecklistResult, dict[str, Any]]:
        """Resolve with bounded transport retries and preserve the exact exchange.

        Registry lock is a read-only/idempotent identity lookup. A transient read
        timeout or connection reset must not turn one otherwise-valid card into a
        failed promotion. Only transport failures are retried; Registry responses
        themselves remain authoritative and fail closed exactly as before.

        When a trusted historical Registry UUID + fingerprint is supplied, the
        Production endpoint first revalidates that exact current Registry row
        against the visible identity evidence. If it is stale or incompatible,
        Production falls back to the normal exact resolver; the receipt itself can
        never manufacture a match.
        """
        base_url = _registry_base_url()
        diagnostics: dict[str, Any] = {
            "registry_url": (
                f"{base_url}/api/instacomp/registry-lock" if base_url else None
            ),
            "registry_request": None,
            "registry_http_status": None,
            "registry_raw_response": None,
            "registry_status": None,
            "registry_resolver_status": None,
            "registry_reasons": [],
            "registry_candidate_count": 0,
            "registry_identity_id": None,
            "registry_fingerprint_sha256": None,
            "registry_receipt_revalidation_requested": bool(
                registry_identity_id and registry_fingerprint_sha256
            ),
            "registry_receipt_revalidation_attempted": False,
            "registry_receipt_revalidation_accepted": False,
            "registry_transport_error": None,
            "registry_transport_errors": [],
            "registry_attempts": 0,
            "registry_max_attempts": self.max_attempts,
        }

        if not base_url:
            result = ChecklistResult(
                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["INSTACOMP_AI_REGISTRY_URL is not configured."],
            )
            return result, diagnostics
        if not identity.card_number:
            result = ChecklistResult(
                outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                reasons=["Missing identity field: card_number"],
            )
            return result, diagnostics

        bounded_ocr = _bounded_ocr(ocr_text)
        registry_set_hint = identity.set_name or registry_product_line_hint_from_text(
            bounded_ocr
        )
        payload: dict[str, Any] = {
            "year": identity.year,
            "manufacturer": identity.manufacturer,
            "brand": identity.brand,
            # Product-line OCR is query evidence only. It is never persisted as
            # local CardIdentity.set_name and cannot authorize pricing without a
            # unique current Registry UUID + fingerprint response.
            "setName": registry_set_hint,
            "subset": identity.subset,
            "cardNumber": identity.card_number,
            "player": identity.player,
            "team": identity.team,
            "sport": identity.sport,
            "league": identity.league,
            "serialNumber": identity.serial_number,
            "isAuto": identity.autograph,
            "isRelic": identity.memorabilia,
            "parallel": identity.parallel,
            "variation": identity.variation,
            "ocrText": bounded_ocr,
        }
        if registry_identity_id and registry_fingerprint_sha256:
            payload["registryIdentityId"] = str(registry_identity_id).strip()
            payload["registryFingerprintSha256"] = str(
                registry_fingerprint_sha256
            ).strip().lower()
        diagnostics["registry_request"] = payload

        response: httpx.Response | None = None
        for attempt in range(1, self.max_attempts + 1):
            diagnostics["registry_attempts"] = attempt
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.post(
                        f"{base_url}/api/instacomp/registry-lock",
                        headers=_registry_headers(),
                        json=payload,
                    )
                diagnostics["registry_transport_error"] = None
                break
            except httpx.TransportError as error:
                transport_error = f"{type(error).__name__}: {error}"
                diagnostics["registry_transport_error"] = transport_error
                diagnostics["registry_transport_errors"].append(transport_error)
                if attempt >= self.max_attempts:
                    result = ChecklistResult(
                        outcome=ChecklistOutcome.NOT_CONFIGURED,
                        reasons=[
                            "Checklist Registry request failed after "
                            f"{attempt} attempts: {error}"
                        ],
                    )
                    return result, diagnostics
                if self.retry_backoff_seconds:
                    await asyncio.sleep(self.retry_backoff_seconds * attempt)
            except httpx.HTTPError as error:
                diagnostics["registry_transport_error"] = (
                    f"{type(error).__name__}: {error}"
                )
                result = ChecklistResult(
                    outcome=ChecklistOutcome.NOT_CONFIGURED,
                    reasons=[f"Checklist Registry request failed: {error}"],
                )
                return result, diagnostics

        if response is None:
            result = ChecklistResult(
                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["Checklist Registry request produced no response."],
            )
            return result, diagnostics

        data = response.json() if response.content else {}
        diagnostics["registry_http_status"] = response.status_code
        diagnostics["registry_raw_response"] = data
        diagnostics["registry_status"] = _text(data.get("status"))
        diagnostics["registry_resolver_status"] = _text(data.get("resolverStatus"))
        diagnostics["registry_reasons"] = [
            str(value) for value in data.get("reasons", []) if value
        ]
        diagnostics["registry_candidate_count"] = int(data.get("candidateCount") or 0)
        diagnostics["registry_identity_id"] = _text(
            data.get("registryIdentityId") or data.get("identityId")
        )
        diagnostics["registry_fingerprint_sha256"] = _text(
            data.get("registryFingerprintSha256") or data.get("fingerprintSha256")
        )
        diagnostics["registry_receipt_revalidation_attempted"] = bool(
            data.get("receiptRevalidationAttempted")
        )
        diagnostics["registry_receipt_revalidation_accepted"] = bool(
            data.get("receiptRevalidationAccepted")
        )

        if response.status_code in {401, 403}:
            result = ChecklistResult(
                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["Checklist Registry authentication failed."],
            )
            return result, diagnostics
        if not response.is_success or data.get("ok") is not True:
            result = ChecklistResult(
                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                reasons=[
                    _text(data.get("error"))
                    or "Checklist Registry exact lock failed."
                ],
            )
            return result, diagnostics

        status = diagnostics["registry_status"]
        registry_identity_id = diagnostics["registry_identity_id"]
        registry_fingerprint = diagnostics["registry_fingerprint_sha256"]
        reasons = diagnostics["registry_reasons"]
        candidate_count = diagnostics["registry_candidate_count"]

        if status == "exact_match" and registry_identity_id and registry_fingerprint:
            locked = data.get("lockedFields") or {}
            canonical = CardIdentity(
                sport=_text(locked.get("sport")) or identity.sport,
                league=_text(locked.get("league")) or identity.league,
                year=_text(locked.get("year")) or identity.year,
                manufacturer=_text(locked.get("manufacturer"))
                or identity.manufacturer,
                brand=_text(locked.get("brand")) or identity.brand,
                set_name=_text(
                    locked.get("setName") or locked.get("set_name")
                )
                or identity.set_name,
                subset=identity.subset,
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
            result = ChecklistResult(
                outcome=ChecklistOutcome.EXACT_MATCH,
                identity_id=registry_identity_id,
                identity=canonical,
                candidate_count=max(candidate_count, 1),
                reasons=reasons,
                source_receipts=[
                    f"registry_identity:{registry_identity_id}",
                    f"registry_fingerprint:{registry_fingerprint}",
                    "registry_resolver:resolveChecklistRegistry",
                ],
            )
            return result, diagnostics

        if status == "input_incomplete":
            outcome = ChecklistOutcome.INPUT_INCOMPLETE
        elif status == "set_absent":
            outcome = ChecklistOutcome.SET_ABSENT
        elif status == "lookup_unavailable":
            outcome = ChecklistOutcome.NOT_CONFIGURED
        else:
            outcome = ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH

        result = ChecklistResult(
            outcome=outcome,
            candidate_count=candidate_count,
            reasons=reasons or ["Checklist Registry exact lock requires review."],
            source_receipts=["registry_resolver:resolveChecklistRegistry"],
        )
        return result, diagnostics

    async def health(self) -> bool:
        return _registry_base_url() is not None


def install_authoritative_registry_gateway() -> None:
    checklist_module.checklist_gateway = AuthoritativeRegistryChecklistGateway()
