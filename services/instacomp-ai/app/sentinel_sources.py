from __future__ import annotations

import hashlib
import html
import ipaddress
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import httpx

from .psa_verified_sets import verified_psa_set_for_target


USER_AGENT = (
    "Mozilla/5.0 (compatible; InstaComp-AI-Checklist-Sentinel/1.0; "
    "+https://truelycollectables.com)"
)

AUTO_IMPORT_DOMAINS = {
    "topps.com": 100,
    "www.topps.com": 100,
    "upperdeck.com": 100,
    "www.upperdeck.com": 100,
    "paniniamerica.net": 100,
    "www.paniniamerica.net": 100,
    "leaftradingcards.com": 98,
    "www.leaftradingcards.com": 98,
    # PSA APR set pages expose deterministic `No. | Subject | Auction Results`
    # tables. Only exact whole-release APR URLs may auto-import.
    "psacard.com": 96,
    "www.psacard.com": 96,
    "beckett.com": 90,
    "www.beckett.com": 90,
    "checklistinsider.com": 94,
    "www.checklistinsider.com": 94,
    "cardboardconnection.com": 88,
    "www.cardboardconnection.com": 88,
    "breakninja.com": 86,
    "www.breakninja.com": 86,
    "gogts.net": 84,
    "www.gogts.net": 84,
    "cardboardchecklist.com": 82,
    "www.cardboardchecklist.com": 82,
    "keymancollectibles.com": 80,
    "www.keymancollectibles.com": 80,
    "sportscardradio.com": 78,
    "www.sportscardradio.com": 78,
    "archive.org": 76,
    "web.archive.org": 76,
}

LEAD_ONLY_DOMAINS = {
    # BaseballCardPedia is strong discovery evidence, but its HTML is not yet
    # backed by a certified Registry ingestion adapter. Keep it lead-only.
    "baseballcardpedia.com": 72,
    "www.baseballcardpedia.com": 72,
    # SGC has a searchable Pop Report and cert verification, but it remains
    # discovery-only until row completeness is certified against known sets.
    "gosgc.com": 70,
    "www.gosgc.com": 70,
    "reddit.com": 55,
    "www.reddit.com": 55,
    "old.reddit.com": 55,
    "blowoutforums.com": 55,
    "www.blowoutforums.com": 55,
    "tcdb.com": 55,
    "www.tcdb.com": 55,
    "docs.google.com": 50,
    "drive.google.com": 50,
}

