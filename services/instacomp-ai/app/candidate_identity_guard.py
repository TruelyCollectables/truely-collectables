from __future__ import annotations

import re
from typing import Any

from . import lora_candidate_runtime as runtime


_PRIZM_PARALLEL_SET_RE = re.compile(
    r"^\s*(?:(?P<year>(?:19|20)\d{2})\s+)?Panini\s+Prizm\s+"
    r"(?P<context>WNBA)\s*[-–—:]\s*(?P<variant>.+?)\s+Prizms?\s*$",
    re.IGNORECASE,
)
_GENERIC_PARALLELS = {"", "base", "regular", "standard", "none", "n/a", "na"}


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _variant_family(value: object) -> str | None:
    text = _norm(value).replace("-", " ")
    if not text or text in _GENERIC_PARALLELS:
        return None
    if "cracked ice" in text:
        return "ice"
    if "velocity" in text:
        return "velocity"
    words = set(text.split())
    if "ice" in words:
        return "ice"
    for token in (
        "groovy",
        "silver",
        "green",
        "red",
        "blue",
        "orange",
        "purple",
        "gold",
        "black",
        "wave",
        "mojo",
        "scope",
        "hyper",
        "pulsar",
    ):
        if token in words:
            return token
    return text[:80]


def _parallel_label(variant: str) -> str:
    cleaned = re.sub(r"\s+Prizms?\s*$", "", str(variant or "").strip(), flags=re.I)
    return f"{cleaned} Prizm" if cleaned else ""


def normalize_candidate_identity_payload(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """Repair one known semantic shape drift without inventing card truth.

    The LoRA sidecar can emit a Panini Prizm parallel product name in ``set_name``
    (for example ``2025 Panini Prizm WNBA - Blue Velocity Prizms``) while leaving
    ``parallel`` empty. Production Registry expects the release family in brand,
    ``Base`` as the checklist set, and the parallel in ``parallel``. Moving those
    already-present words into their canonical fields prevents a malformed lookup;
    it does not supply a player, card number, or variant that the candidate did not
    itself return.

    If the sidecar also supplied a contradictory explicit parallel, do nothing so
    the existing Registry gate can fail closed rather than hiding the conflict.
    """
    root = dict(payload)
    parsed_source = root.get("parsed")
    if not isinstance(parsed_source, dict):
        return root, False
    parsed = dict(parsed_source)
    identity_source = parsed.get("identity")
    nested = isinstance(identity_source, dict)
    identity = dict(identity_source) if nested else dict(parsed)

    set_name = str(identity.get("set_name") or identity.get("setName") or "").strip()
    match = _PRIZM_PARALLEL_SET_RE.match(set_name)
    if match is None:
        return root, False

    embedded_variant = str(match.group("variant") or "").strip()
    embedded_parallel = _parallel_label(embedded_variant)
    existing_parallel = str(identity.get("parallel") or "").strip()
    if existing_parallel and _norm(existing_parallel) not in _GENERIC_PARALLELS:
        existing_family = _variant_family(existing_parallel)
        embedded_family = _variant_family(embedded_parallel)
        if existing_family != embedded_family:
            return root, False

    context = str(match.group("context") or "").upper()
    brand = str(identity.get("brand") or "").strip()
    if _norm(brand) in {"", "prizm", "panini prizm", "panini prizm wnba"}:
        identity["brand"] = f"Panini Prizm {context}"
    if not str(identity.get("manufacturer") or "").strip():
        identity["manufacturer"] = "Panini"
    if not str(identity.get("year") or "").strip() and match.group("year"):
        identity["year"] = match.group("year")
    identity["set_name"] = "Base"
    identity.pop("setName", None)
    if not existing_parallel or _norm(existing_parallel) in _GENERIC_PARALLELS:
        identity["parallel"] = embedded_parallel or None

    if nested:
        parsed["identity"] = identity
    else:
        parsed.update(identity)
    root["parsed"] = parsed
    return root, True


def install_candidate_identity_guard() -> None:
    """Normalize candidate product shape before existing evidence safety guards."""
    if getattr(runtime, "_instacomp_candidate_identity_guard_installed", False):
        return

    original = runtime._candidate_response_to_suggestion

    def guarded_candidate_response_to_suggestion(
        payload: dict[str, Any],
        *,
        local_vision,
    ):
        normalized_payload, repaired = normalize_candidate_identity_payload(payload)
        suggestion = original(normalized_payload, local_vision=local_vision)
        if not repaired:
            return suggestion
        raw = dict(suggestion.raw)
        raw["candidate_identity_shape_repaired"] = True
        raw["candidate_identity_shape_repair"] = "prizm_parallel_encoded_as_set_name"
        return suggestion.model_copy(update={"raw": raw})

    runtime._candidate_response_to_suggestion = guarded_candidate_response_to_suggestion
    runtime._instacomp_candidate_identity_guard_installed = True
