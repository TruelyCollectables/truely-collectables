from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.deal_hunter import (
    DealHunterScheduler,
    candidate_key,
    normalize_candidate,
    validate_feed,
)
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

@pytest.mark.asyncio
async def test_discovery_isolates_one_failed_feed_and_keeps_hunting(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_site_url="https://example.test",
        deal_hunter_request_timeout_seconds=1.0,
        deal_hunter_per_query=1,
    )
    scheduler = DealHunterScheduler(
        settings,
        DealHunterStore(tmp_path / "instacomp.sqlite3"),
    )

    async def fake_fetch_feed(_client, key, _url, expected):
        if key == "wnba":
            raise RuntimeError("simulated WNBA feed outage")
        return {
            "coverage": {
                "key": key,
                "status": "COMPLETE",
                "query_family_count": expected,
                "result_count": 1,
                "duration_ms": 1,
            },
            "results": [
                {
                    "listingItemId": f"{key}-1",
                    "listingUrl": f"https://www.ebay.com/itm/{key}-1",
                    "title": f"{key} candidate",
                    "itemPrice": 10,
                    "imageUrls": ["https://img.test/front.jpg", "https://img.test/back.jpg"],
                }
            ],
        }

    scheduler._fetch_feed = fake_fetch_feed  # type: ignore[method-assign]
    candidates, coverage = await scheduler._discover()

    assert len(candidates) == 5
    failed = [row for row in coverage if row["status"] == "FAILED"]
    assert len(failed) == 1
    assert failed[0]["key"] == "wnba"
    assert "simulated WNBA feed outage" in failed[0]["error"]
    assert len([row for row in coverage if row["status"] == "COMPLETE"]) == 5


@pytest.mark.asyncio
async def test_discovery_still_fails_closed_when_every_feed_is_down(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_site_url="https://example.test",
        deal_hunter_request_timeout_seconds=1.0,
        deal_hunter_per_query=1,
    )
    scheduler = DealHunterScheduler(
        settings,
        DealHunterStore(tmp_path / "instacomp.sqlite3"),
    )

    async def fail_every_feed(_client, key, _url, _expected):
        raise RuntimeError(f"{key} unavailable")

    scheduler._fetch_feed = fail_every_feed  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="All Deal Hunter discovery feeds failed closed"):
        await scheduler._discover()

@pytest.mark.asyncio
async def test_run_preserves_start_based_next_run_for_overdue_catchup(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_enabled=True,
        deal_hunter_interval_minutes=60,
        deal_hunter_candidate_cooldown_hours=6,
        deal_hunter_max_candidates_per_run=20,
    )
    store = DealHunterStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    scheduler = DealHunterScheduler(settings, store)
    scheduled_next = utc_now() + timedelta(minutes=60)
    next_run_calls = 0

    def fixed_next_run(_from_time=None):
        nonlocal next_run_calls
        next_run_calls += 1
        return scheduled_next

    async def no_candidates():
        return [], []

    async def no_publish(_run_id, _status, _counts, _summary):
        return None

    scheduler.next_run = fixed_next_run  # type: ignore[method-assign]
    scheduler._discover = no_candidates  # type: ignore[method-assign]
    scheduler._publish_run_summary = no_publish  # type: ignore[method-assign]

    result = await scheduler.run_now(trigger="manual")
    state = store.scheduler_state()

    assert result["status"] == "completed"
    assert next_run_calls == 1
    assert state["next_run_at"] == scheduled_next.isoformat()
