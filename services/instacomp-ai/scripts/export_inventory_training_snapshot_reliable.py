#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

import export_inventory_training_snapshot as target

# Supabase Management database/query can emit the non-standard 544 status when
# its upstream database connection times out. Treat it as transport-transient;
# definite auth/schema failures remain fail-closed.
target.TRANSIENT_HTTP.add(544)

# Preserve the bounded single-query Management API reader as a hardened fallback
# contract even though the current Production snapshot path prefers authenticated
# Supabase REST. This keeps one consistent recovery path available when REST is
# unsuitable and prevents regression of the 57P03/544 recovery behavior.
PRODUCTION_BATCH_SIZE = 500
SUCCESS_BATCH_PACE_SECONDS = 0.5
DATABASE_RECOVERY_DELAYS_SECONDS = (15, 30, 45, 60)

REST_PAGE_SIZE = 1000
REST_MAX_ROWS_PER_TABLE = 100_000
REST_MAX_ATTEMPTS = 8
REST_TRANSIENT_HTTP = {
    408, 425, 429, 500, 502, 503, 504,
    520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 544,
}
INTEGER_ID_TABLES = {"products"}
_sleep = time.sleep


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
        modern.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return modern[0][2]
    if legacy_service_role:
        return legacy_service_role
    raise SystemExit("Could not resolve a Production elevated key for snapshot encryption")


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


# Keep the hardened direct-DB implementation available to callers/tests that
# explicitly rely on the audited Management API fallback contract.
target._fetch_inventory_batch = _fetch_inventory_batch_single_query


def _supabase_rest_headers(server_key: str) -> dict[str, str]:
    key = str(server_key or "").strip()
    if not key:
        raise ValueError("Supabase server key is required")
    headers = {
        "apikey": key,
        "Accept": "application/json",
        "User-Agent": "TruelyCollectables-InstaComp-InventorySnapshot/4.0",
    }
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _decode_json(raw: bytes) -> object:
    text = raw.decode("utf-8", "replace")
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _payload_code(payload: object) -> str:
    if isinstance(payload, dict):
        return str(payload.get("code") or "").strip()
    return ""


def _retry_after_seconds(headers: Any) -> float | None:
    raw = str(headers.get("Retry-After") or headers.get("retry-after") or "").strip()
    if not raw:
        return None
    try:
        value = min(float(raw), 30.0)
    except ValueError:
        return None
    return value if value > 0 else None


def _retry_delay_seconds(attempt: int, headers: Any | None = None) -> float:
    if headers is not None:
        retry_after = _retry_after_seconds(headers)
        if retry_after is not None:
            return retry_after
    return min(0.75 * (2 ** max(0, attempt - 1)), 12.0)


def _canonical_id(value: object, *, table: str) -> str:
    raw = str(value).strip()
    if table in INTEGER_ID_TABLES:
        try:
            parsed = int(raw)
        except (ValueError, TypeError) as exc:
            raise RuntimeError(f"Supabase REST {table} returned a non-integer id") from exc
        if parsed < 0:
            raise RuntimeError(f"Supabase REST {table} returned a negative id")
        return str(parsed)
    try:
        return str(uuid.UUID(raw))
    except (ValueError, TypeError, AttributeError) as exc:
        raise RuntimeError(f"Supabase REST {table} returned a non-UUID id") from exc


def _id_order_value(value: object, *, table: str) -> int:
    canonical = _canonical_id(value, table=table)
    if table in INTEGER_ID_TABLES:
        return int(canonical)
    return uuid.UUID(canonical).int


def _rest_get_page(
    ref: str,
    server_key: str,
    table: str,
    *,
    last_id: str | None,
    page_size: int,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "select": "*",
        "order": "id.asc",
        "limit": str(int(page_size)),
    }
    if last_id is not None:
        params["id"] = f"gt.{_canonical_id(last_id, table=table)}"
    url = f"https://{ref}.supabase.co/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = _supabase_rest_headers(server_key)

    for attempt in range(1, REST_MAX_ATTEMPTS + 1):
        request = urllib.request.Request(url, method="GET", headers=headers)
        response_headers: Any = {}
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status = int(response.status)
                response_headers = response.headers
                raw = response.read()
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            response_headers = exc.headers
            raw = exc.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt >= REST_MAX_ATTEMPTS:
                raise RuntimeError(
                    f"Supabase REST {table} transport failure after {REST_MAX_ATTEMPTS} attempts: "
                    f"{type(exc).__name__}: {exc}"
                ) from exc
            delay = _retry_delay_seconds(attempt)
            print(
                f"RETRY Supabase REST {table}: {type(exc).__name__}; "
                f"retrying {attempt + 1}/{REST_MAX_ATTEMPTS} in {delay:.2f}s",
                flush=True,
            )
            _sleep(delay)
            continue

        payload = _decode_json(raw)
        if status in {200, 206}:
            if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
                raise RuntimeError(f"Supabase REST {table} returned an unexpected payload")
            return [dict(row) for row in payload]

        code = _payload_code(payload)
        retryable = status in REST_TRANSIENT_HTTP or code == "PGRST002"
        if retryable and attempt < REST_MAX_ATTEMPTS:
            delay = _retry_delay_seconds(attempt, response_headers)
            detail = f" {code}" if code else ""
            print(
                f"RETRY Supabase REST {table}: HTTP {status}{detail}; "
                f"retrying {attempt + 1}/{REST_MAX_ATTEMPTS} in {delay:.2f}s",
                flush=True,
            )
            _sleep(delay)
            continue
        raise RuntimeError(
            f"Supabase REST {table} failed: HTTP {status}: {str(payload)[:500]}"
        )

    raise RuntimeError(f"Supabase REST {table} unexpectedly exhausted retries")


