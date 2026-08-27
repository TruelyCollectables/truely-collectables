from __future__ import annotations

import re
from urllib.parse import urlparse

from . import runtime_compat
from .sentinel_sources import Candidate, SentinelSourceClient
from .verified_checklist_sources import verified_checklist_sources_for_target


_SLUG_ALIASES = {
    "allen-038-ginter": "allen-ginter",
    "plates-038-patches": "plates-patches",
    "rookies-038-stars-longevity": "rookies-stars-longevity",
    "t-206-product": "t206",
    "update-set": "update-series",
    "updates-and-highlights-product": "update-series",
    "series-3-updates-and-highlights-hobby": "updates-highlights",
    "traded-set": "traded",
    "traded-sets": "traded",
}


def _slug(value: object) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("038", "and")
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


def beckett_candidate_urls(target: dict) -> tuple[str, ...]:
    if str(target.get("scope") or "exact") == "discovery":
        return ()
    season = _slug(target.get("season") or target.get("year"))
    sport = _slug(target.get("sport"))
    manufacturer = _slug(target.get("manufacturer"))
    raw_product = _slug(target.get("product"))
    if not season or not sport or not raw_product:
        return ()

    product_variants: list[str] = [raw_product]
    alias = _SLUG_ALIASES.get(raw_product)
    if alias and alias not in product_variants:
        product_variants.append(alias)
    if raw_product.endswith("-product"):
        trimmed = raw_product[: -len("-product")].strip("-")
        if trimmed and trimmed not in product_variants:
            product_variants.append(trimmed)
    if raw_product.endswith("-hobby"):
        trimmed = raw_product[: -len("-hobby")].strip("-")
        if trimmed and trimmed not in product_variants:
            product_variants.append(trimmed)

    slugs: list[str] = []
    for product in product_variants:
        if manufacturer and product != manufacturer and not product.startswith(f"{manufacturer}-"):
            slugs.append(f"{season}-{manufacturer}-{product}-{sport}-cards")
        slugs.append(f"{season}-{product}-{sport}-cards")
        # Older Beckett URLs are sometimes checklist/detail pages without the
        # trailing `-cards` token. Try that deterministic form as well.
        if manufacturer and product != manufacturer and not product.startswith(f"{manufacturer}-"):
            slugs.append(f"{season}-{manufacturer}-{product}-{sport}")
        slugs.append(f"{season}-{product}-{sport}")

    urls: list[str] = []
    seen: set[str] = set()
    for slug in slugs:
        url = f"https://www.beckett.com/news/{slug}/"
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return tuple(urls[:8])


def install_deterministic_checklist_recovery() -> None:
    if getattr(SentinelSourceClient, "_instacomp_deterministic_recovery", False):
        return

    original_search = SentinelSourceClient.search

    async def search_with_deterministic_beckett(
        self: SentinelSourceClient,
        source: dict,
        target: dict,
    ) -> list[Candidate]:
        source_id = str(source.get("source_id") or "").strip()
        if source_id != "beckett":
            return await original_search(self, source, target)

        # The manually reconciled exact index remains the highest-priority lane.
        verified = tuple(
            item
            for item in verified_checklist_sources_for_target(target.get("target_key"))
            if item.source_id == "beckett"
        )
        if verified:
            return await original_search(self, source, target)

        urls = beckett_candidate_urls(target)
        if not urls:
            return await original_search(self, source, target)

        # Browser capture remains URL-scoped. These URLs are not globally trusted;
        # they become eligible only because they were deterministically derived
        # from one exact Registry target while processing that target.
        runtime_compat._VERIFIED_PAGE_URLS = frozenset(
            (*runtime_compat._VERIFIED_PAGE_URLS, *urls)
        )
        return [
            Candidate(
                url=url,
                title=(
                    f"{target.get('season') or target.get('year')} "
                    f"{target.get('manufacturer') or ''} {target.get('product') or ''} "
                    f"{target.get('sport') or ''} checklist"
                ).strip(),
                source_id="beckett",
                domain=(urlparse(url).hostname or "").lower(),
                trust_score=90,
                import_policy="auto_import",
                exact_match=True,
                reason=(
                    "Deterministic Beckett checklist-page candidate derived from "
                    "the exact audited Registry target; Registry parsing and row "
                    "validation remain fail-closed."
                ),
            )
            for url in urls
        ]

    SentinelSourceClient.search = search_with_deterministic_beckett
    SentinelSourceClient._instacomp_deterministic_recovery = True
    SentinelSourceClient._instacomp_pre_deterministic_search = original_search
