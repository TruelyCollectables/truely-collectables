#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import import_inventory_training_truth as inventory_import
from inventory_training_git_snapshot import SnapshotSupabaseReader, fetch_envelope_from_git


def _snapshot_reader_class(envelope: dict[str, Any]):
    class BoundSnapshotReader(SnapshotSupabaseReader):
        def __init__(self, base_url: str, service_key: str):
            super().__init__(base_url, service_key, envelope=envelope)

    BoundSnapshotReader.__name__ = "BoundSnapshotReader"
    return BoundSnapshotReader


def main() -> int:
    # Full-corpus training must never fall back to public PostgREST. The Mac
    # consumes only the authenticated encrypted snapshot generated from the
    # read-only Supabase Management database/query path.
    envelope = fetch_envelope_from_git()
    reader_class = _snapshot_reader_class(envelope)
    print(
        "USING encrypted authoritative direct-DB inventory snapshot from Git; "
        "public PostgREST fallback is disabled for full-corpus training",
        flush=True,
    )

    inventory_import.SupabaseReader = reader_class
    import sync_all_inventory_training_truth_v3 as target

    # v3 delegates the audited census/import loop to v2, so bind the snapshot
    # reader on the delegated module as well. This keeps the standard guarded
    # full-corpus path on the authoritative encrypted snapshot while enabling
    # v3 retry/quarantine completion policy.
    target.v2.SupabaseReader = reader_class
    return target.main()


if __name__ == "__main__":
    raise SystemExit(main())
