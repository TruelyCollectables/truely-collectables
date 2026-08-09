from app.sentinel_sources import (
    AUTO_IMPORT_DOMAINS,
    DEFAULT_SOURCES,
    LEAD_ONLY_DOMAINS,
    SentinelSourceClient,
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


def test_psa_is_high_trust_but_only_set_level_apr_urls_are_eligible():
    assert AUTO_IMPORT_DOMAINS["psacard.com"] == 96
    assert source("psa")["import_policy"] == "auto_import"
    assert _is_psa_set_apr_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090"
    )
    assert not _is_psa_set_apr_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/lebron-james/3231185"
    )
    assert not _is_psa_set_apr_url("https://www.psacard.com/cert/85165699/psa")


def test_psa_exact_release_url_rejects_subset_pages():
    assert _is_psa_exact_release_url(
        "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/99999",
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


def test_psa_query_uses_first_year_and_targets_items_in_set():
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    query = client._query(source("psa"), target())
    assert query.startswith("site:psacard.com 2010 panini threads basketball")
    assert "2010-11" not in query
    assert "Auction Prices Realized" in query
    assert "Items in Set" in query
    assert "spreadsheet OR PDF" not in query


def test_psa_html_candidates_drop_card_and_subset_pages_keep_exact_release():
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    html = """
    <a href="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/99999">2010 Panini Threads</a>
    <a href="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads-triple-threat/99998">2010 Panini Threads Triple Threat</a>
    <a href="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-threads/lebron-james/3231185">2010 Panini Threads LeBron James</a>
    <a href="https://www.psacard.com/cert/85165699/psa">2010 Panini Threads PSA cert</a>
    """
    rows = client._html_candidates(source("psa"), target(), html, "https://www.bing.com/search?q=x")
    assert len(rows) == 1
    assert rows[0].url.endswith("/2010-panini-threads/99999")
    assert rows[0].exact_match is True
    assert rows[0].import_policy == "auto_import"
    assert rows[0].trust_score == 96


def test_sgc_stays_discovery_only_until_completeness_is_certified():
    assert LEAD_ONLY_DOMAINS["gosgc.com"] == 70
    assert source("sgc")["import_policy"] == "lead_only"
    client = SentinelSourceClient(timeout_seconds=5, max_download_bytes=1_000_000)
    query = client._query(source("sgc"), target())
    assert query.startswith("site:gosgc.com 2010 panini threads basketball")
    assert "2010-11" not in query
    assert "Pop Report" in query
