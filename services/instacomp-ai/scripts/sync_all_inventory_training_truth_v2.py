#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.images import pair_hash, validate_and_normalize_image
from app.inventory_training import (
    extract_inventory_identity,
    identity_has_training_truth,
    inventory_item_is_card,
    select_inventory_images,
)
from app.inventory_training_keys import resolve_inventory_learning_uuid
from app.storage import MemoryStore, canonical_uuid_or_none, identity_fingerprint
from app.training import latest_training_examples, training_readiness
from import_inventory_training_truth import (
    DEFAULT_RECEIPT,
    SupabaseReader,
    _archive_inventory_scan,
    _attributes_by_item,
    _create_inventory_lesson,
    _download_image,
    _images_by_item,
    _product_for_item,
    _product_image_rows,
    _products_index,
    _resolve_supabase_env,
    utc_now,
)


RECEIPT_SCHEMA = "tcos.instacomp-ai.inventory-training-import.v2"


def _trusted_pair_rows(store: MemoryStore) -> dict[tuple[str, str], dict[str, str]]:
    """Newest trusted lesson for each exact image pair + identity fingerprint."""
    with store.connection() as db:
        rows = db.execute(
            """
            SELECT
                s.card_uuid,
                s.image_pair_sha256,
                l.identity_fingerprint,
                l.scan_id,
                l.created_at,
                te.training_example_id
            FROM lessons l
            JOIN scans s ON s.scan_id = l.scan_id
            LEFT JOIN training_examples te ON te.lesson_id = l.lesson_id
            WHERE l.trusted = 1
              AND s.image_pair_sha256 IS NOT NULL
            ORDER BY l.created_at ASC
            """
        ).fetchall()
    result: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        pair = str(row["image_pair_sha256"] or "").strip()
        fingerprint = str(row["identity_fingerprint"] or "").strip()
        card_uuid = canonical_uuid_or_none(row["card_uuid"])
        if not pair or not fingerprint or not card_uuid:
            continue
        result[(pair, fingerprint)] = {
            "card_uuid": card_uuid,
            "scan_id": str(row["scan_id"]),
            "training_example_id": str(row["training_example_id"] or ""),
        }
    return result


def _scan_for_pair(store: MemoryStore, image_pair_sha256: str) -> dict[str, Any] | None:
    with store.connection() as db:
        row = db.execute(
            """
            SELECT scan_id
            FROM scans
            WHERE image_pair_sha256 = ?
            ORDER BY created_at DESC, scan_id DESC
            LIMIT 1
            """,
            (image_pair_sha256,),
        ).fetchone()
    if row is None:
        return None
    return store.get_scan(str(row["scan_id"]))


def _normalized_pair_hash(front_bytes: bytes, back_bytes: bytes | None) -> str:
    front = validate_and_normalize_image(front_bytes, settings.max_image_bytes)
    back = (
        validate_and_normalize_image(back_bytes, settings.max_image_bytes)
        if back_bytes is not None
        else None
    )
    if back is not None and len(front.content) + len(back.content) > settings.max_total_image_bytes:
        raise ValueError("Normalized front/back pair exceeds configured total image limit")
    return pair_hash(front.sha256, back.sha256 if back else None)


def _append_sample(target: list[dict[str, str]], payload: Mapping[str, object], limit: int = 30) -> None:
    if len(target) >= limit:
        return
    target.append({str(key): str(value) for key, value in payload.items() if value is not None})


