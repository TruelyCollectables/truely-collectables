#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.images import pair_hash, persist_image, validate_and_normalize_image
from app.inventory_training import (
    extract_inventory_identity,
    identity_has_training_truth,
    inventory_item_is_card,
    select_inventory_images,
)
from app.models import ChecklistOutcome, ChecklistResult, LearningState, LessonCreate
from app.storage import MemoryStore, canonical_uuid_or_none
from app.training import latest_training_examples, training_readiness


RECEIPT_SCHEMA = "tcos.instacomp-ai.inventory-training-import.v1"
DEFAULT_RECEIPT = SERVICE_ROOT / "data" / "training" / "inventory-training-import-latest.json"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text("utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def _resolve_supabase_env() -> tuple[str, str, str]:
    candidates: dict[str, str] = dict(os.environ)
    for path in (
        REPO_ROOT / ".env.local",
        REPO_ROOT / ".env",
        SERVICE_ROOT / ".env.local",
        SERVICE_ROOT / ".env",
    ):
        for key, value in _parse_env_file(path).items():
            candidates.setdefault(key, value)

    def resolved() -> tuple[str | None, str | None]:
        url = candidates.get("NEXT_PUBLIC_SUPABASE_URL") or candidates.get("SUPABASE_URL")
        key = (
            candidates.get("SUPABASE_SERVICE_ROLE_KEY")
            or candidates.get("SUPABASE_SERVICE_KEY")
            or candidates.get("SUPABASE_SECRET_KEY")
        )
        return url, key

    url, key = resolved()
    source = "local_environment"

    if not url or not key:
        raise SystemExit(
            "Inventory training import requires NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY. They were not found in the local environment."
        )
    return url.rstrip("/"), key, source


class SupabaseReader:
    def __init__(self, base_url: str, service_key: str):
        self.rest_url = f"{base_url}/rest/v1"
        self.client = httpx.Client(
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Accept": "application/json",
            },
            timeout=httpx.Timeout(60.0),
            follow_redirects=True,
        )

    def close(self) -> None:
        self.client.close()

    def table(self, name: str, *, select: str = "*", page_size: int = 1000) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0
        while True:
            end = start + page_size - 1
            response = self.client.get(
                f"{self.rest_url}/{name}",
                params={"select": select},
                headers={"Range-Unit": "items", "Range": f"{start}-{end}"},
            )
            if response.status_code not in {200, 206}:
                raise SystemExit(
                    f"Read-only Supabase query failed for {name}: HTTP {response.status_code}: "
                    f"{response.text[:500]}"
                )
            page = response.json()
            if not isinstance(page, list):
                raise SystemExit(f"Unexpected Supabase payload for {name}")
            rows.extend(row for row in page if isinstance(row, dict))
            if len(page) < page_size:
                break
            start += page_size
        return rows


