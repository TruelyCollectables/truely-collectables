import pytest

from app.sentinel_sources import (
    AUTO_IMPORT_DOMAINS,
    DEFAULT_SOURCES,
    LEAD_ONLY_DOMAINS,
    SentinelSourceClient,
    _canonical_psa_apr_url,
    _is_psa_exact_release_url,
    _is_psa_set_apr_url,
)


def source(source_id: str):
    return next(row for row in DEFAULT_SOURCES if row["source_id"] == source_id)


def target():
    return {
        "target_key": "basketball|2010-11|panini|threads",
        "sport": "basketball",
        "year": 2010,
        "season": "2010-11",
        "manufacturer": "panini",
        "product": "threads",
        "scope": "mainstream-gap",
    }


def test_psa_is_high_trust_first_party_verification_before_serp():
    assert AUTO_IMPORT_DOMAINS["psacard.com"] == 96
    assert source("psa")["import_policy"] == "lead_only"
    assert source("psa")["kind"] == "psa_first_party"
    assert source("psa")["search_url_template"] == (
        "https://www.psacard.com/auctionprices/search?q={query}"
    )


def test_psa_only_set_level_apr_urls_are_eligible_and_locale_safe():
    assert _is_psa_set_apr_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090"
    )
    assert _is_psa_set_apr_url(
        "https://www.psacard.com/en-CA/auctionprices/basketball-cards/2010-panini-elite-black-box/101090"
    )
    assert not _is_psa_set_apr_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/lebron-james/3231185"
    )
    assert not _is_psa_set_apr_url("https://www.psacard.com/cert/85165699/psa")
    assert _canonical_psa_apr_url(
        "https://www.psacard.com/en-CA/auctionprices/basketball-cards/2010-panini-threads/99999?page=2"
    ) == "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/99999"


def test_psa_exact_release_url_rejects_subset_pages_and_accepts_locale_prefix():
    assert _is_psa_exact_release_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/99999",
        target(),
    )
    assert _is_psa_exact_release_url(
        "https://www.psacard.com/en-CA/auctionprices/basketball-cards/2010-panini-threads/99999",
        target(),
    )
    assert not _is_psa_exact_release_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads-triple-threat/99998",
        target(),
    )
    assert not _is_psa_exact_release_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads-team-threads-away/99997",
        target(),
    )


def test_psa_query_uses_first_year_without_serp_syntax():
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    query = client._query(source("psa"), target())
    assert query == "2010 panini threads basketball"
    assert "2010-11" not in query
    assert "site:" not in query
    assert "Auction Prices Realized" not in query
    assert "spreadsheet OR PDF" not in query


def test_psa_html_candidates_drop_card_and_subset_pages_keep_exact_release_as_lead():
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    html = """
    <a href="https://www.psacard.com/en-CA/auctionprices/basketball-cards/2010-panini-threads/99999">2010 Panini Threads</a>
    <a href="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads-triple-threat/99998">2010 Panini Threads Triple Threat</a>
    <a href="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/lebron-james/3231185">2010 Panini Threads LeBron James</a>
    <a href="https://www.psacard.com/cert/85165699/psa">2010 Panini Threads PSA cert</a>
    """
    rows = client._html_candidates(source("psa"), target(), html, "https://www.psacard.com/auctionprices/search?q=x")
    assert len(rows) == 1
    assert rows[0].url == "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/99999"
    assert rows[0].exact_match is True
    assert rows[0].import_policy == "lead_only"
    assert rows[0].trust_score == 96


class FakeResponse:
    def __init__(self, url: str, text: str):
        self.url = url
        self.text = text

    def raise_for_status(self):
        return None


class FakeAsyncClient:
    calls: list[str] = []
    direct_html = ""
    bing_html = ""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str):
        self.calls.append(url)
        if url.startswith("https://www.psacard.com/auctionprices/search"):
            return FakeResponse(url, self.direct_html)
        return FakeResponse(url, self.bing_html)


@pytest.mark.asyncio
async def test_psa_search_uses_first_party_and_skips_bing_when_exact_set_is_found(monkeypatch):
    FakeAsyncClient.calls = []
    FakeAsyncClient.direct_html = (
        '<a href="/en-CA/auctionprices/basketball-cards/2010-panini-threads/99999">'
        "2010 Panini Threads</a>"
    )
    FakeAsyncClient.bing_html = ""
    monkeypatch.setattr("app.sentinel_sources.httpx.AsyncClient", FakeAsyncClient)
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    rows = await client.search(source("psa"), target())
    assert len(rows) == 1
    assert len(FakeAsyncClient.calls) == 1
    assert FakeAsyncClient.calls[0].startswith(
        "https://www.psacard.com/auctionprices/search?q=2010+panini+threads+basketball"
    )


@pytest.mark.asyncio
async def test_psa_search_falls_back_to_bing_only_when_direct_has_no_exact_release(monkeypatch):
    FakeAsyncClient.calls = []
    FakeAsyncClient.direct_html = (
        '<a href="/auctionprices/basketball-cards/2010-panini-threads-triple-threat/99998">'
        "2010 Panini Threads Triple Threat</a>"
    )
    FakeAsyncClient.bing_html = (
        '<a href="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/99999">'
        "2010 Panini Threads</a>"
    )
    monkeypatch.setattr("app.sentinel_sources.httpx.AsyncClient", FakeAsyncClient)
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    rows = await client.search(source("psa"), target())
    assert len(rows) == 1
    assert len(FakeAsyncClient.calls) == 2
    assert FakeAsyncClient.calls[0].startswith("https://www.psacard.com/auctionprices/search")
    assert FakeAsyncClient.calls[1].startswith("https://www.bing.com/search?q=")
    assert "site%3Apsacard.com" in FakeAsyncClient.calls[1]


def test_sgc_stays_discovery_only_until_completeness_is_certified():
    assert LEAD_ONLY_DOMAINS["gosgc.com"] == 70
    assert source("sgc")["import_policy"] == "lead_only"
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    query = client._query(source("sgc"), target())
    assert query.startswith("site:gosgc.com 2010 panini threads basketball")
    assert "2010-11" not in query
    assert "Pop Report" in query
