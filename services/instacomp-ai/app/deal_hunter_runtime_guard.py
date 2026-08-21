from __future__ import annotations

import re
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit


_EBAY_IMAGE_SIZE = re.compile(r"/s-l\d+(?=\.[a-z0-9]+$)", re.IGNORECASE)
_SIGNED_BASEBALL_LANES = {
    "signed_prospect_baseball",
    "signed_prospect_baseball_mislist_rescue",
}
_SIGNED_BALL_OBJECT = re.compile(
    r"\b(?:signed|autographed|autograph(?:ed)?|auto(?:graphed)?)\s+"
    r"(?:(?:official|major league|mlb)\s+)*baseball\b|"
    r"\b(?:baseball|ball)\s+(?:signed|autographed|autograph(?:ed)?|auto(?:graphed)?)\b|"
    r"\b(?:signed|autographed)\s+ball\b",
    re.IGNORECASE,
)
_CARD_OBJECT = re.compile(r"\b(?:card|cards|rc)\b", re.IGNORECASE)


def normalize_ebay_image_url(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parts = urlsplit(text)
    except ValueError:
        return text
    hostname = (parts.hostname or "").lower()
    if hostname != "ebayimg.com" and not hostname.endswith(".ebayimg.com"):
        return text
    path = _EBAY_IMAGE_SIZE.sub("/s-l1600", parts.path)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def ebay_image_identity(value: Any) -> str | None:
    normalized = normalize_ebay_image_url(value)
    if not normalized:
        return None
    try:
        parts = urlsplit(normalized)
    except ValueError:
        return normalized
    hostname = (parts.hostname or "").lower()
    if hostname != "ebayimg.com" and not hostname.endswith(".ebayimg.com"):
        return normalized
    path = _EBAY_IMAGE_SIZE.sub("/s-lSIZE", parts.path)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def preferred_distinct_images(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    images: list[str] = []
    for value in values:
        normalized = normalize_ebay_image_url(value)
        identity = ebay_image_identity(normalized)
        if not normalized or not identity or identity in seen:
            continue
        seen.add(identity)
        images.append(normalized)
        if len(images) >= 12:
            break
    return images


def is_real_signed_baseball_candidate(candidate: dict[str, Any]) -> bool:
    lane = str(candidate.get("lane") or "").strip()
    if lane not in _SIGNED_BASEBALL_LANES:
        return True
    title = str(candidate.get("title") or "").strip()
    if not title:
        return False
    # An explicit trading-card object is never a signed baseball, even if a
    # seller writes "signed baseball card". Brand/prospect words alone are not
    # disqualifying when the title clearly identifies a physical signed ball.
    if _CARD_OBJECT.search(title):
        return False
    return bool(_SIGNED_BALL_OBJECT.search(title))


def install_deal_hunter_runtime_guard() -> None:
    from . import deal_hunter as module

    if getattr(module, "_stale_feed_image_guard_installed", False):
        return

    original: Callable[[dict[str, Any]], dict[str, Any]] = module.normalize_candidate

    def guarded_normalize_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
        normalized = original(candidate)
        source_images = list(candidate.get("imageUrls") or normalized.get("image_urls") or [])
        normalized["image_urls"] = preferred_distinct_images(source_images)

        if not is_real_signed_baseball_candidate(normalized):
            # _discover intentionally skips candidates with no listing URL. Keep
            # the rejection local to the Mac so a stale website feed cannot leak
            # signed Bowman/cards into the baseball lane.
            normalized["listing_url"] = ""
            normalized["preliminary_risks"] = list(
                dict.fromkeys(
                    [
                        *(normalized.get("preliminary_risks") or []),
                        "signed_baseball_lane_non_ball_rejected",
                    ]
                )
            )
        return normalized

    module.normalize_candidate = guarded_normalize_candidate
    module._stale_feed_image_guard_installed = True
