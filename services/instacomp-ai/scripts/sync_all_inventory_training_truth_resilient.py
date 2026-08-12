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


DEFAULT_PAGE_SIZE = 250
MIN_PAGE_SIZE = 50
MAX_ATTEMPTS_AT_MIN_PAGE = 5
SHRINK_AFTER_ATTEMPTS = 2
TRANSIENT_HTTP_STATUSES = {
    408,
    425,
    429,
    500,
    502,
    503,
    504,
    520,
    521,
    522,
    523,
    524,
    525,
    526,
}


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


def _smaller_page_size(current: int, floor: int) -> int:
    if current <= floor:
        return current
    return max(floor, current // 2)


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
        current_page_size = max(1, int(page_size))
        floor_page_size = min(MIN_PAGE_SIZE, current_page_size)

        while True:
            attempt = 0
            response: httpx.Response | None = None

            while True:
                end = start + current_page_size - 1
                attempt += 1
                transport_error: httpx.TransportError | None = None

                try:
                    response = self.client.get(
                        f"{self.rest_url}/{name}",
                        params={"select": select},
                        headers={"Range-Unit": "items", "Range": f"{start}-{end}"},
                    )
                except httpx.TransportError as exc:
                    transport_error = exc
                    response = None

                if response is not None and response.status_code in {200, 206}:
                    break

                if response is not None and response.status_code not in TRANSIENT_HTTP_STATUSES:
                    raise SystemExit(
                        f"Read-only Supabase query failed for {name}: HTTP {response.status_code}: "
                        f"{response.text[:500]}"
                    )

                transient_label = (
                    f"HTTP {response.status_code}"
                    if response is not None
                    else type(transport_error).__name__ if transport_error is not None else "transport_error"
                )

                if attempt >= SHRINK_AFTER_ATTEMPTS and current_page_size > floor_page_size:
                    previous_size = current_page_size
                    current_page_size = _smaller_page_size(current_page_size, floor_page_size)
                    print(
                        "SHRINK Supabase read page "
                        f"{name} at row {start}: {transient_label}; "
                        f"{previous_size}->{current_page_size} rows",
                        file=sys.stderr,
                        flush=True,
                    )
                    attempt = 0
                    continue

                if current_page_size <= floor_page_size and attempt >= MAX_ATTEMPTS_AT_MIN_PAGE:
                    detail = (
                        f"HTTP {response.status_code}: {response.text[:500]}"
                        if response is not None
                        else f"{type(transport_error).__name__}: {transport_error}"
                    )
                    raise SystemExit(
                        "Read-only Supabase query exhausted retries for "
                        f"{name} rows {start}-{end} at minimum page size "
                        f"{current_page_size}: {detail}"
                    ) from transport_error

                delay = _retry_delay(attempt, response)
                print(
                    "RETRY Supabase read "
                    f"{name} rows {start}-{end}: {transient_label} "
                    f"attempt {attempt}; sleeping {delay:.0f}s",
                    file=sys.stderr,
                    flush=True,
                )
                time.sleep(delay)

            assert response is not None
            page = response.json()
            if not isinstance(page, list):
                raise SystemExit(f"Unexpected Supabase payload for {name}")
            rows.extend(row for row in page if isinstance(row, dict))
            if len(page) < current_page_size:
                break
            start += current_page_size

        return rows


def main() -> int:
    # Patch before importing v2 so its direct SupabaseReader binding is resilient too.
    inventory_import.SupabaseReader = ResilientSupabaseReader
    import sync_all_inventory_training_truth_v2 as target

    target.SupabaseReader = ResilientSupabaseReader
    return target.main()


if __name__ == "__main__":
    raise SystemExit(main())
