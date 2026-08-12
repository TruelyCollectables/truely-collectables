#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MANAGEMENT_API = "https://api.supabase.com/v1"
SNAPSHOT_SCHEMA = "tcos.instacomp-ai.inventory-training-production-snapshot.v1"
ENVELOPE_SCHEMA = "tcos.instacomp-ai.inventory-training-encrypted-envelope.v1"
ENVELOPE_ALGORITHM = "openssl-aes-256-cbc-pbkdf2-sha256-hmac-v1"
DEFAULT_BATCH_SIZE = 50
MIN_BATCH_SIZE = 10
MAX_ITEMS = 100_000
TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526}

DESIRED_COLUMNS: dict[str, list[str]] = {
    "inventory_items": [
        "id", "store_id", "sku", "title", "description", "category",
        "price", "condition", "quantity", "legacy_product_id", "card_uuid", "metadata",
    ],
    "inventory_images": [
        "id", "inventory_item_id", "image_url", "alt_text", "sort_order", "is_primary",
    ],
    "inventory_attributes": [
        "id", "inventory_item_id", "attribute_name", "attribute_value", "sort_order",
    ],
    "products": [
        "id", "card_uuid", "sku", "title", "description", "category", "image_url",
        "photos", "metadata", "sport", "league", "year", "season", "manufacturer",
        "brand", "set", "set_name", "subset", "player", "team", "card_number",
        "parallel", "variation", "serial_number", "serial_run", "rookie", "autograph",
        "inscription", "inscription_text", "memorabilia", "memorabilia_type",
    ],
}

REQUIRED_COLUMNS = {
    "inventory_items": {"id", "sku", "title"},
    "inventory_images": {"inventory_item_id", "image_url"},
    "inventory_attributes": {"inventory_item_id", "attribute_name", "attribute_value"},
    "products": {"id"},
}


class ManagementAPIError(RuntimeError):
    def __init__(self, status: int, payload: object, context: str):
        self.status = int(status)
        self.payload = payload
        self.context = context
        super().__init__(f"{context} failed: HTTP {status}: {str(payload)[:1000]}")


