from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.deal_hunter import (
    FEEDS,
    DealHunterScheduler,
    DealHunterEbayRateLimited,
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

    store.create_run('run-2', 'manual')
    observed = {
        'candidate_key': 'ebay:123',
        'listing_url': 'https://www.ebay.com/itm/123',
        'title': 'Test card',
        'marketplace': 'eBay',
        'item_price': 9.0,
        'image_urls': ['a', 'b'],
        'query_family_ids': ['family-1'],
    }
    assert store.save_market_observations('run-1', [observed]) == 1
    assert store.save_market_observations('run-1', [observed]) == 0
    observed['item_price'] = 8.0
    assert store.save_market_observations('run-2', [observed]) == 1
    with store.connection() as db:
        rows = db.execute(
            'SELECT run_id, item_price FROM deal_hunter_market_observations '
            'WHERE candidate_key = ? ORDER BY observation_id',
            ('ebay:123',),
        ).fetchall()
    assert [(row['run_id'], row['item_price']) for row in rows] == [
        ('run-1', 9.0),
        ('run-2', 8.0),
    ]

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

    assert len(candidates) == len(FEEDS) - 1
    failed = [row for row in coverage if row["status"] == "FAILED"]
    assert len(failed) == 1
    assert failed[0]["key"] == "wnba"
    assert "simulated WNBA feed outage" in failed[0]["error"]
    assert len([row for row in coverage if row["status"] == "COMPLETE"]) == len(FEEDS) - 1


@pytest.mark.asyncio
async def test_rate_limit_short_circuits_remaining_ebay_feeds_but_keeps_public_lanes(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_site_url="https://example.test",
        deal_hunter_request_timeout_seconds=1.0,
        deal_hunter_per_query=1,
        deal_hunter_feed_pace_seconds=0.0,
    )
    scheduler = DealHunterScheduler(settings, DealHunterStore(tmp_path / "instacomp.sqlite3"))
    calls = []

    async def fake_fetch_feed(_client, key, _url, expected):
        calls.append(key)
        if key == "wnba":
            raise DealHunterEbayRateLimited("simulated eBay 429")
        return {
            "coverage": {
                "key": key,
                "status": "COMPLETE",
                "query_family_count": expected,
                "result_count": 0,
                "duration_ms": 1,
            },
            "results": [],
        }

    scheduler._fetch_feed = fake_fetch_feed  # type: ignore[method-assign]
    candidates, coverage = await scheduler._discover()

    assert candidates == []
    assert calls == ["wnba", "shoe_deals", "mercari_card_opportunities"]
    assert [(row["key"], row["status"]) for row in coverage] == [
        ("wnba", "FAILED_RATE_LIMIT"),
        ("baseball_prospects", "DEFERRED_RATE_LIMIT"),
        ("signed_baseballs", "DEFERRED_RATE_LIMIT"),
        ("music_comedy_autographs", "DEFERRED_RATE_LIMIT"),
        ("shoe_deals", "COMPLETE"),
        ("mercari_card_opportunities", "COMPLETE"),
    ]


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

@pytest.mark.asyncio
async def test_run_bridges_local_alertworthy_candidate_to_central_delivery(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_enabled=True,
        deal_hunter_interval_minutes=60,
        deal_hunter_candidate_cooldown_hours=6,
        deal_hunter_max_candidates_per_run=20,
    )
    store = DealHunterStore(tmp_path / "deal-hunter.sqlite3")
    store.initialize()
    scheduler = DealHunterScheduler(settings, store)

    candidate = {
        "candidate_key": "ebay:local-review-1",
        "listing_url": "https://www.ebay.com/itm/local-review-1",
        "title": "Local review candidate",
        "marketplace": "eBay",
        "item_price": 10.0,
        "image_urls": ["https://img.test/front.jpg"],
    }
    evaluated = {
        **candidate,
        "status": "manual_review",
        "deal_label": "MANUAL REVIEW REQUIRED — BACK IMAGE MISSING",
        "actionable": False,
        "alertworthy": True,
        "error_code": "DEAL_HUNTER_BACK_IMAGE_MISSING",
        "error_message": "The marketplace feed did not expose two distinct listing images.",
    }
    published: list[tuple[str, str]] = []

    async def discover():
        return [candidate], []

    async def evaluate(_candidate, _run_id):
        return evaluated

    async def publish_candidate(run_id, result):
        published.append((run_id, result["candidate_key"]))
        return {
            "ok": True,
            "persistence": {"delivery": {"status": "sent", "id": "email-test"}},
        }

    published_summary: dict = {}
    async def publish_summary(_run_id, _status, _counts, _summary):
        published_summary.update(_summary)

    scheduler._discover = discover  # type: ignore[method-assign]
    scheduler._evaluate = evaluate  # type: ignore[method-assign]
    scheduler._publish_candidate_alert = publish_candidate  # type: ignore[method-assign]
    scheduler._publish_run_summary = publish_summary  # type: ignore[method-assign]

    result = await scheduler.run_now(trigger="manual")

    assert result["status"] == "completed"
    assert len(result["review_items"]) == 1
    assert result["review_items"][0]["title"] == evaluated["title"]
    assert result["review_items"][0]["listing_url"] == evaluated["listing_url"]
    assert result["review_items"][0]["status"] == "manual_review"
    assert result["review_items"][0]["deal_label"] == evaluated["deal_label"]
    assert result["review_items"][0]["actionable"] is False
    assert result["top_opportunity_count"] == 1
    assert result["top_opportunities"][0]["candidate_key"] == "ebay:local-review-1"
    assert published_summary["review_items"] == result["review_items"]
    assert len(published) == 1
    assert published[0][1] == "ebay:local-review-1"
    assert result["alert_delivery"] == {
        "attempted": 1,
        "sent": 1,
        "duplicate_suppressed": 0,
        "skipped": 0,
        "failed": 0,
        "errors": [],
    }


@pytest.mark.asyncio
async def test_run_sends_top_five_opportunities_even_without_exact_actionable(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_enabled=True,
        deal_hunter_interval_minutes=60,
        deal_hunter_candidate_cooldown_hours=6,
        deal_hunter_max_candidates_per_run=10,
        deal_hunter_evaluation_concurrency=4,
    )
    store = DealHunterStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    scheduler = DealHunterScheduler(settings, store)
    published_summary = {}

    async def discover():
        return [
            {
                "candidate_key": f"mercari:m{index}",
                "listing_url": f"https://www.mercari.com/us/item/m{index}/",
                "marketplace": "Mercari",
                "lane": "broad_professional_rookies",
                "watched_person": "WNBA Rookie Deal Watch",
                "title": f"WNBA rookie base card lot {index}",
                "item_price": float(index + 1),
                "inbound_shipping": 0.99,
                "image_urls": ["front", "back"],
            }
            for index in range(7)
        ], []

    async def evaluate(candidate, _run_id):
        return {
            **candidate,
            "status": "completed",
            "actionable": False,
            "alertworthy": False,
            "deal_label": "SUPPRESSED - NO TRUSTED EXACT SOLD PRICE",
            "error_code": "DEAL_HUNTER_EXACT_SOLD_REQUIRED",
            "error_message": "Research lead only until exact sold evidence is proven.",
        }

    async def publish_summary(_run_id, _status, _counts, summary):
        published_summary.update(summary)

    scheduler._discover = discover  # type: ignore[method-assign]
    scheduler._evaluate = evaluate  # type: ignore[method-assign]
    scheduler._publish_run_summary = publish_summary  # type: ignore[method-assign]

    result = await scheduler.run_now(trigger="manual")

    assert result["actionable"] == 0
    assert result["top_opportunity_count"] == 5
    assert len(result["top_opportunities"]) == 5
    assert result["top_opportunities"][0]["marketplace"] == "Mercari"
    assert result["top_opportunities"][0]["error_code"] == "DEAL_HUNTER_EXACT_SOLD_REQUIRED"
    assert len(published_summary["top_opportunities"]) == 5


@pytest.mark.asyncio
async def test_run_does_not_bridge_candidate_already_delivered_by_central_evaluation(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_enabled=True,
        deal_hunter_interval_minutes=60,
        deal_hunter_candidate_cooldown_hours=6,
        deal_hunter_max_candidates_per_run=20,
    )
    store = DealHunterStore(tmp_path / "deal-hunter.sqlite3")
    store.initialize()
    scheduler = DealHunterScheduler(settings, store)

    candidate = {
        "candidate_key": "ebay:central-1",
        "listing_url": "https://www.ebay.com/itm/central-1",
        "title": "Central candidate",
        "marketplace": "eBay",
        "item_price": 10.0,
        "image_urls": ["front", "back"],
    }
    evaluated = {
        **candidate,
        "status": "completed",
        "deal_label": "MUST BUY",
        "actionable": True,
        "alertworthy": True,
        "central_delivery_handled": True,
    }

    async def discover():
        return [candidate], []

    async def evaluate(_candidate, _run_id):
        return evaluated

    async def should_not_publish(_run_id, _result):
        raise AssertionError("central-delivered candidate must not be re-published")

    async def publish_summary(_run_id, _status, _counts, _summary):
        return None

    scheduler._discover = discover  # type: ignore[method-assign]
    scheduler._evaluate = evaluate  # type: ignore[method-assign]
    scheduler._publish_candidate_alert = should_not_publish  # type: ignore[method-assign]
    scheduler._publish_run_summary = publish_summary  # type: ignore[method-assign]

    result = await scheduler.run_now(trigger="manual")
    assert result["actionable"] == 1
    assert result["alert_delivery"]["attempted"] == 0


def test_public_marketplace_feed_contract_is_accepted():
    payload = {
        "schema": "TCOS_PUBLIC_MARKETPLACE_FEED_V1",
        "ok": True,
        "publicWebSearchUsed": True,
        "providerMode": "openai_web_search",
        "queryFamilyCount": 2,
        "successfulQueryCount": 2,
        "failedQueryCount": 0,
        "sourceCoverage": [
            {"familyId": "mercari", "status": "COMPLETE"},
            {"familyId": "poshmark", "status": "COMPLETE"},
        ],
        "results": [],
    }
    validate_feed(payload, "shoe_deals", 2)


def test_candidate_key_is_marketplace_aware():
    assert candidate_key({"listingItemId": "m123", "marketplace": "Mercari"}) == "mercari:m123"
    assert candidate_key({"listingItemId": "123", "marketplace": "eBay"}) == "ebay:123"


def test_shoe_evaluation_enforces_saved_intake_limits(tmp_path: Path):
    scheduler = DealHunterScheduler(SimpleNamespace(), DealHunterStore(tmp_path / "deal-hunter.sqlite3"))
    base = {
        "candidate_key": "mercari:m123",
        "listing_url": "https://www.mercari.com/us/item/m123/",
        "marketplace": "Mercari",
        "lane": "shoe_deal",
        "title": "New Adidas men's size 10",
        "item_price": 20.0,
        "inbound_shipping": 5.0,
    }
    good = scheduler._evaluate_shoe(base)
    assert good["alertworthy"] is True
    assert good["status"] == "manual_review"

    boundary = scheduler._evaluate_shoe({**base, "item_price": 30.0})
    assert boundary["alertworthy"] is True

    overpriced = scheduler._evaluate_shoe({**base, "item_price": 30.01})
    assert overpriced["alertworthy"] is False
    assert overpriced["error_code"] == "DEAL_HUNTER_SHOE_PRICE_LIMIT"

    high_shipping = scheduler._evaluate_shoe({**base, "inbound_shipping": 16.0})
    assert high_shipping["alertworthy"] is False
    assert high_shipping["error_code"] == "DEAL_HUNTER_SHOE_SHIPPING_LIMIT"
