#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SENTINEL_SOURCES = ROOT / "services/instacomp-ai/app/sentinel_sources.py"
PSA_TESTS = ROOT / "services/instacomp-ai/tests/test_sentinel_psa_sources.py"
PSA_ADAPTER = ROOT / "src/lib/checklist-registry/psa-apr-html.ts"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


OLD_PSA_SOURCE = '''    {
        "source_id": "psa",
        "name": "PSA Auction Prices Realized set index",
        "kind": "site_search",
        "trust_score": 96,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["psacard.com", "www.psacard.com"],
    },
'''

NEW_PSA_SOURCE = '''    {
        "source_id": "psa",
        "name": "PSA Auction Prices Realized first-party",
        "kind": "psa_first_party",
        "trust_score": 96,
        "import_policy": "auto_import",
        "search_url_template": "https://www.psacard.com/auctionprices/search?q={query}",
        "domains": ["psacard.com", "www.psacard.com"],
    },
'''

replace_once(SENTINEL_SOURCES, OLD_PSA_SOURCE, NEW_PSA_SOURCE, "PSA first-party source")

OLD_PSA_URL_HELPERS = '''def _is_psa_set_apr_url(url: str) -> bool:
    parsed = urlparse(url)
    if (parsed.hostname or "").lower() not in {"psacard.com", "www.psacard.com"}:
        return False
    parts = [part for part in parsed.path.split("/") if part]
    # Set-level APR: /auctionprices/<category>/<set-slug>/<numeric-set-id>
    return (
        len(parts) == 4
        and parts[0].lower() == "auctionprices"
        and parts[3].isdigit()
    )


def _psa_expected_release_slug(target: dict[str, Any]) -> str:
    year = str(target.get("year") or "").strip()
    manufacturer_tokens = normalize_text(target.get("manufacturer")).split()
    product_tokens = normalize_text(target.get("product")).split()
    if manufacturer_tokens and product_tokens[: len(manufacturer_tokens)] == manufacturer_tokens:
        product_tokens = product_tokens[len(manufacturer_tokens) :]
    if product_tokens == manufacturer_tokens:
        product_tokens = []
    pieces = [year, *manufacturer_tokens, *product_tokens]
    return "-".join(piece for piece in pieces if piece)


def _is_psa_exact_release_url(url: str, target: dict[str, Any]) -> bool:
    if not _is_psa_set_apr_url(url):
        return False
    parts = [part for part in urlparse(url).path.split("/") if part]
    expected = _psa_expected_release_slug(target)
    return bool(expected and parts[2].lower() == expected)
'''

NEW_PSA_URL_HELPERS = '''def _psa_path_parts(url: str) -> list[str]:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    if parts and re.fullmatch(r"[a-z]{2}(?:-[a-z]{2})?", parts[0], flags=re.IGNORECASE):
        parts = parts[1:]
    return parts


def _canonical_psa_apr_url(url: str) -> str:
    parsed = urlparse(url)
    if (parsed.hostname or "").lower() not in {"psacard.com", "www.psacard.com"}:
        return url
    parts = _psa_path_parts(url)
    if not parts or parts[0].lower() != "auctionprices":
        return url
    canonical_path = "/" + "/".join(parts)
    return parsed._replace(
        scheme="https",
        netloc="www.psacard.com",
        path=canonical_path,
        params="",
        query="",
        fragment="",
    ).geturl()


def _is_psa_set_apr_url(url: str) -> bool:
    parsed = urlparse(url)
    if (parsed.hostname or "").lower() not in {"psacard.com", "www.psacard.com"}:
        return False
    parts = _psa_path_parts(url)
    # Set-level APR: /auctionprices/<category>/<set-slug>/<numeric-set-id>
    # PSA may prefix locale paths such as /en-CA/; those are canonicalized away.
    return (
        len(parts) == 4
        and parts[0].lower() == "auctionprices"
        and parts[3].isdigit()
    )


def _psa_expected_release_slug(target: dict[str, Any]) -> str:
    year = str(target.get("year") or "").strip()
    manufacturer_tokens = normalize_text(target.get("manufacturer")).split()
    product_tokens = normalize_text(target.get("product")).split()
    if manufacturer_tokens and product_tokens[: len(manufacturer_tokens)] == manufacturer_tokens:
        product_tokens = product_tokens[len(manufacturer_tokens) :]
    if product_tokens == manufacturer_tokens:
        product_tokens = []
    pieces = [year, *manufacturer_tokens, *product_tokens]
    return "-".join(piece for piece in pieces if piece)


def _is_psa_exact_release_url(url: str, target: dict[str, Any]) -> bool:
    if not _is_psa_set_apr_url(url):
        return False
    parts = _psa_path_parts(url)
    expected = _psa_expected_release_slug(target)
    return bool(expected and parts[2].lower() == expected)
'''