DEFAULT_SOURCES: list[dict[str, Any]] = [
    {
        "source_id": "google",
        "name": "Google",
        "kind": "html_search",
        "trust_score": 60,
        "import_policy": "discovery",
        "search_url_template": "https://www.google.com/search?q={query}",
        "domains": ["google.com"],
    },
    {
        "source_id": "bing",
        "name": "Bing",
        "kind": "html_search",
        "trust_score": 60,
        "import_policy": "discovery",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["bing.com"],
    },
    {
        "source_id": "topps",
        "name": "Topps official",
        "kind": "site_search",
        "trust_score": 100,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["topps.com", "www.topps.com"],
    },
    {
        "source_id": "upperdeck",
        "name": "Upper Deck official",
        "kind": "site_search",
        "trust_score": 100,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["upperdeck.com", "www.upperdeck.com"],
    },
    {
        "source_id": "panini",
        "name": "Panini official",
        "kind": "site_search",
        "trust_score": 100,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["paniniamerica.net", "www.paniniamerica.net"],
    },
    {
        "source_id": "leaf",
        "name": "Leaf official",
        "kind": "site_search",
        "trust_score": 98,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["leaftradingcards.com", "www.leaftradingcards.com"],
    },
    {
        "source_id": "psa",
        "name": "PSA Auction Prices Realized first-party",
        "kind": "psa_first_party",
        "trust_score": 96,
        "import_policy": "auto_import",
        "search_url_template": "https://www.psacard.com/auctionprices/search?q={query}",
        "domains": ["psacard.com", "www.psacard.com"],
    },
    {
        "source_id": "sgc",
        "name": "SGC Pop Report",
        "kind": "site_search",
        "trust_score": 70,
        "import_policy": "lead_only",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["gosgc.com", "www.gosgc.com"],
    },
    {
        "source_id": "baseballcardpedia",
        "name": "BaseballCardPedia",
        "kind": "site_search",
        "trust_score": 72,
        "import_policy": "lead_only",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["baseballcardpedia.com", "www.baseballcardpedia.com"],
    },
    {
        "source_id": "beckett",
        "name": "Beckett",
        "kind": "site_search",
        "trust_score": 90,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["beckett.com", "www.beckett.com"],
    },
    {
        "source_id": "checklistinsider",
        "name": "Checklist Insider",
        "kind": "site_search",
        "trust_score": 94,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["checklistinsider.com", "www.checklistinsider.com"],
    },
    {
        "source_id": "cardboardconnection",
        "name": "Cardboard Connection",
        "kind": "site_search",
        "trust_score": 88,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["cardboardconnection.com", "www.cardboardconnection.com"],
    },
    {
        "source_id": "breakninja",
        "name": "Break Ninja",
        "kind": "site_search",
        "trust_score": 86,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["breakninja.com", "www.breakninja.com"],
    },
    {
        "source_id": "gogts",
        "name": "GoGTS",
        "kind": "site_search",
        "trust_score": 84,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["gogts.net", "www.gogts.net"],
    },
    {
        "source_id": "cardboardchecklist",
        "name": "Cardboard Checklist",
        "kind": "site_search",
        "trust_score": 82,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["cardboardchecklist.com", "www.cardboardchecklist.com"],
    },
    {
        "source_id": "keyman",
        "name": "KeyMan Collectibles",
        "kind": "site_search",
        "trust_score": 80,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["keymancollectibles.com", "www.keymancollectibles.com"],
    },
    {
        "source_id": "sportscardradio",
        "name": "Sports Card Radio",
        "kind": "site_search",
        "trust_score": 78,
        "import_policy": "auto_import",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["sportscardradio.com", "www.sportscardradio.com"],
    },
    {
        "source_id": "reddit",
        "name": "Reddit",
        "kind": "reddit_json",
        "trust_score": 55,
        "import_policy": "lead_only",
        "search_url_template": (
            "https://www.reddit.com/search.json?q={query}&limit=20&sort=relevance&t=all"
        ),
        "domains": ["reddit.com", "www.reddit.com", "old.reddit.com"],
    },
    {
        "source_id": "blowout",
        "name": "Blowout Forums",
        "kind": "site_search",
        "trust_score": 55,
        "import_policy": "lead_only",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["blowoutforums.com", "www.blowoutforums.com"],
    },
    {
        "source_id": "tcdb",
        "name": "TCDB",
        "kind": "site_search",
        "trust_score": 55,
        "import_policy": "lead_only",
        "search_url_template": "https://www.bing.com/search?q={query}",
        "domains": ["tcdb.com", "www.tcdb.com"],
    },
]


@dataclass(frozen=True)
class Candidate:
    url: str
    title: str
    source_id: str
    domain: str
    trust_score: int
    import_policy: str
    exact_match: bool
    reason: str


@dataclass(frozen=True)
class DownloadedFile:
    url: str
    content: bytes
    content_type: str
    sha256: str
    extension: str


class AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.anchors: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = dict(attrs)
        self._href = values.get("href")
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href:
            title = " ".join(" ".join(self._text).split())
            self.anchors.append((self._href, html.unescape(title)))
            self._href = None
            self._text = []


def normalize_text(value: Any) -> str:
    value = html.unescape(str(value or "")).lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def significant_tokens(value: Any) -> set[str]:
    stop = {
        "the",
        "and",
        "cards",
        "card",
        "checklist",
        "set",
        "sets",
        "hobby",
        "edition",
        "collection",
        "trading",
    }
    return {
        token
        for token in normalize_text(value).split()
        if len(token) > 1 and token not in stop
    }


