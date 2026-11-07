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
    card UUID wins. The inventory row itself is next authority because it is the
    stable key for that physical inventory record and must not be collapsed into
    a product-level UUID shared by multiple copies. UUID inventory IDs are used
    directly; legacy non-UUID inventory IDs receive a deterministic UUID5.
    Product card_uuid is used only when the inventory row has no key at all.
    """

    product = product or {}

    explicit_card_uuid = canonical_uuid(item.get("card_uuid"))
    if explicit_card_uuid:
        return explicit_card_uuid, "inventory_card_uuid"

    item_id = str(item.get("id") or "").strip()
    if item_id:
        inventory_uuid = canonical_uuid(item_id)
        if inventory_uuid:
            return inventory_uuid, "inventory_item_id"
        return (
            str(uuid5(NAMESPACE_URL, f"truelycollectables:inventory_item:{item_id}")),
            "inventory_item_id_uuid5",
        )

    product_uuid = canonical_uuid(product.get("card_uuid"))
    if product_uuid:
        return product_uuid, "product_card_uuid"

    return None, "missing_inventory_identity_key"
