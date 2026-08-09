import pytest

from app.psa_verified_sets import VERIFIED_PSA_SETS, verified_psa_set_for_target
from app.sentinel_sources import DEFAULT_SOURCES, SentinelSourceClient


CANARY_KEYS = [
    "basketball|2008-09|upper-deck|upper-deck",
    "basketball|2009-10|topps|topps",
    "basketball|2010-11|donruss|donruss",
    "basketball|2010-11|panini|elite-black-box",
    "basketball|2010-11|panini|prestige",
    "basketball|2011|upper-deck|all-time-greats",
]


def psa_source():
    return next(row for row in DEFAULT_SOURCES if row["source_id"] == "psa")


def target_for(key: str):
    sport, season, manufacturer, product = key.split("|", 3)
    return {
        "target_key": key,
        "sport": sport,
        "year": int(season[:4]),
        "season": season,
        "manufacturer": manufacturer.replace("-", " "),
        "product": product.replace("-", " "),
        "scope": "mainstream-gap",
    }


def test_verified_psa_index_contains_exact_canary_whole_release_pages():
    assert set(CANARY_KEYS).issubset(VERIFIED_PSA_SETS)
    for key in CANARY_KEYS:
        row = verified_psa_set_for_target(key)
        assert row is not None
        assert row.target_key == key
        assert row.url.startswith("https://www.psacard.com/auctionprices/basketball-cards/")
        assert row.url.rsplit("/", 1)[-1].isdigit()


@pytest.mark.asyncio
async def test_psa_verified_index_returns_candidate_without_search_http(monkeypatch):
    class ExplodingAsyncClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("verified PSA target must not need search HTTP")

    monkeypatch.setattr("app.sentinel_sources.httpx.AsyncClient", ExplodingAsyncClient)
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    rows = await client.search(
        psa_source(),
        target_for("basketball|2010-11|panini|prestige"),
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.url == "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-prestige/95363"
    assert row.source_id == "psa"
    assert row.trust_score == 96
    assert row.import_policy == "auto_import"
    assert row.exact_match is True
    assert "verified PSA whole-release index" in row.reason


@pytest.mark.asyncio
async def test_unknown_psa_target_still_uses_dynamic_search(monkeypatch):
    calls = []

    class FakeResponse:
        url = "https://www.psacard.com/auctionprices/search?q=unknown"
        text = ""
        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return False
        async def get(self, url):
            calls.append(url)
            return FakeResponse()

    monkeypatch.setattr("app.sentinel_sources.httpx.AsyncClient", FakeAsyncClient)
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    rows = await client.search(
        psa_source(),
        target_for("basketball|2015-16|panini|totally-certified"),
    )
    assert rows == []
    assert calls
    assert calls[0].startswith("https://www.psacard.com/auctionprices/search")