def clean_product_text(value: Any) -> str:
    text = str(value or "").replace("-", " ")
    text = re.sub(r"\b0*38\b", " and ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def exact_target_match(target: dict[str, Any], title: str, url: str) -> tuple[bool, str]:
    haystack = normalize_text(f"{title} {unquote(url)}")
    if target.get("scope") == "discovery":
        return False, "Broad discovery result requires exact-set review."

    season = normalize_text(target.get("season") or target.get("year"))
    year = str(target.get("year") or "").strip()
    if season and season not in haystack and (not year or year not in haystack):
        return False, "Season/year was not visible in the result."

    manufacturer = significant_tokens(target.get("manufacturer"))
    if manufacturer and not manufacturer.intersection(set(haystack.split())):
        # Beckett and other checklist publishers often omit "Upper Deck" from
        # titles for house product lines such as SP Authentic/SPx/O-Pee-Chee.
        # Those product names themselves are deterministic publisher evidence.
        product_norm = normalize_text(clean_product_text(target.get("product")))
        upper_deck_house_products = (
            "sp authentic", "spx", "sp game used", "o pee chee platinum",
            "synergy", "credentials", "metal universe", "upper deck ice",
        )
        manufacturer_norm = normalize_text(target.get("manufacturer"))
        implied_upper_deck = (
            manufacturer_norm == "upper deck"
            and any(token in product_norm for token in upper_deck_house_products)
        )
        if not implied_upper_deck:
            return False, "Manufacturer was not visible in the result."

    if target.get("scope") == "inventory-gap":
        sport = normalize_text(target.get("sport"))
        sport_aliases = {
            "baseball": {"baseball", "mlb"},
            "basketball": {"basketball", "nba", "wnba"},
            "football": {"football", "nfl"},
            "hockey": {"hockey", "nhl"},
            "soccer": {"soccer", "football", "fifa", "uefa"},
            "golf": {"golf", "pga"},
            "wrestling": {"wrestling", "wwe", "aew"},
            "racing": {"racing", "nascar"},
            "mma": {"mma", "ufc"},
            "boxing": {"boxing"},
            "tennis": {"tennis"},
        }
        if not sport or sport not in sport_aliases:
            return False, "Inventory-gap target lacks a safely supported sport."
        words = set(haystack.split())
        if not sport_aliases[sport].intersection(words):
            return False, f"Sport {sport!r} was not visible in the result."

    product = significant_tokens(clean_product_text(target.get("product")))
    if not product:
        return False, "Target product is empty."
    overlap = len(product.intersection(set(haystack.split()))) / max(1, len(product))
    if overlap < 0.7:
        return False, f"Product token overlap was {overlap:.2f}."

    return True, f"Exact identity token overlap {overlap:.2f}."


def candidate_trust(url: str) -> tuple[int, str]:
    host = (urlparse(url).hostname or "").lower()
    if host in AUTO_IMPORT_DOMAINS:
        return AUTO_IMPORT_DOMAINS[host], "auto_import"
    if host in LEAD_ONLY_DOMAINS:
        return LEAD_ONLY_DOMAINS[host], "lead_only"
    for domain, score in AUTO_IMPORT_DOMAINS.items():
        if host.endswith(f".{domain}"):
            return score, "auto_import"
    for domain, score in LEAD_ONLY_DOMAINS.items():
        if host.endswith(f".{domain}"):
            return score, "lead_only"
    return 25, "lead_only"


def unwrap_search_url(href: str, base_url: str) -> str | None:
    if not href:
        return None
    absolute = urljoin(base_url, href)
    parsed = urlparse(absolute)
    if parsed.netloc.endswith("google.com") and parsed.path == "/url":
        query = parse_qs(parsed.query)
        value = (query.get("q") or query.get("url") or [None])[0]
        return value
    if parsed.netloc.endswith("bing.com") and parsed.path.startswith("/ck/a"):
        query = parse_qs(parsed.query)
        value = (query.get("u") or [None])[0]
        if value and value.startswith("a1"):
            try:
                import base64

                padded = value[2:] + "=" * (-len(value[2:]) % 4)
                return base64.urlsafe_b64decode(padded).decode("utf-8")
            except Exception:
                return None
    return absolute


def is_public_http_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        return False
    try:
        address = ipaddress.ip_address(host)
        return not (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
        )
    except ValueError:
        return True


def _normalized_domain(value: str) -> str:
    return value.lower().removeprefix("www.")


def _host_matches_domain(host: str, domain: str) -> bool:
    normalized_host = _normalized_domain(host)
    normalized_domain = _normalized_domain(domain)
    return normalized_host == normalized_domain or normalized_host.endswith(
        f".{normalized_domain}"
    )


def _allowed_source_host(source: dict[str, Any], host: str) -> bool:
    raw_domains = source.get("domains") or []
    if isinstance(raw_domains, str):
        try:
            raw_domains = json.loads(raw_domains)
        except json.JSONDecodeError:
            raw_domains = [raw_domains]
    domains = [str(domain) for domain in raw_domains if domain]
    if not domains:
        return True
    return any(_host_matches_domain(host, domain) for domain in domains)


def safe_filename(target: dict[str, Any], extension: str, sha256: str) -> str:
    raw = "-".join(
        str(value or "")
        for value in [
            target.get("sport"),
            target.get("season") or target.get("year"),
            target.get("manufacturer"),
            target.get("product"),
        ]
    )
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", raw).strip("-").lower()
    return f"{slug[:160]}-{sha256[:12]}{extension}"


def _psa_path_parts(url: str) -> list[str]:
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


class SentinelSourceClient:
    def __init__(
        self,
        *,
        timeout_seconds: float,
        max_download_bytes: int,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_download_bytes = max_download_bytes

    async def search(
        self, source: dict[str, Any], target: dict[str, Any]
    ) -> list[Candidate]:
        query = self._query(source, target)
        headers = {
            "user-agent": USER_AGENT,
            "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        }
        kind = source["kind"]

        if kind == "psa_first_party":
            verified = verified_psa_set_for_target(target.get("target_key"))
            if verified is not None:
                verified_url = _canonical_psa_apr_url(verified.url)
                if not _is_psa_exact_release_url(verified_url, target):
                    raise ValueError(
                        "Verified PSA set index entry failed exact-release validation."
                    )
                trust, policy = candidate_trust(verified_url)
                exact, identity_reason = exact_target_match(
                    target, verified.title, verified_url
                )
                if not exact:
                    raise ValueError(
                        "Verified PSA set index entry failed target identity validation: "
                        + identity_reason
                    )
                return [
                    Candidate(
                        url=verified_url,
                        title=verified.title,
                        source_id=source["source_id"],
                        domain=(urlparse(verified_url).hostname or "").lower(),
                        trust_score=trust,
                        import_policy=policy,
                        exact_match=True,
                        reason=(
                            "Exact whole-release match from verified PSA whole-release "
                            f"index ({verified.verified_on}); {identity_reason}"
                        ),
                    )
                ]

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

        if kind == "site_search":
            direct = await self._direct_site_candidates(source, target, headers)
            if direct:
                return direct
            release_results = await self._search_release_candidates(source, target, headers)
            if release_results:
                return release_results

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

    async def resolve_ingest_candidates(
        self, source: dict[str, Any], target: dict[str, Any], candidate: Candidate
    ) -> list[Candidate]:
        """Resolve trusted landing pages to supported checklist attachments."""
        # Any enabled approved auto-import source may expose a release landing page
        # whose actual checklist is an XLSX/CSV/PDF attachment. Provenance/trust
        # was already established before this resolver is called.
        if source.get("import_policy") != "auto_import" or int(source.get("trust_score") or 0) < 75:
            return []
        path = urlparse(candidate.url).path.lower()
        if path.endswith((".xlsx", ".xls", ".csv", ".pdf")):
            return [candidate]
        headers = {"user-agent": USER_AGENT, "accept": "text/html,*/*;q=0.8"}
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True, headers=headers) as client:
            response = await client.get(candidate.url)
            response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";")[0].lower()
        if "html" not in content_type:
            return []
        parser = AnchorParser(); parser.feed(response.text)
        resolved: list[Candidate] = []; seen: set[str] = set()
        for href, title in parser.anchors:
            url = urljoin(str(response.url), href)
            if not is_public_http_url(url) or url in seen:
                continue
            text = (title or "").lower()
            parsed = urlparse(url)
            supported = parsed.path.lower().endswith((".xlsx", ".xls", ".csv", ".pdf")) or any(ext in url.lower() for ext in (".xlsx", ".xls", ".csv", ".pdf"))
            downloadish = any(word in text for word in ("download", "checklist", "xlsx", "spreadsheet", "csv", "pdf"))
            if not supported and not downloadish:
                continue
            if not supported:
                try:
                    async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True, headers=headers) as probe:
                        head = await probe.get(url)
                    final = str(head.url); ctype = head.headers.get("content-type", "").lower()
                    if not (urlparse(final).path.lower().endswith((".xlsx", ".xls", ".csv", ".pdf")) or any(x in ctype for x in ("spreadsheet", "excel", "csv", "pdf"))):
                        continue
                    url = final
                except httpx.HTTPError:
                    continue
            seen.add(url)
            if source.get("source_id") == "beckett" and not ("checklist" in text or "xlsx" in text or "spreadsheet" in text):
                continue
            # Attachment hosts (for example Beckett's S3 bucket) are allowed only
            # after we reached an exact, trusted release page and found the link
            # on that page. Re-score the attachment by its trusted parent page,
            # rather than downgrading a CDN/storage hostname to lead-only.
            resolved.append(Candidate(url=url, title=title or candidate.title, source_id=candidate.source_id, domain=(urlparse(url).hostname or "").lower(), trust_score=candidate.trust_score, import_policy=candidate.import_policy, exact_match=True, reason=f"Resolved supported checklist attachment from exact trusted release page {candidate.url}"))
        return resolved[:10]

    @staticmethod
    def _release_search_parts(target: dict[str, Any]) -> tuple[str, str, str, str]:
        season = str(target.get("season") or target.get("year") or "").strip()
        manufacturer = str(target.get("manufacturer") or "").strip()
        product = clean_product_text(target.get("product"))
        sport = str(target.get("sport") or "").strip()
        # Flagship products often equal their publisher. Do not emit malformed
        # searches/slugs such as "Upper Deck Upper Deck hockey".
        if manufacturer and normalize_text(product) == normalize_text(manufacturer):
            product = ""
        return season, manufacturer, product, sport

    def _query(self, source: dict[str, Any], target: dict[str, Any]) -> str:
        source_id = str(source.get("source_id") or "")
        season, manufacturer, product, sport = self._release_search_parts(target)
        if target.get("scope") == "discovery":
            query = str(target.get("product") or "")
        elif source_id == "psa":
            # PSA's own APR search works best with the card release identity.
            # Keep hobby season canonicalization in Registry context, but search
            # with the parsed release year PSA actually prints on its pages.
            query = " ".join(
                str(value).strip()
                for value in [
                    target.get("year") or season,
                    manufacturer,
                    product,
                    sport,
                ]
                if value
            )
        elif source_id == "sgc":
            query = " ".join(
                str(value).strip()
                for value in [
                    target.get("year") or season,
                    manufacturer,
                    product,
                    sport,
                    '"Pop Report"',
                ]
                if value
            )
        elif source.get("kind") == "site_search":
            query = " ".join(
                str(value).strip()
                for value in [
                    season, manufacturer, product, sport, "checklist",
                ]
                if value
            )
        else:
            query = " ".join(
                str(value).strip()
                for value in [
                    season, manufacturer, product, sport, "checklist",
                    "spreadsheet OR PDF OR XLSX OR CSV",
                ]
                if value
            )
        if source["kind"] == "site_search" and source.get("domains"):
            query = f"site:{source['domains'][0]} {query}"
        return query

    def _release_search_queries(self, source: dict[str, Any], target: dict[str, Any]) -> list[str]:
        domain = (source.get("domains") or [""])[0]
        season, manufacturer, product, sport = self._release_search_parts(target)
        base = " ".join(x for x in [season, manufacturer, product, sport] if x)
        queries = [f'site:{domain} "{base}" checklist']
        # Hobby seasons are often queued by start year (2025) while publishers print 2025-26.
        if season.isdigit() and len(season) == 4:
            nxt = str(int(season) + 1)[-2:]
            queries.append(f'site:{domain} "{season}-{nxt}" {manufacturer} {product} {sport} checklist')
        return list(dict.fromkeys(queries))

    async def _search_release_candidates(self, source: dict[str, Any], target: dict[str, Any], headers: dict[str, str]) -> list[Candidate]:
        results=[]; seen=set()
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True, headers=headers) as client:
            for query in self._release_search_queries(source, target):
                url = source["search_url_template"].format(query=quote_plus(query))
                try:
                    response=await client.get(url); response.raise_for_status()
                except httpx.HTTPError:
                    continue
                for candidate in self._html_candidates(source,target,response.text,str(response.url)):
                    if candidate.url in seen or not candidate.exact_match: continue
                    seen.add(candidate.url); results.append(candidate)
                if results: break
        return results[:10]

    def _html_candidates(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
        text: str,
        base_url: str,
    ) -> list[Candidate]:
        parser = AnchorParser()
        parser.feed(text)
        results: list[Candidate] = []
        seen: set[str] = set()
        for href, title in parser.anchors:
            url = unwrap_search_url(href, base_url)
            if source.get("source_id") == "psa" and url:
                url = _canonical_psa_apr_url(url)
            if not url or url in seen or not is_public_http_url(url):
                continue
            seen.add(url)
            host = (urlparse(url).hostname or "").lower()
            if host.endswith("google.com") or host.endswith("bing.com"):
                continue
            if source.get("kind") == "site_search" and not _allowed_source_host(
                source, host
            ):
                continue
            if source.get("source_id") == "psa" and not _is_psa_exact_release_url(url, target):
                continue
            trust, policy = candidate_trust(url)
            exact, reason = exact_target_match(target, title, url)
            results.append(
                Candidate(
                    url=url,
                    title=title or url,
                    source_id=source["source_id"],
                    domain=host,
                    trust_score=trust,
                    import_policy=policy,
                    exact_match=exact,
                    reason=reason,
                )
            )
            if len(results) >= 25:
                break
        return results

    async def _direct_site_candidates(self, source: dict[str, Any], target: dict[str, Any], headers: dict[str, str]) -> list[Candidate]:
        urls = self._direct_site_urls(source, target)
        if not urls: return []
        source_id = str(source.get("source_id") or "")
        flagship_multi = (
            target.get("scope") == "inventory-gap"
            and source_id == "cardboardconnection"
            and normalize_text(target.get("manufacturer")) == "upper deck"
            and normalize_text(target.get("product")) == "upper deck"
            and normalize_text(target.get("sport")) == "hockey"
        )
        results=[]; seen=set()
        async with httpx.AsyncClient(timeout=min(self.timeout_seconds,12.0), follow_redirects=True, headers=headers) as client:
            for url in urls:
                try:
                    response=await client.get(url); response.raise_for_status()
                except (httpx.ConnectError, httpx.ConnectTimeout):
                    # Direct URL variants for one source normally share a host.
                    # If the host itself is unreachable, do not multiply a live
                    # scan stall by retrying every guessed slug on that same host.
                    break
                except httpx.HTTPError:
                    continue
                host=(urlparse(str(response.url)).hostname or '').lower()
                if not _allowed_source_host(source,host): continue
                # A guessed direct URL may already BE the exact release page.
                # Previously Sentinel opened it successfully and then ignored it,
                # looking only for another release link inside the page.
                page_title_match = re.search(r"<title[^>]*>(.*?)</title>", response.text, re.I | re.S)
                page_title = re.sub(r"<[^>]+>", " ", page_title_match.group(1) if page_title_match else "")
                page_title = html.unescape(" ".join(page_title.split()))
                exact_page, page_reason = exact_target_match(target, page_title, str(response.url))
                if exact_page:
                    trust, policy = candidate_trust(str(response.url))
                    candidate = Candidate(
                        url=str(response.url), title=page_title or self._direct_site_title(target),
                        source_id=source['source_id'], domain=host, trust_score=trust,
                        import_policy=policy, exact_match=True,
                        reason=f'Exact direct release page. {page_reason}',
                    )
                    if flagship_multi:
                        if candidate.url not in seen:
                            seen.add(candidate.url); results.append(candidate)
                        continue
                    return [candidate]
                parser=AnchorParser(); parser.feed(response.text)
                # A source index is navigation, not the release. Find exact release links on-page.
                for href,title in parser.anchors:
                    link=urljoin(str(response.url),href)
                    if link in seen or not is_public_http_url(link): continue
                    lhost=(urlparse(link).hostname or '').lower()
                    if not _allowed_source_host(source,lhost): continue
                    exact,reason=exact_target_match(target,title,link)
                    if not exact: continue
                    seen.add(link); trust,policy=candidate_trust(link)
                    results.append(Candidate(url=link,title=title or self._direct_site_title(target),source_id=source['source_id'],domain=lhost,trust_score=trust,import_policy=policy,exact_match=True,reason=f'Exact release link found on source site. {reason}'))
                if results and not flagship_multi: return results[:10]
        return results[:10]

    def _direct_site_urls(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
    ) -> list[str]:
        source_id = str(source.get("source_id") or "")
        slug = self._target_slug(target)
        if not slug:
            return []
        base_slugs = [slug, slug.replace("-and-", "-")]
        if target.get("scope") == "inventory-gap":
            slugs = list(dict.fromkeys(
                variant
                for value in base_slugs
                for variant in (value, f"{value}-cards", f"{value}-checklist")
            ))
        else:
            # Preserve the established direct-site contract for normal Sentinel
            # targets; inventory-gap recovery alone gets the broader slug probes.
            slugs = list(dict.fromkeys(base_slugs))
        if source_id == "topps":
            urls = ["https://www.topps.com/pages/checklists"]
            product = clean_product_text(target.get("product")).lower()
            sport = str(target.get("sport") or "").lower()
            # Topps uses stable release landing pages whose download controls are rendered there.
            if "chrome" in product and ("uefa" in product or sport == "soccer"):
                urls.insert(0, "https://www.topps.com/pages/topps-chrome-uefa-club-competitions")
            return urls
        if source_id == "upperdeck":
            return ["https://upperdeck.com/checklists/"]
        if source_id == "panini":
            return ["https://www.paniniamerica.net/checklist.html"]
        if source_id == "leaf":
            return ["https://www.leaftradingcards.com/collections/checklists"]
        if source_id == "beckett":
            beckett_slugs = list(slugs)
            year = str(target.get("year") or "").strip()
            manufacturer = str(target.get("manufacturer") or "").strip()
            product = clean_product_text(target.get("product"))
            sport = str(target.get("sport") or "").strip()
            if year.isdigit() and len(year) == 4:
                season = f"{year}-{str(int(year) + 1)[-2:]}"
                product_aliases = [product]
                if normalize_text(product) == "metal universe":
                    product_aliases.append("SkyBox Metal Universe")
                # Hobby checklist titles inconsistently include the publisher.
                # Try both exact forms; exact_target_match still validates the
                # product/year/sport before anything is downloaded or imported.
                manufacturer_variants = [manufacturer, ""] if manufacturer else [""]
                for product_alias in product_aliases:
                    for manufacturer_variant in manufacturer_variants:
                        text = " ".join(x for x in [season, manufacturer_variant, product_alias, sport] if x)
                        text = re.sub(r"([A-Za-z0-9])['’]s\b", r"\1s", text)
                        value = re.sub(r"[^a-z0-9]+", "-", normalize_text(text)).strip("-")
                        for variant in (value, f"{value}-cards", f"{value}-checklist"):
                            if variant and variant not in beckett_slugs:
                                beckett_slugs.append(variant)
            return [*[f"https://www.beckett.com/news/{value}/" for value in beckett_slugs], "https://www.beckett.com/news/category/checklists/"]
        if source_id == "gogts":
            return ["https://gogts.net/sports-card-checklists/"]
        if source_id == "cardboardconnection":
            urls: list[str] = []
            if (
                target.get("scope") == "inventory-gap"
                and normalize_text(target.get("manufacturer")) == "upper deck"
                and normalize_text(target.get("product")) == "upper deck"
                and normalize_text(target.get("sport")) == "hockey"
            ):
                season = re.sub(r"[^0-9-]+", "", str(target.get("season") or target.get("year") or "")).strip("-")
                if season:
                    urls.extend([
                        f"https://www.cardboardconnection.com/{season}-upper-deck-series-1-hockey-cards",
                        f"https://www.cardboardconnection.com/{season}-upper-deck-series-2-hockey-cards",
                        f"https://www.cardboardconnection.com/{season}-upper-deck-extended-series-hockey-cards",
                    ])
            urls.extend(f"https://www.cardboardconnection.com/{value}" for value in slugs)
            return list(dict.fromkeys(urls))
        if source_id == "sportscardradio":
            return [
                url
                for value in slugs
                for url in [
                    f"https://www.sportscardradio.com/{value}-checklist/",
                    f"https://www.sportscardradio.com/{value}-box-checklist/",
                ]
            ]
        return []

    def _target_slug(self, target: dict[str, Any]) -> str:
        season, manufacturer, product, sport = self._release_search_parts(target)
        values = [season, manufacturer, product, sport]
        text = " ".join(str(value or "").strip() for value in values if value)
        # Publisher page slugs normally collapse English possessives (McDonald's
        # -> mcdonalds) rather than inserting an extra dash (mcdonald-s).
        text = re.sub(r"([A-Za-z0-9])['’]s\b", r"\1s", text)
        return re.sub(r"[^a-z0-9]+", "-", normalize_text(text)).strip("-")

    def _direct_site_title(self, target: dict[str, Any]) -> str:
        season, manufacturer, product, sport = self._release_search_parts(target)
        return " ".join(str(value).strip() for value in [season, manufacturer, product, sport, "checklist"] if value)

    def _reddit_candidates(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
        payload: dict[str, Any],
    ) -> list[Candidate]:
        results: list[Candidate] = []
        children = payload.get("data", {}).get("children", [])
        for child in children:
            data = child.get("data", {})
            permalink = data.get("permalink")
            url = f"https://www.reddit.com{permalink}" if permalink else data.get("url")
            if not url or not is_public_http_url(url):
                continue
            title = str(data.get("title") or "")
            exact, reason = exact_target_match(target, title, url)
            results.append(
                Candidate(
                    url=url,
                    title=title,
                    source_id=source["source_id"],
                    domain="www.reddit.com",
                    trust_score=55,
                    import_policy="lead_only",
                    exact_match=exact,
                    reason=reason,
                )
            )
        return results[:25]

    def _archive_candidates(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
        payload: dict[str, Any],
    ) -> list[Candidate]:
        results: list[Candidate] = []
        docs = payload.get("response", {}).get("docs", [])
        for doc in docs:
            identifier = str(doc.get("identifier") or "").strip()
            if not identifier:
                continue
            url = f"https://archive.org/details/{quote_plus(identifier)}"
            title = str(doc.get("title") or identifier)
            exact, reason = exact_target_match(target, title, url)
            results.append(
                Candidate(
                    url=url,
                    title=title,
                    source_id=source["source_id"],
                    domain="archive.org",
                    trust_score=76,
                    import_policy="auto_import",
                    exact_match=exact,
                    reason=reason,
                )
            )
        return results[:25]

    async def download(self, url: str) -> DownloadedFile:
        if not is_public_http_url(url):
            raise ValueError("Refusing non-public or non-HTTP checklist URL.")
        headers = {"user-agent": USER_AGENT, "accept": "*/*"}
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds,
            follow_redirects=True,
            headers=headers,
        ) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                content_type = (
                    response.headers.get("content-type", "")
                    .split(";")[0]
                    .strip()
                    .lower()
                )
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > self.max_download_bytes:
                        raise ValueError(
                            "Checklist download exceeded the configured byte limit."
                        )
                    chunks.append(chunk)
                content = b"".join(chunks)
                final_url = str(response.url)
        if not content:
            raise ValueError("Checklist download was empty.")
        sha256 = hashlib.sha256(content).hexdigest()
        extension = self._extension(final_url, content_type)
        return DownloadedFile(
            url=final_url,
            content=content,
            content_type=content_type or "application/octet-stream",
            sha256=sha256,
            extension=extension,
        )

    @staticmethod
    def _extension(url: str, content_type: str) -> str:
        path = urlparse(url).path.lower()
        for ext in [
            ".pdf",
            ".xlsx",
            ".xls",
            ".csv",
            ".tsv",
            ".zip",
            ".json",
            ".html",
            ".htm",
        ]:
            if path.endswith(ext):
                return ".html" if ext == ".htm" else ext
        mapping = {
            "application/pdf": ".pdf",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
            "application/vnd.ms-excel": ".xls",
            "text/csv": ".csv",
            "text/tab-separated-values": ".tsv",
            "application/zip": ".zip",
            "application/json": ".json",
            "text/html": ".html",
            "application/xhtml+xml": ".html",
        }
        return mapping.get(content_type, ".bin")


