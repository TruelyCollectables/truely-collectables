from __future__ import annotations

from typing import Any, Mapping
from uuid import NAMESPACE_URL, UUID, uuid5


def canonical_uuid(value: object) -> str | None:
    try:
        return str(UUID(str(value or "").strip()))
    except (ValueError, AttributeError, TypeError):
        return None


def resolve_inventory_learning_uuid(
    item: Mapping[str, Any],
    product: Mapping[str, Any] | None = None,
) -> tuple[str | None, str]:
    """Resolve one stable local-learning UUID for an inventory card.

    Production inventory is intentionally read-only here. Existing permanent
    card UUIDs win. Current inventory row IDs are already UUID primary keys in
    Production and are therefore the correct stable fallback when card_uuid has
    not been backfilled yet. A deterministic UUID5 fallback keeps the bridge
    stable even for a legacy non-UUID inventory primary key.
    """

    product = product or {}
    candidates = (
        (item.get("card_uuid"), "inventory_card_uuid"),
        (product.get("card_uuid"), "product_card_uuid"),
        (item.get("id"), "inventory_item_id"),
    )
    for value, source in candidates:
        resolved = canonical_uuid(value)
        if resolved:
            return resolved, source

    item_id = str(item.get("id") or "").strip()
    if item_id:
        return str(uuid5(NAMESPACE_URL, f"truelycollectables:inventory_item:{item_id}")), "inventory_item_id_uuid5"
    return None, "missing_inventory_identity_key"
