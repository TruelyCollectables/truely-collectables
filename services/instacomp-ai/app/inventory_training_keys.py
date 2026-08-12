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
    """Resolve one stable local-learning UUID for a physical inventory card.

    Production inventory is intentionally read-only here. An explicit inventory
    card UUID wins. The inventory row UUID is the next authority because it is
    the stable key for that physical inventory record and must not be collapsed
    into a shared product-level UUID. Product card_uuid is only a final legacy
    fallback when the inventory row itself has no usable key. A deterministic
    UUID5 fallback keeps old non-UUID inventory primary keys stable.
    """

    product = product or {}
    candidates = (
        (item.get("card_uuid"), "inventory_card_uuid"),
        (item.get("id"), "inventory_item_id"),
        (product.get("card_uuid"), "product_card_uuid"),
    )
    for value, source in candidates:
        resolved = canonical_uuid(value)
        if resolved:
            return resolved, source

    item_id = str(item.get("id") or "").strip()
    if item_id:
        return str(uuid5(NAMESPACE_URL, f"truelycollectables:inventory_item:{item_id}")), "inventory_item_id_uuid5"
    return None, "missing_inventory_identity_key"
