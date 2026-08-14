#!/usr/bin/env python3
from __future__ import annotations

import argparse
import email.utils
import json
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import sync_all_inventory_training_truth_v2 as v2
from app.inventory_learning_completion import apply_learning_completion_policy
from import_inventory_training_truth import DEFAULT_RECEIPT

RETRYABLE_IMAGE_STATUS = {
    408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 544
}
MAX_IMAGE_ATTEMPTS = 9
BASE_RETRY_SECONDS = 0.75
MAX_RETRY_SECONDS = 20.0


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    text = value.strip()
    try:
        return max(0.0, float(text))
    except ValueError:
        pass
    try:
        retry_at = email.utils.parsedate_to_datetime(text)
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return None


def _retry_delay(attempt: int, retry_after: str | None = None) -> float:
    server_delay = _retry_after_seconds(retry_after)
    if server_delay is not None:
        return min(MAX_RETRY_SECONDS, server_delay)
    exponential = min(MAX_RETRY_SECONDS, BASE_RETRY_SECONDS * (2 ** max(0, attempt - 1)))
    return min(MAX_RETRY_SECONDS, exponential + random.uniform(0.0, 0.35))


def _download_image_resilient(client: httpx.Client, url: str) -> bytes:
    """Download an inventory image with bounded retry/backoff for transient storage failures."""
    last_error: BaseException | None = None
    for attempt in range(1, MAX_IMAGE_ATTEMPTS + 1):
        try:
            response = client.get(url)
            if response.status_code in RETRYABLE_IMAGE_STATUS:
                if attempt >= MAX_IMAGE_ATTEMPTS:
                    response.raise_for_status()
                time.sleep(_retry_delay(attempt, response.headers.get("Retry-After")))
                continue
            response.raise_for_status()
            if not response.content:
                raise ValueError("Inventory image response was empty")
            return response.content
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            if attempt >= MAX_IMAGE_ATTEMPTS:
                raise
            time.sleep(_retry_delay(attempt))
    if last_error is not None:
        raise last_error
    raise RuntimeError("Inventory image download exhausted retries without a response")


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


def run_sync(
    *,
    dry_run: bool,
    receipt_path: Path,
) -> dict[str, Any]:
    # v2 contains the audited import/census logic. v3 hardens transient image
    # retrieval and fixes the mismatch between strict census coverage and LoRA eligibility.
    original_downloader = v2._download_image
    v2._download_image = _download_image_resilient
    try:
        receipt = v2.run_sync(
            dry_run=dry_run,
            receipt_path=receipt_path,
        )
    finally:
        v2._download_image = original_downloader

    receipt["schema_version"] = "tcos.instacomp-ai.inventory-training-import.v4"
    receipt["image_fetch_policy"] = {
        "max_attempts": MAX_IMAGE_ATTEMPTS,
        "retryable_http_statuses": sorted(RETRYABLE_IMAGE_STATUS),
        "honors_retry_after": True,
        "bounded_exponential_backoff": True,
    }
    apply_learning_completion_policy(receipt)
    _write_receipt(receipt_path, receipt)
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Import image-backed inventory truth, retry transient image-storage failures, "
            "preserve the strict all-card audit, and quarantine rows that cannot train vision."
        )
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    args = parser.parse_args()

    receipt_path = args.receipt.expanduser().resolve()
    receipt = run_sync(
        dry_run=args.dry_run,
        receipt_path=receipt_path,
    )
    print(json.dumps(receipt, indent=2))

    if args.dry_run:
        return 0

    census = receipt["inventory_census"]
    if int(census.get("collx_rows_excluded_from_card_census") or 0) != 0:
        print(
            "BLOCKED: one or more durable COLLX inventory rows were excluded from the card census.",
            file=sys.stderr,
        )
        return 4

    training = receipt["training"]
    quarantine = receipt["training_quarantine"]
    learned = int(training.get("inventory_eligible_learned") or 0)
    eligible = int(training.get("inventory_eligible_total") or 0)
    outstanding = int(training.get("inventory_training_outstanding") or 0)
    coverage = float(training.get("inventory_training_coverage_percent") or 0.0)

    if learned <= 0 or eligible <= 0:
        print("BLOCKED: no image-backed inventory training examples were produced.", file=sys.stderr)
        return 3
    if outstanding != 0 or learned != eligible or coverage != 100.0:
        print(
            f"BLOCKED: LoRA eligibility is {coverage:.2f}% ({learned}/{eligible}); "
            f"{outstanding} non-quarantined rows remain unresolved.",
            file=sys.stderr,
        )
        return 2

    strict = receipt["strict_inventory_coverage"]
    represented = int(strict.get("inventory_card_rows_represented") or 0)
    total = int(strict.get("inventory_card_total") or 0)
    quarantined = int(quarantine.get("quarantined_inventory_rows") or 0)
    print(
        "PASS: LoRA training corpus is 100.00% complete "
        f"({learned}/{eligible} unique eligible examples); strict inventory audit "
        f"represented {represented}/{total} rows with {quarantined} quarantined source-data exceptions.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
