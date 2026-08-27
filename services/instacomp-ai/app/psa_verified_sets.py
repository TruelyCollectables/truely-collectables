from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VerifiedPsaSet:
    target_key: str
    title: str
    url: str
    verified_on: str


# First-party PSA APR whole-release pages that have been independently verified
# to match the exact Sentinel target identity. These entries are discovery hints
# only: Sentinel still downloads the live PSA page and Registry validation must
# succeed before a target can become `recovered`.
VERIFIED_PSA_SETS: dict[str, VerifiedPsaSet] = {
    "basketball|2008-09|upper-deck|upper-deck": VerifiedPsaSet(
        target_key="basketball|2008-09|upper-deck|upper-deck",
        title="2008 Upper Deck",
        url="https://www.psacard.com/auctionprices/basketball-cards/2008-upper-deck/83744",
        verified_on="2026-08-09",
    ),
    "basketball|2009-10|topps|topps": VerifiedPsaSet(
        target_key="basketball|2009-10|topps|topps",
        title="2009 Topps",
        url="https://www.psacard.com/auctionprices/basketball-cards/2009-topps/89284",
        verified_on="2026-08-09",
    ),
    "basketball|2010-11|donruss|donruss": VerifiedPsaSet(
        target_key="basketball|2010-11|donruss|donruss",
        title="2010 Donruss",
        url="https://www.psacard.com/auctionprices/basketball-cards/2010-donruss/96707",
        verified_on="2026-08-09",
    ),
    "basketball|2010-11|panini|elite-black-box": VerifiedPsaSet(
        target_key="basketball|2010-11|panini|elite-black-box",
        title="2010 Panini Elite Black Box",
        url="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090",
        verified_on="2026-08-09",
    ),
    "basketball|2010-11|panini|prestige": VerifiedPsaSet(
        target_key="basketball|2010-11|panini|prestige",
        title="2010 Panini Prestige",
        url="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-prestige/95363",
        verified_on="2026-08-09",
    ),
    "basketball|2011|upper-deck|all-time-greats": VerifiedPsaSet(
        target_key="basketball|2011|upper-deck|all-time-greats",
        title="2011 Upper Deck All-Time Greats",
        url="https://www.psacard.com/auctionprices/basketball-cards/2011-upper-deck-all-time-greats/100822",
        verified_on="2026-08-09",
    ),
}


def verified_psa_set_for_target(target_key: str | None) -> VerifiedPsaSet | None:
    return VERIFIED_PSA_SETS.get(str(target_key or "").strip())
