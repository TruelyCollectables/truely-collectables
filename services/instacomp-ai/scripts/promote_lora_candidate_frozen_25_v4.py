#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_five as base


_original_expansion_candidate = v3._expansion_candidate


def _meaningful_variant_marker(identity: dict[str, Any]) -> str | None:
    """Return only a real non-base variant marker.

    Set names and ordinary Base labels are identity context, not parallel markers.
    Exact set identity is owned by the live authoritative Registry UUID/fingerprint
    lock. This marker exists only to stop a teacher row for a visibly distinct
    parallel/variation/subset from being accepted as another Registry variant.
    """
    raw_values = [
        base.norm(identity.get("parallel")),
        base.norm(identity.get("variation")),
        base.norm(identity.get("subset")),
    ]
    generic = {
        "",
        "base",
        "regular",
        "standard",
        "none",
        "n/a",
        "na",
    }
    values = [value for value in raw_values if value not in generic]
    if not values:
        return None

    joined = " ".join(values)
    for token in (
        "cracked ice",
        "ice",
        "groovy",
        "silver",
        "green",
        "red",
        "blue",
        "orange",
        "purple",
        "gold",
        "black",
        "velocity",
        "wave",
        "mojo",
        "scope",
        "hyper",
        "pulsar",
    ):
        if token in joined:
            return token

    # Preserve an explicit uncommon teacher variant instead of silently dropping
    # it. The live Registry lock must contain this value in parallel/variation/
    # subset context before the row can be admitted.
    return values[0][:80]


def _expansion_candidate(
    row: dict[str, Any],
    *,
    require_images: bool,
) -> dict[str, Any] | None:
    item = _original_expansion_candidate(row, require_images=require_images)
    if item is not None:
        item["marker"] = _meaningful_variant_marker(item["identity"])
    return item


def _registry_identity_matches_teacher(teacher: dict[str, Any], registry: Any) -> bool:
    locked = getattr(registry, "identity", None)
    if locked is None:
        return False
    locked_payload = (
        locked.model_dump(mode="json")
        if hasattr(locked, "model_dump")
        else dict(locked)
    )
    if base.norm(locked_payload.get("player")) != base.norm(teacher.get("player")):
        return False
    if (
        base.norm(locked_payload.get("card_number")).lstrip("#")
        != base.norm(teacher.get("card_number")).lstrip("#")
    ):
        return False

    marker = _meaningful_variant_marker(teacher)
    if marker:
        registry_variants = " ".join(
            base.norm(locked_payload.get(key))
            for key in ("parallel", "variation", "subset")
        )
        if marker not in registry_variants:
            return False
    return True


def _install_contract_fix() -> None:
    # v3's preflight resolves these helpers from its module globals at runtime.
    # Override only the broken variant-marker semantics; all live Registry,
    # metadata-conflict, uniqueness, pre-activation, rollback, and round gates
    # remain v3's implementation.
    v3._expansion_candidate = _expansion_candidate
    v3._registry_identity_matches_teacher = _registry_identity_matches_teacher


def main() -> int:
    _install_contract_fix()
    result = v3.main()
    return result


if __name__ == "__main__":
    raise SystemExit(main())
