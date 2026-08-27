from __future__ import annotations

from collections import defaultdict
from typing import Any, Mapping


def attributes_by_item(rows: list[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index Production inventory_attributes using its real column names.

    Production uses attribute_name / attribute_value. name / value are retained
    only as compatibility fallbacks for old fixtures and archived receipts.
    """
    result: dict[str, dict[str, Any]] = defaultdict(dict)
    for row in rows:
        item_id = str(row.get("inventory_item_id") or "").strip()
        name = str(row.get("attribute_name") or row.get("name") or "").strip()
        if not item_id or not name:
            continue
        value = row.get("attribute_value") if "attribute_value" in row else row.get("value")
        result[item_id][name] = value
    return dict(result)


def canonical_inventory_image_row(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    # Production inventory_images uses image_url. Keep both keys so the rest of
    # the learning stack and older tests can consume a single canonical shape.
    image_url = str(row.get("image_url") or row.get("url") or "").strip()
    if image_url:
        payload["image_url"] = image_url
        payload["url"] = image_url
    return payload


def images_by_item(rows: list[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Index Production inventory_images without losing image_url."""
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        item_id = str(row.get("inventory_item_id") or "").strip()
        if item_id:
            result[item_id].append(canonical_inventory_image_row(row))
    for values in result.values():
        values.sort(
            key=lambda row: (
                0 if bool(row.get("is_primary")) else 1,
                int(row.get("sort_order") or 0),
                str(row.get("image_url") or row.get("url") or ""),
            )
        )
    return dict(result)
