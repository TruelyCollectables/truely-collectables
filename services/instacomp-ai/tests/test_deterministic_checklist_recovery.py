from __future__ import annotations

import asyncio

from app import runtime_compat
from app.deterministic_checklist_recovery import (
    beckett_candidate_urls,
    install_deterministic_checklist_recovery,
)
from app.sentinel_sources import SentinelSourceClient


def test_beckett_candidates_cover_normal_old_release() -> None:
    urls = beckett_candidate_urls(
        {
            "scope": "exact",
            "season": "2010",
            "sport": "football",
            "manufacturer": "panini",
            "product": "certified",
        }
    )
    assert urls[0] == "https://www.beckett.com/news/2010-panini-certified-football-cards/"
    assert "https://www.beckett.com/news/2010-certified-football-cards/" in urls


def test_beckett_candidates_add_old_slug_aliases() -> None:
    urls = beckett_candidate_urls(
        {
            "scope": "exact",
            "season": "2009",
            "sport": "baseball",
            "manufacturer": "topps",
            "product": "update-set",
        }
    )
    assert "https://www.beckett.com/news/2009-topps-update-series-baseball-cards/" in urls


def test_discovery_scope_does_not_get_deterministic_auto_import_candidates() -> None:
    assert (
        beckett_candidate_urls(
            {
                "scope": "discovery",
                "season": "2010",
                "sport": "football",
                "manufacturer": "panini",
                "product": "certified",
            }
        )
        == ()
    )


def test_deterministic_beckett_search_is_exact_and_capture_scoped() -> None:
    install_deterministic_checklist_recovery()
    client = SentinelSourceClient(timeout_seconds=5.0, max_download_bytes=5_000_000)
    source = {
        "source_id": "beckett",
        "name": "Beckett",
        "kind": "site_search",
        "trust_score": 90,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["beckett.com", "www.beckett.com"],
    }
    target = {
        "target_key": "football|2010|panini|certified",
        "scope": "exact",
        "sport": "football",
        "season": "2010",
        "year": 2010,
        "manufacturer": "panini",
        "product": "certified",
    }
    candidates = asyncio.run(client.search(source, target))
    assert candidates
    assert candidates[0].url == "https://www.beckett.com/news/2010-panini-certified-football-cards/"
    assert all(candidate.exact_match for candidate in candidates)
    assert all(candidate.import_policy == "auto_import" for candidate in candidates)
    assert all(candidate.trust_score == 90 for candidate in candidates)
    assert runtime_compat._is_verified_checklist_page_url(candidates[0].url) is True
