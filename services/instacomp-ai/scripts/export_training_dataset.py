#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from app.config import settings
from app.storage import MemoryStore
from app.training import export_training_dataset, training_readiness


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export trusted InstaComp lessons as a local vision-training dataset."
    )
    parser.add_argument("--validation-percent", type=int, default=15)
    parser.add_argument("--status-only", action="store_true")
    args = parser.parse_args()

    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    examples = store.list_training_examples(trusted_only=True, limit=100_000)
    readiness = training_readiness(examples)
    if args.status_only:
        print(json.dumps(readiness, indent=2))
        return 0
    if not examples:
        raise SystemExit("No trusted training examples exist yet.")

    manifest = export_training_dataset(
        examples,
        image_store_path=settings.resolve_local_path(settings.image_store_path),
        destination_root=settings.resolve_local_path(settings.training_export_path),
        validation_percent=args.validation_percent,
    )
    print(json.dumps({"readiness": readiness, "export": manifest}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
