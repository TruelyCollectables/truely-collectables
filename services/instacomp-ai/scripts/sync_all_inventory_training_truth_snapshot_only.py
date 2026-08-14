#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import import_inventory_training_truth as inventory_import
from inventory_training_git_snapshot import SnapshotInvalid, SnapshotSupabaseReader, fetch_envelope_from_git


def _is_snapshot_key_mismatch(exc: SnapshotInvalid) -> bool:
    """Return True only for the expected legacy/new Supabase API-key mismatch."""
    return "snapshot authentication failed" in str(exc).lower()


def _supabase_readonly_headers(server_key: str) -> dict[str, str]:
    key = str(server_key or "").strip()
    if not key:
        raise ValueError("Supabase server key is required")
    headers = {
        "apikey": key,
        "Accept": "application/json",
    }
    # Modern sb_secret_* keys are opaque API keys, not JWTs. Supabase requires
    # them on apikey only; sending one as Authorization: Bearer is rejected as
    # an invalid JWT. Legacy service_role keys remain JWTs and use Bearer auth.
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


class _CurrentServerKeySupabaseReader:
    """Read-only Production PostgREST reader supporting legacy and sb_secret keys."""

    def __init__(self, base_url: str, server_key: str):
        self.rest_url = f"{str(base_url).rstrip('/')}/rest/v1"
        self.client = httpx.Client(
            headers=_supabase_readonly_headers(server_key),
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


def _snapshot_reader_class(
    envelope: dict[str, Any],
    *,
    direct_reader_class=None,
    snapshot_reader_class=None,
):
    direct_reader = direct_reader_class or _CurrentServerKeySupabaseReader
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
                # The encrypted snapshot may have been produced with the legacy
                # service_role key while this Mac now has a newer sb_secret_* key.
                # Those credentials have equivalent elevated access but different
                # bytes, so the old envelope cannot authenticate with the new key.
                # In only that known case, perform an authenticated read-only
                # Production API read with the current server key. Every other
                # snapshot integrity/decode/schema error still fails closed.
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
    reader_class = _snapshot_reader_class(envelope)
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