replace_once(
    SENTINEL_SOURCES,
    OLD_PSA_URL_HELPERS,
    NEW_PSA_URL_HELPERS,
    "PSA locale-safe exact URL helpers",
)

OLD_SEARCH_METHOD = '''    async def search(
        self, source: dict[str, Any], target: dict[str, Any]
    ) -> list[Candidate]:
        query = self._query(source, target)
        url = source["search_url_template"].format(query=quote_plus(query))
        headers = {
            "user-agent": USER_AGENT,
            "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        }
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds,
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
        kind = source["kind"]
        if kind == "reddit_json":
            return self._reddit_candidates(source, target, response.json())
        if kind == "archive_json":
            return self._archive_candidates(source, target, response.json())
        return self._html_candidates(source, target, response.text, str(response.url))
'''

NEW_SEARCH_METHOD = '''    async def search(
        self, source: dict[str, Any], target: dict[str, Any]
    ) -> list[Candidate]:
        query = self._query(source, target)
        headers = {
            "user-agent": USER_AGENT,
            "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        }
        kind = source["kind"]

        if kind == "psa_first_party":
            direct_url = source["search_url_template"].format(query=quote_plus(query))
            direct_error: httpx.HTTPError | None = None
            try:
                async with httpx.AsyncClient(
                    timeout=self.timeout_seconds,
                    follow_redirects=True,
                    headers=headers,
                ) as client:
                    response = await client.get(direct_url)
                    response.raise_for_status()
                direct = self._html_candidates(
                    source,
                    target,
                    response.text,
                    str(response.url),
                )
                if direct:
                    return direct
            except httpx.HTTPError as error:
                direct_error = error

            # PSA first. SERP is only a fallback when PSA's own search endpoint
            # is blocked or does not expose the exact whole-release set link.
            fallback_query = (
                f'site:psacard.com {query} "Auction Prices Realized" "Items in Set"'
            )
            fallback_url = (
                "https://www.bing.com/search?q=" + quote_plus(fallback_query)
            )
            try:
                async with httpx.AsyncClient(
                    timeout=self.timeout_seconds,
                    follow_redirects=True,
                    headers=headers,
                ) as client:
                    response = await client.get(fallback_url)
                    response.raise_for_status()
                return self._html_candidates(
                    source,
                    target,
                    response.text,
                    str(response.url),
                )
            except httpx.HTTPError:
                if direct_error is not None:
                    raise direct_error
                raise

        url = source["search_url_template"].format(query=quote_plus(query))
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds,
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
        if kind == "reddit_json":
            return self._reddit_candidates(source, target, response.json())
        if kind == "archive_json":
            return self._archive_candidates(source, target, response.json())
        return self._html_candidates(source, target, response.text, str(response.url))
'''

replace_once(SENTINEL_SOURCES, OLD_SEARCH_METHOD, NEW_SEARCH_METHOD, "PSA first-party search/fallback")

OLD_PSA_QUERY = '''        elif source_id == "psa":
            # PSA titles use release/card year (for example `2010 Panini ...`),
            # while our canonical target may use the hobby season `2010-11`.
            # Search by the parsed first year but keep the full season untouched
            # for Registry identity/persistence.
            query = " ".join(
                str(value).strip()
                for value in [
                    target.get("year") or target.get("season"),
                    target.get("manufacturer"),
                    target.get("product"),
                    target.get("sport"),
                    '"Auction Prices Realized"',
                    '"Items in Set"',
                ]
                if value
            )
'''

