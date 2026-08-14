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
# with one read-only SQL request instead and deliberately pace successful batches.
# The Production DB has also been observed to enter a short 57P03 recovery window
# during a long read. Keep the already-collected in-memory corpus and retry the
# exact same keyset batch instead of throwing the whole export away.
SUCCESS_BATCH_PACE_SECONDS = 2.0
DATABASE_RECOVERY_DELAYS_SECONDS = (15, 30, 45, 60)


def _resolve_snapshot_encryption_key(token: str, ref: str) -> str:
    """Prefer the current opaque Supabase secret key; retain legacy fallback."""
    payload = target._request(token, "GET", f"/projects/{ref}/api-keys?reveal=true", timeout=45)
    if not isinstance(payload, list):
        raise SystemExit("Could not retrieve project API keys for encrypted snapshot transport")

    modern: list[tuple[str, str, str]] = []
    legacy_service_role = ""
    for row in payload:
        if not isinstance(row, dict):
            continue
        candidate = str(row.get("api_key") or "").strip()
        if not candidate:
            continue
        name = str(row.get("name") or "").strip().lower().replace("-", "_").replace(" ", "_")
        inserted_at = str(row.get("inserted_at") or row.get("updated_at") or "").strip()
        if candidate.startswith("sb_secret_"):
            modern.append((inserted_at, name, candidate))
        elif name == "service_role":
            legacy_service_role = candidate

    if modern:
        # Rotation can temporarily leave more than one secret key active. Prefer
        # the newest one so scheduled snapshots converge on the current backend
        # credential without publishing or logging the key itself.
        modern.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return modern[0][2]
    if legacy_service_role:
        return legacy_service_role
    raise SystemExit("Could not resolve a Production elevated key for snapshot encryption")


# The base exporter historically encrypted snapshots only with the legacy
# service_role JWT. During migration the Mac/runtime can instead hold an opaque
# sb_secret_* key, whose bytes are intentionally different. Bind encryption to
# the newest current secret key when present while preserving legacy projects.
target._resolve_service_role_key = _resolve_snapshot_encryption_key


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


def _is_database_temporarily_unavailable(exc: target.ManagementAPIError) -> bool:
    text = str(exc.payload).lower()
    if exc.status == 544:
        return True
    return exc.status == 400 and (
        "57p03" in text
        or "database system is not accepting connections" in text
        or "hot standby mode is disabled" in text
        or "cannot connect now" in text
    )


def _sql_with_database_recovery(token: str, ref: str, query: str) -> list[dict[str, Any]]:
    for recovery_attempt in range(len(DATABASE_RECOVERY_DELAYS_SECONDS) + 1):
        try:
            return target._sql(token, ref, query)
        except target.ManagementAPIError as exc:
            if (
                not _is_database_temporarily_unavailable(exc)
                or recovery_attempt >= len(DATABASE_RECOVERY_DELAYS_SECONDS)
            ):
                raise
            delay = DATABASE_RECOVERY_DELAYS_SECONDS[recovery_attempt]
            print(
                "WAIT direct DB recovery after transient Production database unavailability: "
                f"HTTP {exc.status}; retrying same inventory batch in {delay}s",
                flush=True,
            )
            time.sleep(delay)
    raise RuntimeError("Unreachable direct DB recovery loop")


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
    result = _sql_with_database_recovery(token, ref, query)
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
