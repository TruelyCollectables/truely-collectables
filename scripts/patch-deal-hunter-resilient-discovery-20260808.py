from pathlib import Path

source = Path('services/instacomp-ai/app/deal_hunter.py')
tests = Path('services/instacomp-ai/tests/test_deal_hunter_scheduler.py')

text = source.read_text(encoding='utf-8')
old = '''        failures = []
        for outcome in outcomes:
            if isinstance(outcome, Exception):
                failures.append(str(outcome))
                continue
            coverage.append(outcome["coverage"])
            for raw in outcome["results"]:
                normalized = normalize_candidate(raw)
                if not normalized["listing_url"]:
                    continue
                key = normalized["candidate_key"]
                existing = aggregate.get(key)
                if existing:
                    existing["image_urls"] = list(
                        dict.fromkeys(existing["image_urls"] + normalized["image_urls"])
                    )[:12]
                    existing["query_family_ids"] = list(
                        dict.fromkeys(
                            existing["query_family_ids"] + normalized["query_family_ids"]
                        )
                    )
                    existing["manual_review_required"] = bool(
                        existing["manual_review_required"]
                        or normalized["manual_review_required"]
                    )
                    existing["preliminary_risks"] = list(
                        dict.fromkeys(
                            existing["preliminary_risks"]
                            + normalized["preliminary_risks"]
                        )
                    )
                else:
                    aggregate[key] = normalized

        if failures:
            raise RuntimeError("Deal Hunter discovery failed closed: " + " | ".join(failures))
        return list(aggregate.values()), coverage
'''
new = '''        failures = []
        healthy_feed_count = 0
        for index, outcome in enumerate(outcomes):
            feed_key, _path, expected_families = FEEDS[index]
            if isinstance(outcome, Exception):
                error = str(outcome)[:1000]
                failures.append(f"{feed_key}: {error}")
                coverage.append(
                    {
                        "key": feed_key,
                        "status": "FAILED",
                        "query_family_count": expected_families,
                        "result_count": 0,
                        "error": error,
                    }
                )
                continue

            healthy_feed_count += 1
            coverage.append(outcome["coverage"])
            for raw in outcome["results"]:
                normalized = normalize_candidate(raw)
                if not normalized["listing_url"]:
                    continue
                key = normalized["candidate_key"]
                existing = aggregate.get(key)
                if existing:
                    existing["image_urls"] = list(
                        dict.fromkeys(existing["image_urls"] + normalized["image_urls"])
                    )[:12]
                    existing["query_family_ids"] = list(
                        dict.fromkeys(
                            existing["query_family_ids"] + normalized["query_family_ids"]
                        )
                    )
                    existing["manual_review_required"] = bool(
                        existing["manual_review_required"]
                        or normalized["manual_review_required"]
                    )
                    existing["preliminary_risks"] = list(
                        dict.fromkeys(
                            existing["preliminary_risks"]
                            + normalized["preliminary_risks"]
                        )
                    )
                else:
                    aggregate[key] = normalized

        # Discovery resilience is deliberately separate from identity/pricing trust.
        # A broken feed must not blind every healthy hunting lane, but a total feed
        # outage remains fail-closed. Each degraded lane stays visible in coverage.
        if failures and healthy_feed_count == 0:
            raise RuntimeError(
                "All Deal Hunter discovery feeds failed closed: " + " | ".join(failures)
            )
        return list(aggregate.values()), coverage
'''
if old not in text:
    raise SystemExit('Expected Deal Hunter discovery block not found; refusing fuzzy patch.')
source.write_text(text.replace(old, new, 1), encoding='utf-8')

test_text = tests.read_text(encoding='utf-8')
test_text = test_text.replace(
    'from pathlib import Path\n',
    'from pathlib import Path\nfrom types import SimpleNamespace\n',
    1,
)
test_text = test_text.replace(
    'from app.deal_hunter import candidate_key, normalize_candidate, validate_feed\n',
    'from app.deal_hunter import (\n    DealHunterScheduler,\n    candidate_key,\n    normalize_candidate,\n    validate_feed,\n)\n',
    1,
)
addition = r'''

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
'''
if 'test_discovery_isolates_one_failed_feed_and_keeps_hunting' in test_text:
    raise SystemExit('Resilience tests already present; refusing duplicate patch.')
tests.write_text(test_text.rstrip() + addition + '\n', encoding='utf-8')

print('Deal Hunter resilient discovery patch applied.')
