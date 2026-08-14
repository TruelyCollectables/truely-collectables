#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import import_inventory_training_truth as inventory_import
from inventory_training_git_snapshot import SnapshotInvalid, SnapshotSupabaseReader, fetch_envelope_from_git


def _is_snapshot_key_mismatch(exc: SnapshotInvalid) -> bool:
    """Return True only for the expected legacy/new Supabase API-key mismatch."""
    return "snapshot authentication failed" in str(exc).lower()


def _snapshot_reader_class(
    envelope: dict[str, Any],
    *,
    direct_reader_class=None,
    snapshot_reader_class=None,
):
    # Capture the real authenticated direct reader before inventory_import.SupabaseReader
    # is rebound below. This prevents recursion if the encrypted snapshot was produced
    # with the legacy service_role key while the Mac now carries an sb_secret_* key.
    direct_reader = direct_reader_class or inventory_import.SupabaseReader
    snapshot_reader = snapshot_reader_class or SnapshotSupabaseReader

    class BoundInventoryReader:
        def __init__(self, base_url: str, service_key: str):
            try:
                self._reader = snapshot_reader(
                    base_url,
                    service_key,
                    envelope=envelope,
                )
                self.source = "encrypted_authoritative_direct_db_snapshot"
            except SnapshotInvalid as exc:
                # The snapshot exporter encrypts with the legacy service_role key.
                # Supabase's newer sb_secret_* server keys have equivalent elevated
                # database access but different bytes, so they cannot authenticate an
                # older service_role-key-encrypted envelope. In that one known mismatch
                # case, use the current elevated key for a read-only Production API read.
                # All other snapshot integrity/decode/schema failures still fail closed.
                if not _is_snapshot_key_mismatch(exc):
                    raise
                print(
                    "SNAPSHOT KEY MIGRATION: encrypted snapshot key does not match the current "
                    "Supabase server key; using authenticated read-only Production API fallback.",
                    file=sys.stderr,
                    flush=True,
                )
                self._reader = direct_reader(base_url, service_key)
                self.source = "authenticated_read_only_production_api_fallback"

        def close(self) -> None:
            self._reader.close()

        def table(self, name: str, *, select: str = "*", page_size: int = 1000):
            return self._reader.table(name, select=select, page_size=page_size)

    BoundInventoryReader.__name__ = "BoundInventoryReader"
    return BoundInventoryReader


def main() -> int:
    # Prefer the authenticated encrypted direct-DB snapshot. If and only if its
    # authentication fails because the project migrated from legacy service_role
    # to a newer sb_secret_* server key, read the same Production tables through
    # the current authenticated elevated key. Malformed/tampered snapshots still
    # fail closed and are never silently bypassed.
    envelope = fetch_envelope_from_git()
    direct_reader_class = inventory_import.SupabaseReader
    reader_class = _snapshot_reader_class(
        envelope,
        direct_reader_class=direct_reader_class,
    )
    print(
        "USING encrypted authoritative direct-DB inventory snapshot from Git; "
        "authenticated read-only Production API fallback is allowed only for a "
        "legacy/new Supabase server-key mismatch",
        flush=True,
    )

    inventory_import.SupabaseReader = reader_class
    import sync_all_inventory_training_truth_v3 as target

    # v3 delegates the audited census/import loop to v2, so bind the same guarded
    # reader on the delegated module as well.
    target.v2.SupabaseReader = reader_class
    return target.main()


if __name__ == "__main__":
    raise SystemExit(main())
