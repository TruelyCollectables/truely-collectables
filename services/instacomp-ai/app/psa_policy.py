from __future__ import annotations

from urllib.parse import urlparse

from . import sentinel_sources


_PSA_HOSTS = {"psacard.com", "www.psacard.com"}


def install_psa_lead_only_policy() -> None:
    if getattr(sentinel_sources, "_instacomp_psa_lead_only_policy", False):
        return

    original_candidate_trust = sentinel_sources.candidate_trust

    def candidate_trust_with_psa_lead_only(url: str) -> tuple[int, str]:
        host = (urlparse(url).hostname or "").lower()
        if host in _PSA_HOSTS:
            return 96, "lead_only"
        return original_candidate_trust(url)

    sentinel_sources.candidate_trust = candidate_trust_with_psa_lead_only

    for source in sentinel_sources.DEFAULT_SOURCES:
        if source.get("source_id") == "psa":
            source["trust_score"] = 96
            source["import_policy"] = "lead_only"

    sentinel_sources._instacomp_psa_lead_only_policy = True
    sentinel_sources._instacomp_original_candidate_trust = original_candidate_trust