def _request(
    token: str,
    method: str,
    path: str,
    body: object | None = None,
    *,
    timeout: int = 180,
    retries: int = 8,
) -> object:
    data = None if body is None else json.dumps(body).encode("utf-8")
    last_transport: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(
            MANAGEMENT_API + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "TruelyCollectables-InstaComp-InventorySnapshot/3.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                status = int(response.status)
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            raw = exc.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            last_transport = exc
            if attempt >= retries:
                raise RuntimeError(
                    f"{method} {path} transport failure after {retries} attempts: "
                    f"{type(exc).__name__}: {exc}"
                ) from exc
            delay = min(2 ** (attempt - 1), 15)
            print(
                f"RETRY management API {method} {path}: {type(exc).__name__}; sleeping {delay}s",
                flush=True,
            )
            time.sleep(delay)
            continue

        text = raw.decode("utf-8", "replace")
        try:
            payload = json.loads(text) if text else None
        except json.JSONDecodeError:
            payload = text
        if status in {200, 201}:
            return payload
        if status in TRANSIENT_HTTP and attempt < retries:
            delay = min(2 ** (attempt - 1), 15)
            print(
                f"RETRY management API {method} {path}: HTTP {status}; sleeping {delay}s",
                flush=True,
            )
            time.sleep(delay)
            continue
        raise ManagementAPIError(status, payload, f"{method} {path}")

    raise RuntimeError(
        f"{method} {path} unexpectedly exhausted retries: "
        f"{type(last_transport).__name__ if last_transport else 'unknown'}"
    )


def _resolve_project_ref(token: str) -> str:
    projects = _request(token, "GET", "/projects", timeout=45)
    if not isinstance(projects, list):
        raise SystemExit("Supabase Management /projects returned an unexpected payload")
    candidates = [
        project
        for project in projects
        if isinstance(project, dict)
        and (
            "truely" in str(project.get("name") or "").lower()
            or "collect" in str(project.get("name") or "").lower()
        )
    ]
    if len(candidates) != 1:
        raise SystemExit(f"Expected exactly one Truely Collectables Supabase project, got {len(candidates)}")
    ref = str(candidates[0].get("id") or candidates[0].get("ref") or "").strip()
    if not ref:
        raise SystemExit("Could not resolve Supabase project ref")
    return ref


def _resolve_service_role_key(token: str, ref: str) -> str:
    payload = _request(token, "GET", f"/projects/{ref}/api-keys?reveal=true", timeout=45)
    if not isinstance(payload, list):
        raise SystemExit("Could not retrieve project API keys for encrypted snapshot transport")
    for row in payload:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip().lower().replace("-", "_").replace(" ", "_")
        candidate = str(row.get("api_key") or "").strip()
        if candidate and name == "service_role":
            return candidate
    raise SystemExit("Could not resolve the Production service_role key for snapshot encryption")


def _sql(token: str, ref: str, query: str) -> list[dict[str, Any]]:
    payload = _request(
        token,
        "POST",
        f"/projects/{ref}/database/query",
        {"query": query, "parameters": [], "read_only": True},
        timeout=180,
    )
    if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
        raise RuntimeError("Supabase Management database/query returned an unexpected payload")
    return [dict(row) for row in payload]


def _is_statement_timeout(exc: ManagementAPIError) -> bool:
    text = str(exc.payload).lower()
    return exc.status == 400 and (
        "57014" in text
        or "statement timeout" in text
        or "canceling statement" in text
    )


def _existing_columns(token: str, ref: str, table: str) -> list[str]:
    if table not in DESIRED_COLUMNS:
        raise ValueError(f"Unknown snapshot table {table}")
    table_literal = table.replace("'", "''")
    rows = _sql(
        token,
        ref,
        "select column_name from information_schema.columns "
        f"where table_schema='public' and table_name='{table_literal}' "
        "order by ordinal_position;",
    )
    available = {str(row.get("column_name") or "") for row in rows}
    selected = [column for column in DESIRED_COLUMNS[table] if column in available]
    missing = sorted(REQUIRED_COLUMNS[table] - set(selected))
    if missing:
        raise SystemExit(f"Production schema missing required {table} columns: {missing}")
    return selected


def _select_list(columns: dict[str, list[str]], table: str, alias: str | None = None) -> str:
    prefix = f"{alias}." if alias else ""
    return ",".join(f'{prefix}"{column}"' for column in columns[table])


def _uuid_literals(values: list[object]) -> str:
    return ",".join(f"'{uuid.UUID(str(value))}'::uuid" for value in values)


def _fetch_inventory_batch(
    token: str,
    ref: str,
    columns: dict[str, list[str]],
    *,
    last_id: str | None,
    batch_size: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    where = "" if last_id is None else f"where id > '{uuid.UUID(str(last_id))}'::uuid"
    item_page = _sql(
        token,
        ref,
        f'select {_select_list(columns, "inventory_items")} '
        f'from public.inventory_items {where} order by id limit {int(batch_size)};',
    )
    if not item_page:
        return [], [], [], []
    if len(item_page) > batch_size:
        raise RuntimeError("Management API returned more inventory rows than requested")
    page_ids = [row.get("id") for row in item_page]
    if any(not value for value in page_ids):
        raise RuntimeError("Inventory snapshot page contained a row without id")
    id_sql = _uuid_literals(page_ids)

    image_page = _sql(
        token,
        ref,
        f'select {_select_list(columns, "inventory_images")} '
        f'from public.inventory_images where inventory_item_id in ({id_sql}) '
        'order by inventory_item_id;',
    )
    attribute_page = _sql(
        token,
        ref,
        f'select {_select_list(columns, "inventory_attributes")} '
        f'from public.inventory_attributes where inventory_item_id in ({id_sql}) '
        'order by inventory_item_id;',
    )

    product_page = _sql(
        token,
        ref,
        f'select {_select_list(columns, "products", "p")} from public.products p '
        'where p.id in ('
        'select i.legacy_product_id from public.inventory_items i '
        f'where i.id in ({id_sql}) and i.legacy_product_id is not null'
        ') order by p.id;',
    )
    if "card_uuid" in columns["inventory_items"] and "card_uuid" in columns["products"]:
        product_page += _sql(
            token,
            ref,
            f'select {_select_list(columns, "products", "p")} from public.products p '
            'where p.card_uuid in ('
            'select i.card_uuid from public.inventory_items i '
            f'where i.id in ({id_sql}) and i.card_uuid is not null'
            ') order by p.id;',
        )
    return item_page, image_page, attribute_page, product_page


def build_snapshot(token: str, ref: str) -> dict[str, Any]:
    columns = {table: _existing_columns(token, ref, table) for table in DESIRED_COLUMNS}
    items: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    attributes: list[dict[str, Any]] = []
    products_by_id: dict[str, dict[str, Any]] = {}
    last_id: str | None = None
    batch_size = DEFAULT_BATCH_SIZE

    while True:
        if len(items) >= MAX_ITEMS:
            raise SystemExit(f"inventory_items exceeded MAX_ITEMS={MAX_ITEMS}; refusing incomplete snapshot")
        try:
            item_page, image_page, attribute_page, product_page = _fetch_inventory_batch(
                token,
                ref,
                columns,
                last_id=last_id,
                batch_size=batch_size,
            )
        except ManagementAPIError as exc:
            if _is_statement_timeout(exc) and batch_size > MIN_BATCH_SIZE:
                previous = batch_size
                batch_size = max(MIN_BATCH_SIZE, batch_size // 2)
                print(
                    f"SHRINK direct DB inventory batch after PostgreSQL statement timeout: "
                    f"{previous}->{batch_size} cards",
                    flush=True,
                )
                continue
            raise

        if not item_page:
            break
        items.extend(item_page)
        images.extend(image_page)
        attributes.extend(attribute_page)
        for product in product_page:
            product_id = str(product.get("id") or "").strip()
            if product_id:
                products_by_id[product_id] = product
        last_id = str(item_page[-1]["id"])
        print(
            "SNAPSHOT direct DB batch "
            f"size={batch_size} items={len(items)} images={len(images)} "
            f"attributes={len(attributes)} linked_products={len(products_by_id)}",
            flush=True,
        )
        if len(item_page) < batch_size:
            break

    if not items:
        raise SystemExit("Refusing to publish empty inventory_items snapshot")
    item_ids = [str(row.get("id") or "") for row in items]
    if len(set(item_ids)) != len(item_ids):
        raise SystemExit("Duplicate inventory item IDs detected in keyset snapshot")

    products = [products_by_id[key] for key in sorted(products_by_id)]
    tables = {
        "inventory_items": items,
        "inventory_images": images,
        "inventory_attributes": attributes,
        "products": products,
    }
    row_counts = {name: len(rows) for name, rows in tables.items()}
    collx_rows = sum(
        1 for row in items if str(row.get("sku") or "").strip().upper().startswith("COLLX-")
    )
    return {
        "schema_version": SNAPSHOT_SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "supabase_management_database_query_read_only_keyset_v3",
        "source_git_sha": os.environ.get("GITHUB_SHA"),
        "row_counts": row_counts,
        "collx_inventory_rows": collx_rows,
        "tables": tables,
    }


def encrypt_snapshot(snapshot: dict[str, Any], service_key: str) -> dict[str, Any]:
    encoded = json.dumps(
        snapshot,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    compressed = gzip.compress(encoded, compresslevel=9, mtime=0)
    service_bytes = service_key.encode("utf-8")
    enc_pass = hashlib.sha256(b"instacomp-snapshot-encryption-v1\0" + service_bytes).hexdigest()
    mac_key = hashlib.sha256(b"instacomp-snapshot-mac-v1\0" + service_bytes).digest()
    env = dict(os.environ)
    env["INSTACOMP_SNAPSHOT_ENC_PASS"] = enc_pass
    encrypted = subprocess.run(
        [
            "openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt",
            "-pass", "env:INSTACOMP_SNAPSHOT_ENC_PASS",
        ],
        input=compressed,
        capture_output=True,
        check=False,
        env=env,
        timeout=180,
    )
    if encrypted.returncode != 0 or not encrypted.stdout:
        raise SystemExit("OpenSSL snapshot encryption failed")
    ciphertext = encrypted.stdout
    return {
        "schema_version": ENVELOPE_SCHEMA,
        "algorithm": ENVELOPE_ALGORITHM,
        "pbkdf2_iterations": 200000,
        "hmac_sha256": hmac.new(mac_key, ciphertext, hashlib.sha256).hexdigest(),
        "ciphertext_base64": base64.b64encode(ciphertext).decode("ascii"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Export encrypted read-only inventory training snapshot")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    token = str(os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is required")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::add-mask::{token}")

    ref = _resolve_project_ref(token)
    service_key = _resolve_service_role_key(token, ref)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::add-mask::{service_key}")

    snapshot = build_snapshot(token, ref)
    envelope = encrypt_snapshot(snapshot, service_key)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(envelope, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    size = args.output.stat().st_size
    if size >= 95 * 1024 * 1024:
        args.output.unlink(missing_ok=True)
        raise SystemExit(f"Encrypted snapshot is too large for safe Git transport: {size} bytes")

    print("SNAPSHOT_ROW_COUNTS=" + json.dumps(snapshot["row_counts"], sort_keys=True))
    print(f"SNAPSHOT_COLLX_ROWS={snapshot['collx_inventory_rows']}")
    print(f"ENCRYPTED_SNAPSHOT_BYTES={size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
