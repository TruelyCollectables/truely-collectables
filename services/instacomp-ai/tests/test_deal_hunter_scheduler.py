from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest

from app.deal_hunter import candidate_key, normalize_candidate, validate_feed
from app.deal_hunter_store import DealHunterStore, utc_now


def complete_feed(count: int):
    return {
        "schema": "TCOS_NATIVE_EBAY_FEED_V1",
        "ok": True,
        "nativeEbayUsed": True,
        "tokenMode": "client_credentials",
        "queryFamilyCount": count,
        "successfulQueryCount": count,
        "failedQueryCount": 0,
        "sourceCoverage": [
            {"familyId": f"family-{index}", "status": "COMPLETE"}
            for index in range(count)
        ],
        "results": [],
    }


def test_feed_contract_is_fail_closed():
    validate_feed(complete_feed(15), "wnba", 15)
    broken = complete_feed(15)
    broken["failedQueryCount"] = 1
    with pytest.raises(ValueError, match="feed contract failed"):
        validate_feed(broken, "wnba", 15)


def test_candidate_normalization_deduplicates_images():
    raw = {
        "listingItemId": "123",
        "listingUrl": "https://www.ebay.com/itm/123",
        "title": "Test card",
        "itemPrice": "12.50",
        "imageUrls": ["https://img.test/1.jpg", "https://img.test/1.jpg", "https://img.test/2.jpg"],
    }
    normalized = normalize_candidate(raw)
    assert candidate_key(raw) == "ebay:123"
    assert normalized["item_price"] == 12.5
    assert normalized["image_urls"] == [
        "https://img.test/1.jpg",
        "https://img.test/2.jpg",
    ]


def test_store_preserves_runs_candidates_and_cooldown(tmp_path: Path):
    store = DealHunterStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    store.configure(enabled=True, interval_minutes=60)
    store.create_run("run-1", "manual")
    store.mark_scheduler_started("run-1", utc_now() + timedelta(hours=1))
    store.save_candidate(
        "run-1",
        {
            "candidate_key": "ebay:123",
            "listing_url": "https://www.ebay.com/itm/123",
            "title": "Test card",
            "image_urls": ["a", "b"],
            "item_price": 10.0,
            "status": "completed",
            "deal_label": "MUST BUY",
            "actionable": True,
            "alertworthy": True,
            "roi_percent": 35.0,
        },
    )
    store.finish_run(
        run_id="run-1",
        status="completed",
        discovery_count=1,
        evaluated_count=1,
        actionable_count=1,
        manual_review_count=0,
        failure_count=0,
        summary={"ok": True},
    )
    store.mark_scheduler_finished(
        status="completed",
        next_run_at=utc_now() + timedelta(hours=1),
    )

    runs = store.recent_runs()
    candidates = store.recent_candidates(actionable_only=True)
    history = store.candidate_history(["ebay:123"])["ebay:123"]

    assert runs[0]["run_id"] == "run-1"
    assert candidates[0]["deal_label"] == "MUST BUY"
    assert candidates[0]["actionable"] is True
    assert DealHunterStore.is_cooling_down(
        history,
        current_price=10.0,
        cooldown_hours=6,
    )
    assert not DealHunterStore.is_cooling_down(
        history,
        current_price=9.0,
        cooldown_hours=6,
    )
