from __future__ import annotations

import httpx

from . import checklist as checklist_module
from .checklist import _bounded_ocr, _registry_base_url, _registry_headers, _text
from .models import CardIdentity, ChecklistOutcome, ChecklistResult


class AuthoritativeRegistryChecklistGateway:
    """Post-AI exact Registry lock using the same resolver as Production scan."""

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
            "ocrText": _bounded_ocr(ocr_text),
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    f"{base_url}/api/instacomp/registry-lock",
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
                reasons=[_text(data.get("error")) or "Checklist Registry exact lock failed."],
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
            locked = data.get("lockedFields") or {}
            canonical = CardIdentity(
                sport=_text(locked.get("sport")) or identity.sport,
                league=_text(locked.get("league")) or identity.league,
                year=_text(locked.get("year")) or identity.year,
                manufacturer=_text(locked.get("manufacturer")) or identity.manufacturer,
                brand=_text(locked.get("brand")) or identity.brand,
                set_name=_text(locked.get("setName") or locked.get("set_name")) or identity.set_name,
                subset=identity.subset,
                player=_text(locked.get("player")) or identity.player,
                team=_text(locked.get("team")) or identity.team,
                card_number=_text(locked.get("cardNumber") or locked.get("card_number")) or identity.card_number,
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
                    "registry_resolver:resolveChecklistRegistry",
                ],
            )

        if status == "input_incomplete":
            outcome = ChecklistOutcome.INPUT_INCOMPLETE
        elif status == "set_absent":
            outcome = ChecklistOutcome.SET_ABSENT
        elif status == "lookup_unavailable":
            outcome = ChecklistOutcome.NOT_CONFIGURED
        else:
            outcome = ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH
        return ChecklistResult(
            outcome=outcome,
            candidate_count=candidate_count,
            reasons=reasons or ["Checklist Registry exact lock requires review."],
            source_receipts=["registry_resolver:resolveChecklistRegistry"],
        )

    async def health(self) -> bool:
        return _registry_base_url() is not None


def install_authoritative_registry_gateway() -> None:
    checklist_module.checklist_gateway = AuthoritativeRegistryChecklistGateway()
