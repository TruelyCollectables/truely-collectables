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

REST_PAGE_SIZE = 1000
REST_MAX_ROWS_PER_TABLE = 100_000
REST_MAX_ATTEMPTS = 8
REST_TRANSIENT_HTTP = {
    408, 425, 429, 500, 502, 503, 504,
    520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 544,
}
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
        params["id"] = f"gt.{uuid.UUID(str(last_id))}"
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


def _uuid_int(value: object, *, table: str) -> int:
    try:
        return uuid.UUID(str(value)).int
    except (ValueError, TypeError, AttributeError) as exc:
        raise RuntimeError(f"Supabase REST {table} returned a non-UUID id") from exc


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
    last_uuid_int: int | None = None

    while True:
        page = _rest_get_page(
            ref,
            server_key,
            table,
            last_id=last_id,
            page_size=page_size,
        )
        for row in page:
            row_id = str(row.get("id") or "").strip()
            if not row_id:
                raise RuntimeError(f"Supabase REST {table} returned a row without id")
            current_uuid_int = _uuid_int(row_id, table=table)
            if last_uuid_int is not None and current_uuid_int <= last_uuid_int:
                raise RuntimeError(f"Supabase REST {table} keyset order is not strictly increasing")
            if row_id in seen_ids:
                raise RuntimeError(f"Supabase REST {table} returned duplicate id {row_id}")
            seen_ids.add(row_id)
            rows.append(row)
            last_id = row_id
            last_uuid_int = current_uuid_int

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
    # Management database/query is intentionally not used here. It is currently
    # failing even for information_schema reads with HTTP 544 connection timeouts.
    # Management API remains only for project/key discovery; table reads use the
    # authenticated Production Data API with deterministic UUID keyset pagination.
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
        "source": "supabase_authenticated_rest_uuid_keyset_v1",
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


# Keep target.main() as the audited envelope/output implementation while swapping
# only the broken Production read path and the encryption-key resolver.
target._resolve_service_role_key = _resolve_snapshot_encryption_key
target.build_snapshot = _build_snapshot_via_rest


if __name__ == "__main__":
    raise SystemExit(target.main())
