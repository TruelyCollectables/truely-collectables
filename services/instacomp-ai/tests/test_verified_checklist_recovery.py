from __future__ import annotations

import asyncio

import httpx

from app.runtime_compat import (
    _is_verified_checklist_page_url,
    _verified_page_http_error_requires_browser_render,
    _verified_page_requires_browser_render,
    install_sentinel_runtime_compat,
)
from app.sentinel_sources import DownloadedFile, SentinelSourceClient
from app.verified_checklist_sources import (
    verified_checklist_source_count,
    verified_checklist_sources_for_target,
    verified_checklist_target_count,
)


TOPPS_TARGET = "baseball|2024|topps|series-1"
TOPPS_URL = "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2401-2024ToppsSeries1BBChecklistV1.pdf"
BECKETT_TARGET = "football|2024|panini|prizm"
BECKETT_URL = "https://www.beckett.com/news/2024-panini-prizm-football-cards/"


def _downloaded(url: str, content: bytes, content_type: str = "text/html") -> DownloadedFile:
    return DownloadedFile(
        url=url,
        content=content,
        content_type=content_type,
        sha256="0" * 64,
        extension=".html",
    )


def _status_error(url: str, status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", url)
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(
        f"HTTP {status_code}",
        request=request,
        response=response,
    )


def test_verified_index_contains_official_topps_pdf() -> None:
    sources = verified_checklist_sources_for_target(TOPPS_TARGET)
    assert len(sources) == 1
    source = sources[0]
    assert source.source_id == "topps"
    assert source.trust_score == 100
    assert source.url == TOPPS_URL
    assert "Official Topps" in source.provenance


def test_verified_index_contains_full_beckett_page() -> None:
    sources = verified_checklist_sources_for_target(BECKETT_TARGET)
    assert len(sources) == 1
    source = sources[0]
    assert source.source_id == "beckett"
    assert source.trust_score == 90
    assert source.url == BECKETT_URL
    assert "Full Beckett" in source.provenance


def test_verified_index_unknown_target_fails_closed() -> None:
    assert verified_checklist_sources_for_target("baseball|2099|fake|not-real") == ()
    assert verified_checklist_source_count() >= 70
    assert verified_checklist_target_count() >= 70


def test_only_exact_allowlisted_page_urls_can_use_browser_capture() -> None:
    assert _is_verified_checklist_page_url(BECKETT_URL) is True
    assert _is_verified_checklist_page_url(TOPPS_URL) is False
    assert _is_verified_checklist_page_url("https://www.beckett.com/news/not-verified/") is False


def test_verified_page_403_can_fall_back_to_browser_capture() -> None:
    assert (
        _verified_page_http_error_requires_browser_render(
            BECKETT_URL,
            _status_error(BECKETT_URL, 403),
        )
        is True
    )
    assert (
        _verified_page_http_error_requires_browser_render(
            "https://www.beckett.com/news/not-verified/",
            _status_error("https://www.beckett.com/news/not-verified/", 403),
        )
        is False
    )
    assert (
        _verified_page_http_error_requires_browser_render(
            BECKETT_URL,
            _status_error(BECKETT_URL, 404),
        )
        is False
    )


def test_verified_page_thin_or_blocked_html_requires_browser_capture() -> None:
    assert _verified_page_requires_browser_render(
        _downloaded(BECKETT_URL, b"<html>Just a moment... checklist</html>")
    ) is True
    healthy = b"<html><body><h1>2024 Panini Prizm Football Checklist</h1>" + b"card row " * 1000 + b"</body></html>"
    assert _verified_page_requires_browser_render(_downloaded(BECKETT_URL, healthy)) is False


def test_verified_search_short_circuits_serp_for_exact_target() -> None:
    install_sentinel_runtime_compat()
    client = SentinelSourceClient(timeout_seconds=5.0, max_download_bytes=5_000_000)
    source = {
        "source_id": "topps",
        "name": "Topps official",
        "kind": "site_search",
        "trust_score": 100,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["topps.com", "www.topps.com"],
    }
    target = {
        "target_key": TOPPS_TARGET,
        "scope": "exact",
        "sport": "baseball",
        "season": "2024",
        "year": 2024,
        "manufacturer": "topps",
        "product": "series-1",
    }
    candidates = asyncio.run(client.search(source, target))
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.url == TOPPS_URL
    assert candidate.exact_match is True
    assert candidate.import_policy == "auto_import"
    assert candidate.trust_score == 100
    assert "Manually verified exact checklist source" in candidate.reason
