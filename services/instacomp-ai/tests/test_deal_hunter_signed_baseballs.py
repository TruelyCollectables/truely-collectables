from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.deal_hunter import DealHunterScheduler
from app.deal_hunter_store import DealHunterStore


def _candidate(index: int, *, lane: str, price: float, title: str):
    return {
        "candidate_key": f"ebay:{index}",
        "lane": lane,
        "watched_person": "Jesus Made" if "signed" in lane else "Paige Bueckers",
        "marketplace": "eBay",
        "listing_item_id": str(index),
        "listing_url": f"https://www.ebay.com/itm/{index}",
        "title": title,
        "seller_name": "seller",
        "item_price": price,
        "inbound_shipping": 0.0,
        "buyer_fees": None,
        "tax": None,
        "image_urls": ["https://img.test/front.jpg", "https://img.test/back.jpg"],
        "manual_review_required": False,
        "preliminary_risks": [],
        "query_family_ids": [],
    }


def test_signed_baseballs_receive_reserved_evaluation_slots(tmp_path):
    settings = SimpleNamespace(
        deal_hunter_candidate_cooldown_hours=6,
        deal_hunter_max_candidates_per_run=20,
    )
    store = DealHunterStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    scheduler = DealHunterScheduler(settings, store)

    candidates = [
        _candidate(
            index,
            lane="broad_professional_rookies",
            price=float(index + 1),
            title=f"WNBA candidate {index}",
        )
        for index in range(30)
    ]
    candidates.extend(
        _candidate(
            100 + index,
            lane="signed_prospect_baseball",
            price=40.0 + index,
            title=f"Jesus Made signed baseball {index}",
        )
        for index in range(6)
    )

    selected, _deferred = scheduler._select_for_evaluation(candidates)
    signed = [row for row in selected if row["lane"] == "signed_prospect_baseball"]

    assert len(selected) == 20
    assert len(signed) == 5


@pytest.mark.asyncio
async def test_raw_official_mlb_ball_is_allowed_without_coa(tmp_path):
    scheduler = DealHunterScheduler(
        SimpleNamespace(),
        DealHunterStore(tmp_path / "instacomp.sqlite3"),
    )
    candidate = _candidate(
        200,
        lane="signed_prospect_baseball",
        price=25.0,
        title="Jesus Made Signed Rawlings Official Major League Baseball",
    )

    result = await scheduler._evaluate(candidate, "run-1")

    assert result["status"] == "manual_review"
    assert result["actionable"] is False
    assert result["alertworthy"] is True
    assert result["deal_label"] == "RAW OFFICIAL BALL — AUTHENTICATION UPSIDE"
    assert result["identity"]["authenticationRequired"] is False
    assert result["identity"]["officialMlbOrMilbBallClaimed"] is True
    assert result["identity"]["authenticationClaimed"] is False
    assert result["delivered_cost"] == 25.0


@pytest.mark.asyncio
async def test_cheap_raw_ball_without_official_marking_is_kept_for_photo_review(tmp_path):
    scheduler = DealHunterScheduler(
        SimpleNamespace(),
        DealHunterStore(tmp_path / "instacomp.sqlite3"),
    )
    candidate = _candidate(
        201,
        lane="signed_prospect_baseball",
        price=20.0,
        title="Jesus Made Signed Baseball No COA",
    )

    result = await scheduler._evaluate(candidate, "run-2")

    assert result["status"] == "manual_review"
    assert result["alertworthy"] is True
    assert result["deal_label"] == "SIGNED BALL — VERIFY OFFICIAL MLB/MILB BALL"
    assert result["error_code"] == "DEAL_HUNTER_OFFICIAL_BALL_REVIEW_REQUIRED"
    assert result["identity"]["authenticationRequired"] is False
