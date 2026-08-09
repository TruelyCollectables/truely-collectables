from __future__ import annotations

from app import sentinel_sources
from app.psa_policy import install_psa_lead_only_policy


PSA_URL = "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090"
TOPPS_URL = "https://www.topps.com/checklists/example.pdf"


def test_psa_is_high_trust_but_never_auto_imported() -> None:
    install_psa_lead_only_policy()
    assert sentinel_sources.candidate_trust(PSA_URL) == (96, "lead_only")
    psa = next(source for source in sentinel_sources.DEFAULT_SOURCES if source["source_id"] == "psa")
    assert psa["trust_score"] == 96
    assert psa["import_policy"] == "lead_only"


def test_non_psa_auto_import_policy_is_unchanged() -> None:
    install_psa_lead_only_policy()
    assert sentinel_sources.candidate_trust(TOPPS_URL) == (100, "auto_import")


def test_policy_install_is_idempotent() -> None:
    install_psa_lead_only_policy()
    first = sentinel_sources.candidate_trust
    install_psa_lead_only_policy()
    assert sentinel_sources.candidate_trust is first
