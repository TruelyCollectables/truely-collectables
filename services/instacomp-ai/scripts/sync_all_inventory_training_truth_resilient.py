#!/usr/bin/env python3
from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import import_inventory_training_truth as inventory_import


DEFAULT_PAGE_SIZE = 500
MAX_ATTEMPTS = 5
TRANSIENT_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}


def _retry_delay(attempt: int, response: httpx.Response | None = None) -> float:
    if response is not None:
        retry_after = response.headers.get("retry-after")
        if retry_after:
            try:
                parsed = float(retry_after)
            except ValueError:
                parsed = 0.0
            if parsed > 0:
                return min(parsed, 15.0)
    return min(float(2 ** (attempt - 1)), 8.0)


class ResilientSupabaseReader(inventory_import.SupabaseReader):
    """Read-only PostgREST pager that survives transient Production network failures."""

    def table(
        self,
        name: str,
        *,
        select: str = "*",
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0
        while True:
            end = start + page_size - 1
            response: httpx.Response | None = None
            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    response = self.client.get(
                        f"{self.rest_url}/{name}",
                        params={"select": select},
                        headers={"Range-Unit": "items", "Range": f"{start}-{end}"},
                    )
                except httpx.TransportError as exc:
                    if attempt >= MAX_ATTEMPTS:
                        raise SystemExit(
                            "Read-only Supabase query exhausted retries for "
                            f"{name} rows {start}-{end}: {type(exc).__name__}: {exc}"
                        ) from exc
                    delay = _retry_delay(attempt)
                    print(
                        "RETRY Supabase read "
                        f"{name} rows {start}-{end}: {type(exc).__name__} "
                        f"attempt {attempt}/{MAX_ATTEMPTS}; sleeping {delay:.0f}s",
                        file=sys.stderr,
                        flush=True,
                    )
                    time.sleep(delay)
                    continue

                if response.status_code in {200, 206}:
                    break

                if response.status_code in TRANSIENT_HTTP_STATUSES:
                    if attempt >= MAX_ATTEMPTS:
                        raise SystemExit(
                            "Read-only Supabase query exhausted retries for "
                            f"{name} rows {start}-{end}: HTTP {response.status_code}: "
                            f"{response.text[:500]}"
                        )
                    delay = _retry_delay(attempt, response)
                    print(
                        "RETRY Supabase read "
                        f"{name} rows {start}-{end}: HTTP {response.status_code} "
                        f"attempt {attempt}/{MAX_ATTEMPTS}; sleeping {delay:.0f}s",
                        file=sys.stderr,
                        flush=True,
                    )
                    time.sleep(delay)
                    continue

                raise SystemExit(
                    f"Read-only Supabase query failed for {name}: HTTP {response.status_code}: "
                    f"{response.text[:500]}"
                )
            else:  # pragma: no cover - loop exits through break or SystemExit
                raise SystemExit(f"Read-only Supabase query unexpectedly exhausted for {name}")

            assert response is not None
            page = response.json()
            if not isinstance(page, list):
                raise SystemExit(f"Unexpected Supabase payload for {name}")
            rows.extend(row for row in page if isinstance(row, dict))
            if len(page) < page_size:
                break
            start += page_size
        return rows


def main() -> int:
    # Patch before importing v2 so its direct SupabaseReader binding is resilient too.
    inventory_import.SupabaseReader = ResilientSupabaseReader
    import sync_all_inventory_training_truth_v2 as target

    target.SupabaseReader = ResilientSupabaseReader
    return target.main()


if __name__ == "__main__":
    raise SystemExit(main())
