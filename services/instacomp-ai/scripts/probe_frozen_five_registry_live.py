from __future__ import annotations

import asyncio
import os

from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import CardIdentity, ChecklistOutcome


CASES = [
    {
        "key": "sonia-122-base-from-real-bad-reader-payload",
        "identity": CardIdentity(
            year="2025",
            manufacturer=None,
            brand="Prizm",
            set_name="2025 Panini Prizm WNBA - Silver Prizms",
            card_number="22",
            player="Sonia Citron",
            team="Washington Mystics",
            sport="Basketball",
            league=None,
            parallel=None,
        ),
        "ocr": "SONIA CITRON ROOKIE PRIZ PRZN RC CARD 22 WASHINGTON MYSTICS",
        "uuid": "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
        "fingerprint": "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
        "card_number": "122",
        "parallel": "Base",
    },
    {
        "key": "malonga-116-ice",
        "identity": CardIdentity(
            year="2025",
            manufacturer="Panini",
            brand="Prizm",
            set_name="2025 Panini Prizm WNBA",
            card_number="116",
            player="Dominique Malonga",
            sport="Basketball",
            league="WNBA",
            parallel="Ice",
        ),
        "ocr": None,
        "uuid": "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
        "fingerprint": "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
        "card_number": "116",
        "parallel": "Ice",
    },
    {
        "key": "sonia-13-groovy-real-candidate-shape",
        "identity": CardIdentity(
            year="2025",
            manufacturer="Panini",
            brand="Prizm",
            set_name="Groovy",
            card_number="13",
            player="Sonia Citron",
            team="Washington Mystics",
            sport="Basketball",
            league="WNBA",
            parallel="Base",
        ),
        "ocr": "GROOVY SONIA CITRON No. 13 2025 PANINI - WNBA PRIZM BASKETBALL",
        "uuid": "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
        "fingerprint": "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad",
        "card_number": "13",
        "parallel": "Groovy",
    },
    {
        "key": "paige-5-ice",
        "identity": CardIdentity(
            year="2025",
            manufacturer="Panini",
            brand="Prizm",
            set_name="2025 Panini Prizm WNBA",
            card_number="5",
            player="Paige Bueckers",
            sport="Basketball",
            league="WNBA",
            parallel="Ice",
        ),
        "ocr": None,
        "uuid": "575556fe-fdd4-4083-baee-c5071ed3161f",
        "fingerprint": "66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42",
        "card_number": "5",
        "parallel": "Ice",
    },
    {
        "key": "rickea-118-base-from-actual-guarded-reader-payload",
        "identity": CardIdentity(
            year="2025",
            manufacturer="Panini",
            brand="Panini Prizm",
            set_name="2025 Panini Prizm WNBA - Green Prizms",
            card_number="118",
            player="Rickea Jackson",
            team=None,
            sport="Basketball",
            league=None,
            parallel=None,
        ),
        "ocr": "PANINI PRNINI PRIZN LOS SANGELES ANCELES RICKEA ACKSON LOS ANGELES SPARKS No. PRIZM 118 RICKEAJACKSON 2025 PANINI - WNBA PRIZM BASKETBALL WNBPA 2025",
        "uuid": "70ad307e-06bb-45c2-90ea-689b6e2f302e",
        "fingerprint": "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028",
        "card_number": "118",
        "parallel": "Base",
    },
]


def _require_live_configuration() -> None:
    base_url = (
        os.getenv("INSTACOMP_AI_REGISTRY_BASE_URL", "").strip()
        or os.getenv("INSTACOMP_AI_PRODUCTION_BASE_URL", "").strip()
    )
    service = os.getenv("INSTACOMP_AI_SERVICE_TOKEN", "").strip()
    sentinel = os.getenv("INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN", "").strip()
    if base_url != "https://truelycollectables.com":
        raise RuntimeError(f"Refusing non-canonical live Registry base URL: {base_url!r}")
    if not service and not sentinel:
        raise RuntimeError("No Production Registry credential is available to the live proof.")


async def main() -> None:
    _require_live_configuration()
    gateway = AuthoritativeRegistryChecklistGateway(
        timeout_seconds=20.0,
        max_attempts=3,
        retry_backoff_seconds=0.5,
    )

    total = 0
    retried = 0
    for round_number in range(1, 4):
        print(f"=== live Production Registry round {round_number}/3 ===")
        for case in CASES:
            result, diagnostics = await gateway.match_with_diagnostics(
                case["identity"],
                case["ocr"],
            )
            attempts = int(diagnostics.get("registry_attempts") or 0)
            if attempts > 1:
                retried += 1
            total += 1

            actual_fingerprint = diagnostics.get("registry_fingerprint_sha256")
            actual_card = result.identity.card_number if result.identity else None
            actual_parallel = result.identity.parallel if result.identity else None
            status = diagnostics.get("registry_http_status")
            reasons = diagnostics.get("registry_reasons") or result.reasons
            transport_errors = diagnostics.get("registry_transport_errors") or []

            print(
                "LIVE "
                f"round={round_number} case={case['key']} "
                f"outcome={result.outcome.value} http={status} attempts={attempts} "
                f"uuid={result.identity_id} card={actual_card} parallel={actual_parallel} "
                f"transport_errors={transport_errors!r} reasons={reasons!r}"
            )

            assert result.outcome == ChecklistOutcome.EXACT_MATCH, (
                f"{case['key']}: expected exact_match, got {result.outcome.value}; "
                f"http={status} attempts={attempts} reasons={reasons!r} "
                f"transport_errors={transport_errors!r}"
            )
            assert result.identity_id == case["uuid"], f"{case['key']}: UUID regression"
            assert actual_fingerprint == case["fingerprint"], f"{case['key']}: fingerprint regression"
            assert actual_card == case["card_number"], f"{case['key']}: card-number regression"
            assert actual_parallel == case["parallel"], f"{case['key']}: parallel regression"
            assert status == 200, f"{case['key']}: expected HTTP 200, got {status}"
            assert 1 <= attempts <= 3, f"{case['key']}: invalid gateway attempt count {attempts}"

    assert total == 15
    print(
        "PASS live Production Registry gateway resolved all five Frozen Five identities "
        f"exactly for 3 rounds / {total} calls; calls_requiring_transport_retry={retried}"
    )


if __name__ == "__main__":
    asyncio.run(main())