NEW_PSA_QUERY = '''        elif source_id == "psa":
            # PSA's own APR search works best with the card release identity.
            # Keep hobby season canonicalization in Registry context, but search
            # with the parsed release year PSA actually prints on its pages.
            query = " ".join(
                str(value).strip()
                for value in [
                    target.get("year") or target.get("season"),
                    target.get("manufacturer"),
                    target.get("product"),
                    target.get("sport"),
                ]
                if value
            )
'''

replace_once(SENTINEL_SOURCES, OLD_PSA_QUERY, NEW_PSA_QUERY, "PSA direct search query")

OLD_HTML_URL = '''        for href, title in parser.anchors:
            url = unwrap_search_url(href, base_url)
            if not url or url in seen or not is_public_http_url(url):
                continue
            seen.add(url)
            host = (urlparse(url).hostname or "").lower()
'''

NEW_HTML_URL = '''        for href, title in parser.anchors:
            url = unwrap_search_url(href, base_url)
            if source.get("source_id") == "psa" and url:
                url = _canonical_psa_apr_url(url)
            if not url or url in seen or not is_public_http_url(url):
                continue
            seen.add(url)
            host = (urlparse(url).hostname or "").lower()
'''

replace_once(SENTINEL_SOURCES, OLD_HTML_URL, NEW_HTML_URL, "PSA canonical candidate URLs")

PSA_TEST_CONTENT = '''import pytest

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


def test_psa_is_high_trust_and_uses_first_party_search_before_serp():
    assert AUTO_IMPORT_DOMAINS["psacard.com"] == 96
    assert source("psa")["import_policy"] == "auto_import"
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


def test_psa_html_candidates_drop_card_and_subset_pages_keep_exact_release():
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
    assert rows[0].import_policy == "auto_import"
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
'''

PSA_TESTS.write_text(PSA_TEST_CONTENT, encoding="utf-8")
print(f"wrote PSA Sentinel regression suite: {PSA_TESTS}")

replace_once(
    PSA_ADAPTER,
    'export const PSA_APR_HTML_ADAPTER_VERSION = "1.1.0" as const;',
    'export const PSA_APR_HTML_ADAPTER_VERSION = "1.2.0" as const;',
    "PSA adapter version",
)

OLD_ACTUAL_SLUG = '''function actualPsaReleaseSlug(sourceUrl: string) {
  try {
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    return comparable(parts[2] || "");
  } catch {
    return "";
  }
}
'''

NEW_ACTUAL_SLUG = '''function psaAprPathParts(sourceUrl: string) {
  try {
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    if (parts[0] && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0])) parts.shift();
    return parts;
  } catch {
    return [] as string[];
  }
}

function actualPsaReleaseSlug(sourceUrl: string) {
  const parts = psaAprPathParts(sourceUrl);
  return comparable(parts[2] || "");
}
'''

replace_once(PSA_ADAPTER, OLD_ACTUAL_SLUG, NEW_ACTUAL_SLUG, "PSA adapter locale path parsing")

OLD_SUPPORTS = '''  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\\/\\/(?:www\\.)?psacard\\.com\\/auctionprices\\/[^/]+\\/[^/]+\\/\\d+(?:[/?#]|$)/i.test(
        artifact.sourceUrl,
      )
    );
  },
'''

NEW_SUPPORTS = '''  supports(artifact) {
    if (artifact.mimeType.toLowerCase() !== "text/html") return false;
    try {
      const url = new URL(artifact.sourceUrl);
      if (!/^(?:www\\.)?psacard\\.com$/i.test(url.hostname)) return false;
      const parts = psaAprPathParts(artifact.sourceUrl);
      return (
        parts.length === 4 &&
        parts[0]?.toLowerCase() === "auctionprices" &&
        /^\\d+$/.test(parts[3] || "")
      );
    } catch {
      return false;
    }
  },
'''

replace_once(PSA_ADAPTER, OLD_SUPPORTS, NEW_SUPPORTS, "PSA adapter locale-safe supports gate")

print("Sentinel PSA first-party patch complete.")
