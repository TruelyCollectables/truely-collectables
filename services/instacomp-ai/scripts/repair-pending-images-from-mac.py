#!/usr/bin/env python3
"""Push archived InstaComp front/back scans from the physical Mac to Supabase.

This script intentionally runs on the Mac that owns the local InstaComp archive.
Production cannot pull from 127.0.0.1 on that Mac, so recovery must originate here.

Run from the repository root with Production environment variables injected:

    npx vercel env run -e production -- \
      python3 services/instacomp-ai/scripts/repair-pending-images-from-mac.py

The script repairs private draft records only. It never publishes inventory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


SERVICE_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ENV_PATH = SERVICE_ROOT / ".env"
BUCKET = "instacomp-listing-images"
PAGE_SIZE = 1000


class RecoveryError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_local_env(path: Path) -> dict[str, str]:
    """Read simple KEY=VALUE pairs without replacing injected Production values."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def resolve_local_path(value: str | None, default: str) -> Path:
    candidate = Path(value or default).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (SERVICE_ROOT / candidate).resolve()


def json_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def text_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def normalized_title(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


class SupabaseRest:
    def __init__(self, base_url: str, service_key: str):
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: Any | None = None,
        raw_body: bytes | None = None,
        headers: dict[str, str] | None = None,
        expected: tuple[int, ...] = (200, 201, 204),
    ) -> tuple[int, bytes, dict[str, str]]:
        request_headers = {
            "Authorization": f"Bearer {self.service_key}",
            "apikey": self.service_key,
        }
        if headers:
            request_headers.update(headers)
        body = raw_body
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=90) as response:
                status = response.status
                response_body = response.read()
                response_headers = dict(response.headers.items())
        except HTTPError as error:
            response_body = error.read()
            detail = response_body.decode("utf-8", errors="replace")[:1200]
            if error.code in expected:
                return error.code, response_body, dict(error.headers.items())
            raise RecoveryError(
                f"{method} {path} returned HTTP {error.code}: {detail}"
            ) from error
        except URLError as error:
            raise RecoveryError(f"Could not reach Supabase: {error.reason}") from error
        if status not in expected:
            detail = response_body.decode("utf-8", errors="replace")[:1200]
            raise RecoveryError(f"{method} {path} returned HTTP {status}: {detail}")
        return status, response_body, response_headers

    def json(
        self,
        method: str,
        path: str,
        *,
        payload: Any | None = None,
        headers: dict[str, str] | None = None,
        expected: tuple[int, ...] = (200, 201, 204),
    ) -> Any:
        _, body, _ = self._request(
            method,
            path,
            payload=payload,
            headers=headers,
            expected=expected,
        )
        if not body:
            return None
        return json.loads(body.decode("utf-8"))

    def upload_jpeg(self, object_path: str, content: bytes) -> str:
        encoded_path = quote(object_path, safe="/")
        self._request(
            "POST",
            f"/storage/v1/object/{BUCKET}/{encoded_path}",
            raw_body=content,
            headers={
                "Content-Type": "image/jpeg",
                "Cache-Control": "31536000",
                "x-upsert": "true",
            },
            expected=(200, 201),
        )
        return f"{self.base_url}/storage/v1/object/public/{BUCKET}/{encoded_path}"

    def ensure_bucket(self) -> None:
        encoded = quote(BUCKET, safe="")
        try:
            self._request("GET", f"/storage/v1/bucket/{encoded}", expected=(200,))
            return
        except RecoveryError as error:
            if "HTTP 404" not in str(error):
                raise
        self.json(
            "POST",
            "/storage/v1/bucket",
            payload={
                "id": BUCKET,
                "name": BUCKET,
                "public": True,
                "file_size_limit": 12 * 1024 * 1024,
                "allowed_mime_types": ["image/jpeg"],
            },
            expected=(200, 201),
        )

    def read_all_drafts(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        select = (
            "id,store_id,legacy_product_id,seller_account_id,sku,title,description,"
            "category,condition,status,quantity,price,metadata,created_at"
        )
        while True:
            query = urlencode(
                {
                    "select": select,
                    "status": "eq.draft",
                    "order": "created_at.asc",
                }
            )
            batch = self.json(
                "GET",
                f"/rest/v1/inventory_items?{query}",
                headers={"Range": f"{offset}-{offset + PAGE_SIZE - 1}"},
                expected=(200, 206),
            )
            if not isinstance(batch, list):
                raise RecoveryError("Supabase returned an invalid inventory response.")
            rows.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
        return rows

    def find_product_by_sku(self, store_id: str, sku: str) -> list[dict[str, Any]]:
        query = urlencode(
            {
                "select": "id,title,seller_account_id,image_url",
                "store_id": f"eq.{store_id}",
                "sku": f"eq.{sku}",
                "limit": "2",
            }
        )
        result = self.json("GET", f"/rest/v1/products?{query}")
        return result if isinstance(result, list) else []

    def update_product_image(self, store_id: str, product_id: int, front_url: str) -> None:
        query = urlencode({"id": f"eq.{product_id}", "store_id": f"eq.{store_id}"})
        self.json(
            "PATCH",
            f"/rest/v1/products?{query}",
            payload={"image_url": front_url, "last_seen_at": utc_now()},
            headers={"Prefer": "return=minimal"},
        )

    def create_product(self, row: dict[str, Any], front_url: str) -> int:
        metadata = json_record(row.get("metadata"))
        insta = json_record(metadata.get("instacomp"))
        ai = json_record(insta.get("ai"))
        payload = {
            "store_id": row["store_id"],
            "seller_account_id": row.get("seller_account_id"),
            "sku": row.get("sku"),
            "title": row.get("title") or "Untitled item",
            "description": row.get("description") or "",
            "price": float(row.get("price") or 0),
            "quantity": max(0, int(row.get("quantity") or 0)),
            "image_url": front_url,
            "ebay_item_id": None,
            "player": text_value(ai.get("player")) or text_value(ai.get("playerName")),
            "sport": text_value(ai.get("sport")),
            "last_seen_at": utc_now(),
        }
        result = self.json(
            "POST",
            "/rest/v1/products?select=id",
            payload=payload,
            headers={"Prefer": "return=representation"},
        )
        if not isinstance(result, list) or not result or not result[0].get("id"):
            raise RecoveryError("Supabase did not return the created product ID.")
        return int(result[0]["id"])

    def replace_inventory_images(
        self,
        inventory_item_id: str,
        title: str,
        front_url: str,
        back_url: str,
    ) -> None:
        query = urlencode({"inventory_item_id": f"eq.{inventory_item_id}"})
        self.json(
            "DELETE",
            f"/rest/v1/inventory_images?{query}",
            headers={"Prefer": "return=minimal"},
        )
        self.json(
            "POST",
            "/rest/v1/inventory_images",
            payload=[
                {
                    "inventory_item_id": inventory_item_id,
                    "image_url": front_url,
                    "alt_text": f"{title} front",
                    "sort_order": 0,
                    "is_primary": True,
                },
                {
                    "inventory_item_id": inventory_item_id,
                    "image_url": back_url,
                    "alt_text": f"{title} back",
                    "sort_order": 1,
                    "is_primary": False,
                },
            ],
            headers={"Prefer": "return=minimal"},
        )

    def update_inventory_item(
        self,
        row: dict[str, Any],
        product_id: int,
        metadata: dict[str, Any],
    ) -> None:
        query = urlencode(
            {
                "id": f"eq.{row['id']}",
                "store_id": f"eq.{row['store_id']}",
                "status": "eq.draft",
            }
        )
        self.json(
            "PATCH",
            f"/rest/v1/inventory_items?{query}",
            payload={
                "legacy_product_id": product_id,
                "metadata": metadata,
                "updated_at": utc_now(),
            },
            headers={"Prefer": "return=minimal"},
        )


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def archived_image_path(root: Path, sha256: str, side: str) -> Path:
    primary = root / sha256[:2] / sha256[2:4] / f"{sha256}-{side}.jpg"
    if primary.is_file():
        return primary
    candidates = sorted(primary.parent.glob(f"{sha256}-{side}.*"))
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RecoveryError(f"Archived {side} image file is missing for hash {sha256[:12]}…")


def read_local_scan(database_path: Path, scan_id: str) -> dict[str, Any]:
    if not database_path.is_file():
        raise RecoveryError(f"Local scan database was not found at {database_path}")
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT scan_id,created_at,front_sha256,back_sha256,image_pair_sha256,status "
            "FROM scans WHERE scan_id = ?",
            (scan_id,),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise RecoveryError("The stored scan ID was not found in the Mac archive.")
    return dict(row)


def ensure_product(
    client: SupabaseRest,
    row: dict[str, Any],
    front_url: str,
) -> int:
    current_id = row.get("legacy_product_id")
    if current_id is not None:
        product_id = int(current_id)
        client.update_product_image(str(row["store_id"]), product_id, front_url)
        return product_id

    sku = text_value(row.get("sku"))
    if sku:
        matches = client.find_product_by_sku(str(row["store_id"]), sku)
        if len(matches) > 1:
            raise RecoveryError(f"Multiple products already use SKU {sku}; recovery stopped.")
        if matches:
            match = matches[0]
            if normalized_title(match.get("title")) != normalized_title(row.get("title")):
                raise RecoveryError(
                    f"SKU {sku} belongs to a different product title; recovery stopped."
                )
            product_id = int(match["id"])
            client.update_product_image(str(row["store_id"]), product_id, front_url)
            return product_id

    return client.create_product(row, front_url)


def recovered_metadata(
    row: dict[str, Any],
    scan: dict[str, Any],
    front_url: str,
    back_url: str,
) -> dict[str, Any]:
    metadata = dict(json_record(row.get("metadata")))
    insta = dict(json_record(metadata.get("instacomp")))
    recovered_at = utc_now()
    insta.update(
        {
            "scanId": scan["scan_id"],
            "frontSha256": scan["front_sha256"],
            "backSha256": scan["back_sha256"],
            "imagePairSha256": scan["image_pair_sha256"],
            "hasBackImage": True,
            "imageRequirement": "front_and_back_required_for_listing",
            "imageRecoveryStatus": "recovered_by_mac_local_push",
            "imageRecoveredAt": recovered_at,
            "recoveredImageUrls": {"front": front_url, "back": back_url},
            "sourceImageUrls": [front_url, back_url],
        }
    )
    metadata["instacomp"] = insta
    metadata["ebay_image_urls"] = [front_url, back_url]
    seller_review = dict(json_record(metadata.get("seller_review")))
    seller_review.update(
        {
            "identity_confirmed": False,
            "confirmed_at": None,
            "confirmed_by": None,
            "confirmed_account_id": None,
            "reset_at": recovered_at,
            "reset_reason": "original_front_back_images_recovered_from_mac",
        }
    )
    metadata["seller_review"] = seller_review
    return metadata


def repair_row(
    client: SupabaseRest,
    row: dict[str, Any],
    database_path: Path,
    image_root: Path,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    metadata = json_record(row.get("metadata"))
    insta = json_record(metadata.get("instacomp"))
    scan_id = text_value(insta.get("scanId"))
    if not scan_id:
        raise RecoveryError("Pending draft has no Mac scan ID.")

    scan = read_local_scan(database_path, scan_id)
    front_sha = text_value(scan.get("front_sha256"))
    back_sha = text_value(scan.get("back_sha256"))
    if not front_sha or not back_sha:
        raise RecoveryError("The Mac scan receipt does not contain both image hashes.")
    if front_sha == back_sha:
        raise RecoveryError("The archived front and back hashes are identical.")

    front_path = archived_image_path(image_root, front_sha, "front")
    back_path = archived_image_path(image_root, back_sha, "back")
    front_bytes = front_path.read_bytes()
    back_bytes = back_path.read_bytes()
    if sha256_bytes(front_bytes) != front_sha:
        raise RecoveryError("The front image does not match its Mac scan receipt.")
    if sha256_bytes(back_bytes) != back_sha:
        raise RecoveryError("The back image does not match its Mac scan receipt.")

    if dry_run:
        return {
            "inventory_item_id": row["id"],
            "title": row.get("title"),
            "scan_id": scan_id,
            "front_path": str(front_path),
            "back_path": str(back_path),
            "dry_run": True,
        }

    account_segment = str(row.get("seller_account_id") or "store-owner")
    base_path = f"accounts/{account_segment}/inventory/{row['id']}"
    front_object = f"{base_path}/{scan_id}-{front_sha}-front.jpg"
    back_object = f"{base_path}/{scan_id}-{back_sha}-back.jpg"
    front_url = client.upload_jpeg(front_object, front_bytes)
    back_url = client.upload_jpeg(back_object, back_bytes)
    product_id = ensure_product(client, row, front_url)
    client.replace_inventory_images(
        str(row["id"]),
        str(row.get("title") or "Untitled item"),
        front_url,
        back_url,
    )
    next_metadata = recovered_metadata(row, scan, front_url, back_url)
    client.update_inventory_item(row, product_id, next_metadata)
    return {
        "inventory_item_id": row["id"],
        "title": row.get("title"),
        "scan_id": scan_id,
        "product_id": product_id,
        "front_url": front_url,
        "back_url": back_url,
        "dry_run": False,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recover pending InstaComp front/back images from the physical Mac archive."
    )
    parser.add_argument("--item-id", action="append", default=[], help="Repair only this inventory item ID. May be repeated.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum drafts to inspect (default: 500).")
    parser.add_argument("--dry-run", action="store_true", help="Verify local archive matches without changing Supabase.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    local_env = load_local_env(LOCAL_ENV_PATH)
    supabase_url = (
        os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        or os.getenv("SUPABASE_URL")
        or local_env.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            "ERROR: Production Supabase variables are missing. Run this through "
            "`npx vercel env run -e production -- python3 ...`.",
            file=sys.stderr,
        )
        return 2

    database_path = resolve_local_path(
        os.getenv("INSTACOMP_AI_DATABASE_PATH")
        or local_env.get("INSTACOMP_AI_DATABASE_PATH"),
        "./data/instacomp_ai.sqlite3",
    )
    image_root = resolve_local_path(
        os.getenv("INSTACOMP_AI_IMAGE_STORE_PATH")
        or local_env.get("INSTACOMP_AI_IMAGE_STORE_PATH"),
        "./data/images",
    )
    client = SupabaseRest(supabase_url, service_key)
    if not args.dry_run:
        client.ensure_bucket()

    requested = set(args.item_id)
    candidates: list[dict[str, Any]] = []
    for row in client.read_all_drafts():
        if requested and str(row.get("id")) not in requested:
            continue
        metadata = json_record(row.get("metadata"))
        insta = json_record(metadata.get("instacomp"))
        if not text_value(insta.get("scanId")):
            continue
        candidates.append(row)
        if len(candidates) >= max(1, args.limit):
            break

    if requested:
        found = {str(row.get("id")) for row in candidates}
        missing = requested - found
        if missing:
            print(f"WARNING: requested draft IDs were not found: {', '.join(sorted(missing))}")

    if not candidates:
        print("No private InstaComp drafts with Mac scan IDs were found.")
        return 0

    action = "Verifying" if args.dry_run else "Recovering"
    print(f"{action} {len(candidates)} pending InstaComp draft(s) from the Mac archive…")
    repaired = 0
    failed = 0
    for index, row in enumerate(candidates, start=1):
        title = str(row.get("title") or row.get("id"))
        try:
            result = repair_row(
                client,
                row,
                database_path,
                image_root,
                dry_run=args.dry_run,
            )
            repaired += 1
            print(f"[{index}/{len(candidates)}] OK  {title}")
            if args.dry_run:
                print(f"    front: {result['front_path']}")
                print(f"    back:  {result['back_path']}")
        except Exception as error:  # bounded batch: report every draft rather than stopping early
            failed += 1
            print(f"[{index}/{len(candidates)}] FAIL {title}: {error}", file=sys.stderr)

    label = "verified" if args.dry_run else "repaired"
    print(f"Finished: {repaired} {label}, {failed} failed.")
    print("No listings were published.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
