#!/usr/bin/env python3
from __future__ import annotations

import json
import time
import uuid
from typing import Any

import export_inventory_training_snapshot as target

# Supabase Management database/query can return 544 when its database connection
# times out before SQL execution. That is transient and must reconnect/retry just
# like the already-covered 52x origin/transport failures.
target.TRANSIENT_HTTP.add(544)

# The original exporter used four Management API database/query requests for every
# inventory batch (items, images, attributes, products). On a healthy Production
# database that eventually hit Management API 429 throttling, then a connection
# timeout, after thousands of otherwise-successful rows. Fetch each bounded batch
# with one read-only SQL request instead and pace successful batches so the full
# corpus can complete without hammering the Management control plane.
SUCCESS_BATCH_PACE_SECONDS = 0.75


def _json_rows(value: object, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Direct DB batch returned invalid JSON for {label}") from exc
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise RuntimeError(f"Direct DB batch returned an unexpected {label} payload")
    return [dict(row) for row in value]


def _fetch_inventory_batch_single_query(
    token: str,
    ref: str,
    columns: dict[str, list[str]],
    *,
    last_id: str | None,
    batch_size: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    where = "" if last_id is None else f"where i.id > '{uuid.UUID(str(last_id))}'::uuid"
    item_select = target._select_list(columns, "inventory_items", "i")
    image_select = target._select_list(columns, "inventory_images", "im")
    attribute_select = target._select_list(columns, "inventory_attributes", "a")
    product_select = target._select_list(columns, "products", "p")

    product_links = ["(i.legacy_product_id is not null and p.id = i.legacy_product_id)"]
    if "card_uuid" in columns["inventory_items"] and "card_uuid" in columns["products"]:
        product_links.append("(i.card_uuid is not null and p.card_uuid = i.card_uuid)")
    product_exists = " or ".join(product_links)

    query = f"""
with item_page as materialized (
  select {item_select}
  from public.inventory_items i
  {where}
  order by i.id
  limit {int(batch_size)}
),
image_page as materialized (
  select {image_select}
  from public.inventory_images im
  where exists (select 1 from item_page i where i.id = im.inventory_item_id)
),
attribute_page as materialized (
  select {attribute_select}
  from public.inventory_attributes a
  where exists (select 1 from item_page i where i.id = a.inventory_item_id)
),
product_page as materialized (
  select {product_select}
  from public.products p
  where exists (select 1 from item_page i where {product_exists})
)
select
  coalesce((select jsonb_agg(to_jsonb(ip) order by ip.id) from item_page ip), '[]'::jsonb) as inventory_items,
  coalesce((select jsonb_agg(to_jsonb(im) order by im.inventory_item_id) from image_page im), '[]'::jsonb) as inventory_images,
  coalesce((select jsonb_agg(to_jsonb(a) order by a.inventory_item_id) from attribute_page a), '[]'::jsonb) as inventory_attributes,
  coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from product_page p), '[]'::jsonb) as products;
"""
    result = target._sql(token, ref, query)
    if len(result) != 1:
        raise RuntimeError(f"Direct DB batch expected one aggregate row, got {len(result)}")
    aggregate = result[0]
    item_page = _json_rows(aggregate.get("inventory_items"), "inventory_items")
    image_page = _json_rows(aggregate.get("inventory_images"), "inventory_images")
    attribute_page = _json_rows(aggregate.get("inventory_attributes"), "inventory_attributes")
    product_page = _json_rows(aggregate.get("products"), "products")

    if len(item_page) > batch_size:
        raise RuntimeError("Management API returned more inventory rows than requested")
    if any(not row.get("id") for row in item_page):
        raise RuntimeError("Inventory snapshot page contained a row without id")

    if item_page:
        time.sleep(SUCCESS_BATCH_PACE_SECONDS)
    return item_page, image_page, attribute_page, product_page


target._fetch_inventory_batch = _fetch_inventory_batch_single_query


if __name__ == "__main__":
    raise SystemExit(target.main())
