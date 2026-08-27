#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.inventory_training import inventory_item_is_card
from app.storage import MemoryStore, canonical_uuid_or_none
from import_inventory_training_truth import (
    DEFAULT_RECEIPT,
    SupabaseReader,
    _existing_training_card_uuids,
    _product_for_item,
    _products_index,
    _resolve_supabase_env,
    run_import,
)


def _strict_coverage() -> dict:
    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    learned_uuids = _existing_training_card_uuids(store)

    supabase_url, service_key, _credential_source = _resolve_supabase_env()
    reader = SupabaseReader(supabase_url, service_key)
    try:
        items = reader.table("inventory_items")
        products = reader.table("products")
    finally:
        reader.close()
    by_id, by_uuid = _products_index(products)

    total = 0
    learned = 0
    missing_uuid = 0
    outstanding_samples: list[dict[str, str]] = []
    for item in items:
        product = _product_for_item(item, by_id=by_id, by_uuid=by_uuid)
        if not inventory_item_is_card(item, product):
            continue
        total += 1
        item_id = str(item.get("id") or "").strip()
        title = str(item.get("title") or (product or {}).get("title") or item_id).strip()
        card_uuid = canonical_uuid_or_none(item.get("card_uuid")) or canonical_uuid_or_none(
            (product or {}).get("card_uuid")
        )
        if not card_uuid:
            missing_uuid += 1
            if len(outstanding_samples) < 25:
                outstanding_samples.append(
                    {"inventory_item_id": item_id, "title": title, "reason": "missing_card_uuid"}
                )
            continue
        if card_uuid in learned_uuids:
            learned += 1
        elif len(outstanding_samples) < 25:
            outstanding_samples.append(
                {"inventory_item_id": item_id, "card_uuid": card_uuid, "title": title, "reason": "not_in_trusted_learning_store"}
            )

    outstanding = max(0, total - learned)
    coverage = 100.0 if total == 0 else round((learned / total) * 100.0, 2)
    return {
        "inventory_card_total": total,
        "inventory_card_learned": learned,
        "inventory_training_outstanding": outstanding,
        "inventory_training_coverage_percent": coverage,
        "inventory_cards_missing_uuid": missing_uuid,
        "outstanding_samples": outstanding_samples,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Sync correct inventory into InstaComp lessons and certify coverage against ALL card inventory rows, "
            "not merely the subset that was easy to import."
        )
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    args = parser.parse_args()
    receipt_path = args.receipt.expanduser().resolve()

    receipt = run_import(
        dry_run=args.dry_run,
        receipt_path=receipt_path,
    )
    strict = _strict_coverage()
    receipt["strict_inventory_coverage"] = strict
    receipt["training"]["inventory_eligible_learned"] = strict["inventory_card_learned"]
    receipt["training"]["inventory_eligible_total"] = strict["inventory_card_total"]
    receipt["training"]["inventory_training_coverage_percent"] = strict[
        "inventory_training_coverage_percent"
    ]
    receipt["training"]["inventory_training_outstanding"] = strict[
        "inventory_training_outstanding"
    ]
    receipt["training"]["coverage_denominator"] = "all_detected_card_inventory_rows"
    receipt["training"]["coverage_claim_is_strict"] = True
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))

    if args.dry_run:
        return 0
    if strict["inventory_card_total"] <= 0:
        print("ERROR: zero card inventory rows detected; refusing to claim 100% coverage.", file=sys.stderr)
        return 3
    if strict["inventory_training_outstanding"]:
        print(
            f"BLOCKED: inventory learning coverage is {strict['inventory_training_coverage_percent']:.2f}% "
            f"({strict['inventory_card_learned']}/{strict['inventory_card_total']}); "
            f"{strict['inventory_training_outstanding']} card inventory rows remain unlearned.",
            file=sys.stderr,
        )
        return 2
    print(
        f"PASS: inventory learning coverage is 100.00% "
        f"({strict['inventory_card_learned']}/{strict['inventory_card_total']}).",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