def run_sync(
    *,
    allow_vercel_env_pull: bool,
    dry_run: bool,
    receipt_path: Path,
) -> dict[str, Any]:
    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()

    before_examples = latest_training_examples(
        store.list_training_examples(trusted_only=True, limit=100_000)
    )
    before_readiness = training_readiness(before_examples)
    trusted_pairs = _trusted_pair_rows(store)

    supabase_url, service_key, credential_source = _resolve_supabase_env(
        allow_vercel_pull=allow_vercel_env_pull
    )
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

    counts: Counter[str] = Counter()
    counts["inventory_rows"] = len(items)
    uuid_sources: Counter[str] = Counter()
    represented_item_ids: set[str] = set()
    represented_effective_uuids: set[str] = set()
    current_pair_identity: dict[str, str] = {}
    skipped_samples: list[dict[str, str]] = []
    imported_samples: list[dict[str, str]] = []
    already_samples: list[dict[str, str]] = []

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
            item_id = str(item.get("id") or "").strip()
            title = str(item.get("title") or (product or {}).get("title") or item_id).strip()

            learning_uuid, uuid_source = resolve_inventory_learning_uuid(item, product)
            uuid_sources[uuid_source] += 1
            if not learning_uuid:
                counts["skipped_missing_inventory_key"] += 1
                _append_sample(
                    skipped_samples,
                    {
                        "inventory_item_id": item_id,
                        "reason": "missing_inventory_identity_key",
                        "title": title,
                    },
                )
                continue

            identity = extract_inventory_identity(
                item,
                attributes=attributes.get(item_id, {}),
                product=product,
            )
            if not identity_has_training_truth(identity):
                counts["skipped_incomplete_structured_identity"] += 1
                _append_sample(
                    skipped_samples,
                    {
                        "inventory_item_id": item_id,
                        "learning_uuid": learning_uuid,
                        "uuid_source": uuid_source,
                        "reason": "incomplete_structured_identity",
                        "title": title,
                    },
                )
                continue

            item_images = images.get(item_id) or _product_image_rows(product)
            front_url, back_url, side_source = select_inventory_images(item_images)
            if not front_url:
                counts["skipped_no_usable_image"] += 1
                _append_sample(
                    skipped_samples,
                    {
                        "inventory_item_id": item_id,
                        "learning_uuid": learning_uuid,
                        "uuid_source": uuid_source,
                        "reason": "no_usable_image",
                        "title": title,
                    },
                )
                continue

            counts["image_backed_identity_cards"] += 1

            if dry_run:
                counts["dry_run_would_attempt"] += 1
                continue

            try:
                front_bytes = _download_image(image_client, front_url)
                back_bytes = _download_image(image_client, back_url) if back_url else None
                image_pair = _normalized_pair_hash(front_bytes, back_bytes)
            except (httpx.HTTPError, ValueError) as exc:
                counts["skipped_image_error"] += 1
                _append_sample(
                    skipped_samples,
                    {
                        "inventory_item_id": item_id,
                        "learning_uuid": learning_uuid,
                        "uuid_source": uuid_source,
                        "reason": f"image_error:{type(exc).__name__}:{str(exc)[:140]}",
                        "title": title,
                    },
                )
                continue

            fingerprint = identity_fingerprint(identity)
            seen_fingerprint = current_pair_identity.get(image_pair)
            if seen_fingerprint and seen_fingerprint != fingerprint:
                counts["skipped_current_inventory_pair_identity_conflict"] += 1
                _append_sample(
                    skipped_samples,
                    {
                        "inventory_item_id": item_id,
                        "learning_uuid": learning_uuid,
                        "reason": "same_exact_images_have_conflicting_current_inventory_identity",
                        "title": title,
                    },
                )
                continue
            current_pair_identity[image_pair] = fingerprint

            exact_trusted = trusted_pairs.get((image_pair, fingerprint))
            if exact_trusted:
                effective_uuid = exact_trusted["card_uuid"]
                represented_item_ids.add(item_id)
                represented_effective_uuids.add(effective_uuid)
                counts["already_learned_exact_pair_identity"] += 1
                _append_sample(
                    already_samples,
                    {
                        "inventory_item_id": item_id,
                        "effective_card_uuid": effective_uuid,
                        "inventory_learning_uuid": learning_uuid,
                        "uuid_source": uuid_source,
                        "training_example_id": exact_trusted.get("training_example_id"),
                        "title": title,
                    },
                )
                continue

            existing_scan = _scan_for_pair(store, image_pair)
            if existing_scan is not None:
                effective_uuid = canonical_uuid_or_none(existing_scan.get("card_uuid")) or learning_uuid
                scan = existing_scan
                counts["reused_existing_exact_pair_scan"] += 1
            else:
                effective_uuid = learning_uuid
                try:
                    scan = _archive_inventory_scan(
                        store=store,
                        card_uuid=effective_uuid,
                        front_bytes=front_bytes,
                        back_bytes=back_bytes,
                    )
                except ValueError as exc:
                    # A concurrent/legacy exact-pair binding can appear between
                    # our lookup and insert. Re-read the exact pair and reconcile
                    # to the already-bound physical card instead of failing the
                    # entire correct inventory row.
                    if "another physical card UUID" not in str(exc) and "another card_uuid" not in str(exc):
                        raise
                    scan = _scan_for_pair(store, image_pair)
                    if scan is None:
                        raise
                    effective_uuid = canonical_uuid_or_none(scan.get("card_uuid")) or learning_uuid
                    counts["reconciled_exact_pair_uuid_race"] += 1

            try:
                training_example_id = _create_inventory_lesson(
                    store=store,
                    scan_id=str(scan["scan_id"]),
                    identity=identity,
                    inventory_item_id=item_id,
                    title=title,
                    image_side_source=side_source,
                )
            except Exception as exc:
                counts["skipped_lesson_create_error"] += 1
                _append_sample(
                    skipped_samples,
                    {
                        "inventory_item_id": item_id,
                        "effective_card_uuid": effective_uuid,
                        "reason": f"lesson_create_error:{type(exc).__name__}:{str(exc)[:140]}",
                        "title": title,
                    },
                )
                continue

            trusted_pairs[(image_pair, fingerprint)] = {
                "card_uuid": effective_uuid,
                "scan_id": str(scan["scan_id"]),
                "training_example_id": training_example_id,
            }
            represented_item_ids.add(item_id)
            represented_effective_uuids.add(effective_uuid)
            counts["created_lessons"] += 1
            if scan.get("back_sha256"):
                counts["front_back_lessons"] += 1
            else:
                counts["front_only_lessons"] += 1
            _append_sample(
                imported_samples,
                {
                    "inventory_item_id": item_id,
                    "effective_card_uuid": effective_uuid,
                    "inventory_learning_uuid": learning_uuid,
                    "uuid_source": uuid_source,
                    "training_example_id": training_example_id,
                    "title": title,
                },
            )
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

    total_cards = int(counts["inventory_card_rows"])
    represented_rows = len(represented_item_ids)
    outstanding_rows = max(0, total_cards - represented_rows)
    strict_coverage = 100.0 if total_cards and outstanding_rows == 0 else (
        0.0 if total_cards == 0 else round((represented_rows / total_cards) * 100.0, 2)
    )

    unique_examples = len(represented_effective_uuids)
    compatible_coverage = 100.0 if unique_examples > 0 and outstanding_rows == 0 else strict_coverage

    receipt: dict[str, Any] = {
        "schema_version": RECEIPT_SCHEMA,
        "created_at": utc_now().isoformat(),
        "mode": "dry_run" if dry_run else "import",
        "source": "production_inventory_read_only",
        "credential_source": credential_source,
        "truth_policy": (
            "User/operator-declared inventory identity is correct. Structured inventory truth is promoted "
            "to operator_confirmed lessons. Existing exact image+identity lessons are reconciled as already "
            "learned. Production inventory is never mutated by this bridge."
        ),
        "counts": dict(counts),
        "uuid_resolution": dict(uuid_sources),
        "strict_inventory_coverage": {
            "inventory_card_total": total_cards,
            "inventory_card_rows_represented": represented_rows,
            "inventory_training_outstanding": outstanding_rows,
            "inventory_training_coverage_percent": strict_coverage,
            "denominator": "all_detected_card_inventory_rows",
        },
        "training": {
            "trusted_examples_before": len(before_examples),
            "trusted_examples_after": len(after_examples),
            "inventory_eligible_learned": unique_examples,
            "inventory_eligible_total": unique_examples,
            "inventory_training_coverage_percent": compatible_coverage,
            "inventory_training_outstanding": outstanding_rows,
            "inventory_card_rows_represented": represented_rows,
            "inventory_card_rows_total": total_cards,
            "strict_inventory_training_coverage_percent": strict_coverage,
            "ready_for_trial_lora": after_readiness["ready_for_trial_lora"],
            "ready_for_production_candidate": after_readiness["ready_for_production_candidate"],
            "coverage_denominator": "all_detected_card_inventory_rows",
            "coverage_claim_is_strict": True,
        },
        "safety": {
            "production_inventory_mutated": False,
            "mac_learning_store_only": True,
            "existing_card_uuid_preserved_when_present": True,
            "missing_card_uuid_falls_back_to_stable_inventory_item_id": True,
            "legacy_non_uuid_item_id_uses_deterministic_uuid5": True,
            "exact_image_identity_is_reconciled_not_duplicated": True,
            "conflicting_current_identity_for_same_exact_images_fails_closed": True,
            "unstructured_title_guessing_disabled": True,
        },
        "skipped_samples": skipped_samples,
        "imported_samples": imported_samples,
        "already_learned_samples": already_samples,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Turn every detected correct inventory card into trusted InstaComp learning truth, "
            "using the inventory row UUID when the legacy card_uuid column is empty."
        )
    )
    parser.add_argument("--allow-vercel-env-pull", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    args = parser.parse_args()

    receipt = run_sync(
        allow_vercel_env_pull=args.allow_vercel_env_pull,
        dry_run=args.dry_run,
        receipt_path=args.receipt.expanduser().resolve(),
    )
    print(json.dumps(receipt, indent=2))

    if args.dry_run:
        return 0
    strict = receipt["strict_inventory_coverage"]
    total = int(strict["inventory_card_total"])
    represented = int(strict["inventory_card_rows_represented"])
    outstanding = int(strict["inventory_training_outstanding"])
    if total <= 0:
        print("ERROR: zero card inventory rows detected; refusing to claim 100% coverage.", file=sys.stderr)
        return 3
    if outstanding or represented != total:
        print(
            f"BLOCKED: inventory learning coverage is {strict['inventory_training_coverage_percent']:.2f}% "
            f"({represented}/{total}); {outstanding} card inventory rows remain unrepresented.",
            file=sys.stderr,
        )
        return 2
    print(
        f"PASS: inventory learning coverage is 100.00% ({represented}/{total} inventory rows represented).",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