def persist_download(
    root: Path,
    target: dict[str, Any],
    downloaded: DownloadedFile,
) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(target, downloaded.extension, downloaded.sha256)
    final_path = root / filename
    temporary = final_path.with_suffix(final_path.suffix + ".tmp")
    temporary.write_bytes(downloaded.content)
    temporary.replace(final_path)
    return final_path


def parse_target_key(line: str) -> dict[str, Any] | None:
    value = line.strip()
    if not value or value.startswith("#"):
        return None
    parts = value.split("|")
    if len(parts) < 4:
        return None
    sport, season, manufacturer = parts[:3]
    product = "|".join(parts[3:])
    year_match = re.search(r"\b((?:18|19|20)\d{2})\b", season)
    year = int(year_match.group(1)) if year_match else None
    return {
        "target_key": value,
        "sport": sport,
        "year": year,
        "season": season,
        "manufacturer": manufacturer,
        "product": clean_product_text(product),
        "scope": "mainstream-gap" if year and year >= 2000 else "pre-2000-gap",
        "priority": max(1, min(100, 10 + (2026 - year))) if year and year >= 2000 else 100,
        "metadata": {"source": "target-key-file"},
    }


def targets_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        rows = payload.get("targets") or payload.get("items") or []
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []
    targets: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = row.get("target_key") or row.get("exactSetKey")
        if not key:
            values = [
                row.get("sport") or row.get("universe"),
                row.get("season") or row.get("year"),
                row.get("manufacturer"),
                row.get("product"),
            ]
            key = "|".join(
                re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
                for value in values
            )
        metadata = dict(row)
        nested_metadata = row.get("metadata")
        if isinstance(nested_metadata, dict):
            metadata.update(nested_metadata)
        target = {
            "target_key": key,
            "sport": row.get("sport") or row.get("universe"),
            "year": row.get("year"),
            "season": row.get("season") or row.get("year"),
            "manufacturer": row.get("manufacturer"),
            "product": row.get("product") or row.get("title"),
            "scope": row.get("scope") or "exact-gap",
            "priority": row.get("priority") or 50,
            "metadata": metadata,
        }
        if target["product"]:
            targets.append(target)
    return targets


def broad_discovery_targets() -> list[dict[str, Any]]:
    sports = [
        "baseball",
        "basketball",
        "football",
        "hockey",
        "soccer",
        "racing",
        "wrestling",
        "mma",
        "boxing",
        "golf",
        "tennis",
        "multi-sport",
    ]
    decades = [
        ("pre-1950", "pre 1950"),
        ("1950s", "1950s"),
        ("1960s", "1960s"),
        ("1970s", "1970s"),
        ("1980s", "1980s"),
        ("1990s", "1990s"),
    ]
    targets: list[dict[str, Any]] = []
    for sport in sports:
        for key, label in decades:
            targets.append(
                {
                    "target_key": f"discovery|{sport}|{key}",
                    "sport": sport,
                    "year": None,
                    "season": label,
                    "manufacturer": "",
                    "product": (
                        f"{label} {sport} trading card checklist master set list "
                        "PDF spreadsheet"
                    ),
                    "scope": "discovery",
                    "priority": 90,
                    "metadata": {"discovery": True},
                }
            )
    return targets