def _attributes_by_item(rows: list[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = defaultdict(dict)
    for row in rows:
        item_id = str(row.get("inventory_item_id") or "").strip()
        name = str(row.get("name") or "").strip()
        if item_id and name:
            result[item_id][name] = row.get("value")
    return dict(result)


def _images_by_item(rows: list[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        item_id = str(row.get("inventory_item_id") or "").strip()
        if item_id:
            result[item_id].append(dict(row))
    for values in result.values():
        values.sort(key=lambda row: (int(row.get("sort_order") or 0), str(row.get("url") or "")))
    return dict(result)


def _products_index(rows: list[Mapping[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_uuid: dict[str, dict[str, Any]] = {}
    for row in rows:
        payload = dict(row)
        product_id = str(row.get("id") or "").strip()
        card_uuid = canonical_uuid_or_none(row.get("card_uuid"))
        if product_id:
            by_id[product_id] = payload
        if card_uuid:
            by_uuid[card_uuid] = payload
    return by_id, by_uuid


def _product_for_item(
    item: Mapping[str, Any],
    *,
    by_id: Mapping[str, dict[str, Any]],
    by_uuid: Mapping[str, dict[str, Any]],
) -> dict[str, Any] | None:
    legacy_id = str(item.get("legacy_product_id") or "").strip()
    if legacy_id and legacy_id in by_id:
        return by_id[legacy_id]
    card_uuid = canonical_uuid_or_none(item.get("card_uuid"))
    return by_uuid.get(card_uuid) if card_uuid else None


def _product_image_rows(product: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    if not product:
        return []
    urls: list[str] = []
    image_url = str(product.get("image_url") or "").strip()
    if image_url:
        urls.append(image_url)
    photos = product.get("photos")
    if isinstance(photos, list):
        urls.extend(str(value).strip() for value in photos if str(value).strip())
    elif isinstance(photos, str):
        try:
            decoded = json.loads(photos)
        except json.JSONDecodeError:
            decoded = []
        if isinstance(decoded, list):
            urls.extend(str(value).strip() for value in decoded if str(value).strip())
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return [
        {"url": url, "alt_text": None, "sort_order": index}
        for index, url in enumerate(deduped)
    ]


def _existing_training_card_uuids(store: MemoryStore) -> set[str]:
    examples = latest_training_examples(store.list_training_examples(trusted_only=True, limit=100_000))
    return {
        card_uuid
        for example in examples
        if (card_uuid := canonical_uuid_or_none(example.card_uuid))
    }


def _scan_for_card_uuid(store: MemoryStore, card_uuid: str) -> dict[str, Any] | None:
    with store.connection() as db:
        row = db.execute(
            "SELECT scan_id FROM scans WHERE card_uuid = ? ORDER BY created_at DESC LIMIT 1",
            (card_uuid,),
        ).fetchone()
    return store.get_scan(row["scan_id"]) if row else None


def _download_image(client: httpx.Client, url: str) -> bytes:
    response = client.get(url)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if content_type and not content_type.startswith("image/"):
        raise ValueError(f"URL did not return an image ({content_type})")
    content = response.content
    if len(content) > settings.max_image_bytes:
        raise ValueError(f"Image exceeds {settings.max_image_bytes} bytes")
    return content


def _archive_inventory_scan(
    *,
    store: MemoryStore,
    card_uuid: str,
    front_bytes: bytes,
    back_bytes: bytes | None,
) -> dict[str, Any]:
    front = validate_and_normalize_image(front_bytes, settings.max_image_bytes)
    back = (
        validate_and_normalize_image(back_bytes, settings.max_image_bytes)
        if back_bytes is not None
        else None
    )
    if back is not None and len(front.content) + len(back.content) > settings.max_total_image_bytes:
        raise ValueError("Normalized front/back pair exceeds configured total image limit")

    image_root = settings.resolve_local_path(settings.image_store_path)
    persist_image(front, image_root, "front")
    if back is not None:
        persist_image(back, image_root, "back")

    image_pair = pair_hash(front.sha256, back.sha256 if back else None)
    existing_pair_uuid = store.card_uuid_for_image_pair(image_pair)
    if existing_pair_uuid and existing_pair_uuid != card_uuid:
        raise ValueError(
            "Exact inventory image pair is already bound to another physical card UUID: "
            f"{existing_pair_uuid}"
        )

    scan_id = str(uuid4())
    checklist = ChecklistResult(
        outcome=ChecklistOutcome.INPUT_INCOMPLETE,
        identity_id=None,
        identity=None,
        candidate_count=0,
        reasons=[
            "Inventory truth import intentionally bypassed automated identity lookup; "
            "the operator has declared inventory identity correct."
        ],
        source_receipts=["inventory_operator_truth"],
    )
    created_at = utc_now()
    store.save_scan(
        scan_id=scan_id,
        card_uuid=card_uuid,
        created_at=created_at,
        front_sha256=front.sha256,
        back_sha256=back.sha256 if back else None,
        image_pair_sha256=image_pair,
        front_reference_sha256=front.reference_sha256,
        back_reference_sha256=back.reference_sha256 if back else None,
        front_perceptual_hash=front.perceptual_hash,
        back_perceptual_hash=back.perceptual_hash if back else None,
        local_suggestion=None,
        local_vision=None,
        checklist=checklist.model_dump(mode="json"),
        status="inventory_truth_archive",
    )
    scan = store.get_scan(scan_id)
    if scan is None:
        raise RuntimeError("Inventory training scan was not persisted")
    return scan


def _create_inventory_lesson(
    *,
    store: MemoryStore,
    scan_id: str,
    identity,
    inventory_item_id: str,
    title: str,
    image_side_source: str,
) -> str:
    lesson = store.create_lesson(
        LessonCreate(
            scan_id=scan_id,
            state=LearningState.OPERATOR_CONFIRMED,
            identity=identity,
            verification_source="inventory_operator_truth",
            operator_id="inventory-training-bridge",
            notes=(
                f"Correct inventory truth imported from inventory_item:{inventory_item_id}. "
                f"Title: {title}. Image side mapping: {image_side_source}."
            ),
        )
    )
    return lesson.training_example_id or ""


def run_import(
    *,
    dry_run: bool,
    receipt_path: Path,
    limit: int | None = None,
) -> dict[str, Any]:
    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    before_examples = latest_training_examples(
        store.list_training_examples(trusted_only=True, limit=100_000)
    )
    before_readiness = training_readiness(before_examples)
    existing_uuids = _existing_training_card_uuids(store)

    supabase_url, service_key, credential_source = _resolve_supabase_env()
    reader = SupabaseReader(supabase_url, service_key)
    try:
        items = reader.table("inventory_items")
        image_rows = reader.table("inventory_images")
        attribute_rows = reader.table("inventory_attributes")
        products = reader.table("products")
    finally:
        reader.close()

    attributes = _attributes_by_item(attribute_rows)
    images = _images_by_item(image_rows)
    products_by_id, products_by_uuid = _products_index(products)

    counts = {
        "inventory_rows": len(items),
        "inventory_card_rows": 0,
        "eligible_training_cards": 0,
        "created_lessons": 0,
        "already_learned": 0,
        "front_back_lessons": 0,
        "front_only_lessons": 0,
        "skipped_missing_card_uuid": 0,
        "skipped_incomplete_structured_identity": 0,
        "skipped_no_usable_image": 0,
        "skipped_image_error": 0,
        "skipped_uuid_or_pair_conflict": 0,
    }
    skipped_samples: list[dict[str, str]] = []
    imported_samples: list[dict[str, str]] = []
    image_client = httpx.Client(timeout=httpx.Timeout(60.0), follow_redirects=True)

    try:
        for item in items:
            product = _product_for_item(
                item,
                by_id=products_by_id,
                by_uuid=products_by_uuid,
            )
            if not inventory_item_is_card(item, product):
                continue
            counts["inventory_card_rows"] += 1
            if limit is not None and counts["inventory_card_rows"] > limit:
                break

            item_id = str(item.get("id") or "").strip()
            title = str(item.get("title") or (product or {}).get("title") or item_id).strip()
            card_uuid = canonical_uuid_or_none(item.get("card_uuid")) or canonical_uuid_or_none(
                (product or {}).get("card_uuid")
            )
            if not card_uuid:
                counts["skipped_missing_card_uuid"] += 1
                if len(skipped_samples) < 25:
                    skipped_samples.append({"inventory_item_id": item_id, "reason": "missing_card_uuid", "title": title})
                continue

            identity = extract_inventory_identity(
                item,
                attributes=attributes.get(item_id, {}),
                product=product,
            )
            if not identity_has_training_truth(identity):
                counts["skipped_incomplete_structured_identity"] += 1
                if len(skipped_samples) < 25:
                    skipped_samples.append(
                        {
                            "inventory_item_id": item_id,
                            "reason": "incomplete_structured_identity",
                            "title": title,
                        }
                    )
                continue

            item_images = images.get(item_id) or _product_image_rows(product)
            front_url, back_url, side_source = select_inventory_images(item_images)
            if not front_url:
                counts["skipped_no_usable_image"] += 1
                if len(skipped_samples) < 25:
                    skipped_samples.append({"inventory_item_id": item_id, "reason": "no_usable_image", "title": title})
                continue

            counts["eligible_training_cards"] += 1
            if card_uuid in existing_uuids:
                counts["already_learned"] += 1
                continue
            if dry_run:
                continue

            try:
                existing_scan = _scan_for_card_uuid(store, card_uuid)
                if existing_scan is None:
                    front_bytes = _download_image(image_client, front_url)
                    back_bytes = _download_image(image_client, back_url) if back_url else None
                    scan = _archive_inventory_scan(
                        store=store,
                        card_uuid=card_uuid,
                        front_bytes=front_bytes,
                        back_bytes=back_bytes,
                    )
                else:
                    scan = existing_scan

                training_example_id = _create_inventory_lesson(
                    store=store,
                    scan_id=scan["scan_id"],
                    identity=identity,
                    inventory_item_id=item_id,
                    title=title,
                    image_side_source=side_source,
                )
                existing_uuids.add(card_uuid)
                counts["created_lessons"] += 1
                if scan.get("back_sha256"):
                    counts["front_back_lessons"] += 1
                else:
                    counts["front_only_lessons"] += 1
                if len(imported_samples) < 25:
                    imported_samples.append(
                        {
                            "inventory_item_id": item_id,
                            "card_uuid": card_uuid,
                            "training_example_id": training_example_id,
                            "title": title,
                        }
                    )
            except httpx.HTTPError as exc:
                counts["skipped_image_error"] += 1
                if len(skipped_samples) < 25:
                    skipped_samples.append(
                        {"inventory_item_id": item_id, "reason": f"image_http_error:{type(exc).__name__}", "title": title}
                    )
            except ValueError as exc:
                reason = str(exc)
                if "another physical card UUID" in reason or "another card_uuid" in reason:
                    counts["skipped_uuid_or_pair_conflict"] += 1
                    reason_key = "uuid_or_pair_conflict"
                else:
                    counts["skipped_image_error"] += 1
                    reason_key = f"image_validation_error:{reason[:120]}"
                if len(skipped_samples) < 25:
                    skipped_samples.append({"inventory_item_id": item_id, "reason": reason_key, "title": title})
    finally:
        image_client.close()

    if dry_run:
        after_examples = before_examples
        after_readiness = before_readiness
    else:
        after_examples = latest_training_examples(
            store.list_training_examples(trusted_only=True, limit=100_000)
        )
        after_readiness = training_readiness(after_examples)

    learned_eligible = counts["already_learned"] + counts["created_lessons"]
    eligible = counts["eligible_training_cards"]
    coverage = 100.0 if eligible == 0 else round((learned_eligible / eligible) * 100.0, 2)
    outstanding = max(0, eligible - learned_eligible)

    receipt = {
        "schema_version": RECEIPT_SCHEMA,
        "created_at": utc_now().isoformat(),
        "mode": "dry_run" if dry_run else "import",
        "source": "production_inventory_read_only",
        "credential_source": credential_source,
        "truth_policy": (
            "User/operator-declared inventory identity is correct. Structured inventory fields are "
            "mapped into operator_confirmed lessons; arbitrary title prose is never promoted into truth."
        ),
        "counts": counts,
        "training": {
            "trusted_examples_before": len(before_examples),
            "trusted_examples_after": len(after_examples),
            "inventory_eligible_learned": learned_eligible,
            "inventory_eligible_total": eligible,
            "inventory_training_coverage_percent": coverage,
            "inventory_training_outstanding": outstanding,
            "ready_for_trial_lora": after_readiness["ready_for_trial_lora"],
            "ready_for_production_candidate": after_readiness["ready_for_production_candidate"],
        },
        "safety": {
            "production_inventory_mutated": False,
            "mac_learning_store_only": True,
            "card_uuid_preserved": True,
            "latest_truth_per_physical_card": True,
            "unstructured_title_guessing_disabled": True,
            "exact_image_pair_uuid_conflicts_fail_closed": True,
        },
        "skipped_samples": skipped_samples,
        "imported_samples": imported_samples,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import already-correct Truely Collectables inventory as trusted InstaComp lessons."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0:
        raise SystemExit("--limit must be greater than zero")

    receipt = run_import(
        dry_run=args.dry_run,
        receipt_path=args.receipt.expanduser().resolve(),
        limit=args.limit,
    )
    print(json.dumps(receipt, indent=2))
    if not args.dry_run and receipt["training"]["inventory_training_outstanding"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