def _fetch_rest_table(
    ref: str,
    server_key: str,
    table: str,
    *,
    page_size: int = REST_PAGE_SIZE,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    last_id: str | None = None
    last_order_value: int | None = None

    while True:
        page = _rest_get_page(
            ref,
            server_key,
            table,
            last_id=last_id,
            page_size=page_size,
        )
        for row in page:
            raw_id = row.get("id")
            if raw_id is None or str(raw_id).strip() == "":
                raise RuntimeError(f"Supabase REST {table} returned a row without id")
            row_id = _canonical_id(raw_id, table=table)
            current_order_value = _id_order_value(row_id, table=table)
            if last_order_value is not None and current_order_value <= last_order_value:
                raise RuntimeError(f"Supabase REST {table} keyset order is not strictly increasing")
            if row_id in seen_ids:
                raise RuntimeError(f"Supabase REST {table} returned duplicate id {row_id}")
            seen_ids.add(row_id)
            rows.append(row)
            last_id = row_id
            last_order_value = current_order_value

        print(
            f"SNAPSHOT REST table={table} rows={len(rows)} page={len(page)}",
            flush=True,
        )
        if len(rows) > REST_MAX_ROWS_PER_TABLE:
            raise SystemExit(
                f"{table} exceeded REST_MAX_ROWS_PER_TABLE={REST_MAX_ROWS_PER_TABLE}; "
                "refusing incomplete snapshot"
            )
        if len(page) < page_size:
            break

    return rows


def _project_rows(table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    desired = target.DESIRED_COLUMNS[table]
    required = target.REQUIRED_COLUMNS[table]
    projected: list[dict[str, Any]] = []
    for row in rows:
        missing = sorted(column for column in required if column not in row)
        if missing:
            raise SystemExit(f"Production schema missing required {table} columns: {missing}")
        projected.append({column: row[column] for column in desired if column in row})
    return projected


def _build_snapshot_via_rest(token: str, ref: str) -> dict[str, Any]:
    # Management database/query remains available above as a bounded recovery
    # fallback contract. Production's primary table reads use authenticated REST
    # to avoid per-batch Management connection churn.
    server_key = _resolve_snapshot_encryption_key(token, ref)

    raw_items = _fetch_rest_table(ref, server_key, "inventory_items")
    raw_images = _fetch_rest_table(ref, server_key, "inventory_images")
    raw_attributes = _fetch_rest_table(ref, server_key, "inventory_attributes")
    raw_products = _fetch_rest_table(ref, server_key, "products")

    items = _project_rows("inventory_items", raw_items)
    item_ids = {str(row.get("id") or "").strip() for row in items}
    images = [
        row for row in _project_rows("inventory_images", raw_images)
        if str(row.get("inventory_item_id") or "").strip() in item_ids
    ]
    attributes = [
        row for row in _project_rows("inventory_attributes", raw_attributes)
        if str(row.get("inventory_item_id") or "").strip() in item_ids
    ]

    legacy_product_ids = {
        str(row.get("legacy_product_id") or "").strip()
        for row in items if row.get("legacy_product_id")
    }
    card_uuids = {
        str(row.get("card_uuid") or "").strip()
        for row in items if row.get("card_uuid")
    }
    products = [
        row for row in _project_rows("products", raw_products)
        if (
            str(row.get("id") or "").strip() in legacy_product_ids
            or (
                str(row.get("card_uuid") or "").strip()
                and str(row.get("card_uuid") or "").strip() in card_uuids
            )
        )
    ]

    if not items:
        raise SystemExit("Refusing to publish empty inventory_items snapshot")
    row_counts = {
        "inventory_items": len(items),
        "inventory_images": len(images),
        "inventory_attributes": len(attributes),
        "products": len(products),
    }
    collx_rows = sum(
        1 for row in items if str(row.get("sku") or "").strip().upper().startswith("COLLX-")
    )
    return {
        "schema_version": target.SNAPSHOT_SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "supabase_authenticated_rest_type_aware_keyset_v2",
        "source_git_sha": __import__("os").environ.get("GITHUB_SHA"),
        "row_counts": row_counts,
        "collx_inventory_rows": collx_rows,
        "tables": {
            "inventory_items": items,
            "inventory_images": images,
            "inventory_attributes": attributes,
            "products": products,
        },
    }


# Keep target.main() as the audited envelope/output implementation. Primary
# Production reads stay on authenticated REST; the Management fallback above is
# intentionally retained and regression-tested rather than silently deleted.
target._resolve_service_role_key = _resolve_snapshot_encryption_key
target.build_snapshot = _build_snapshot_via_rest


if __name__ == "__main__":
    raise SystemExit(target.main())
