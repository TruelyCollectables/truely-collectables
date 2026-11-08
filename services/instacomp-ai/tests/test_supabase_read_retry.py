from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = SERVICE_ROOT / "scripts"
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import sync_all_inventory_training_truth_snapshot_only as target


class _FakeResponse:
    def __init__(self, status_code: int, payload, headers: dict[str, str] | None = None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _SequenceClient:
    def __init__(self, sequence):
        self.sequence = list(sequence)
        self.calls = 0

    def get(self, *args, **kwargs):
        self.calls += 1
        item = self.sequence.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self) -> None:
        pass


def _reader_with(client):
    reader = object.__new__(target._CurrentServerKeySupabaseReader)
    reader.rest_url = "https://example.supabase.co/rest/v1"
    reader.client = client
    return reader


class SupabaseReadRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_sleep = target._sleep
        self.sleeps: list[float] = []
        target._sleep = self.sleeps.append

    def tearDown(self) -> None:
        target._sleep = self.original_sleep

    def test_exact_pgrst002_503_then_success_retries(self) -> None:
        client = _SequenceClient([
            _FakeResponse(
                503,
                {
                    "code": "PGRST002",
                    "details": None,
                    "hint": None,
                    "message": "Could not query the database for the schema cache. Retrying.",
                },
            ),
            _FakeResponse(200, [{"id": "ok"}]),
        ])

        rows = _reader_with(client).table("inventory_items")

        self.assertEqual(rows, [{"id": "ok"}])
        self.assertEqual(client.calls, 2)
        self.assertEqual(self.sleeps, [0.75])

    def test_pgrst002_exhaustion_still_fails(self) -> None:
        client = _SequenceClient([
            _FakeResponse(503, {"code": "PGRST002"})
            for _ in range(target._MAX_READ_ATTEMPTS)
        ])

        with self.assertRaisesRegex(SystemExit, "HTTP 503"):
            _reader_with(client).table("inventory_items")

        self.assertEqual(client.calls, target._MAX_READ_ATTEMPTS)
        self.assertEqual(len(self.sleeps), target._MAX_READ_ATTEMPTS - 1)

    def test_nonretryable_404_fails_immediately(self) -> None:
        client = _SequenceClient([
            _FakeResponse(404, {"code": "PGRST205"}),
        ])

        with self.assertRaisesRegex(SystemExit, "HTTP 404"):
            _reader_with(client).table("inventory_items")

        self.assertEqual(client.calls, 1)
        self.assertEqual(self.sleeps, [])

    def test_transport_error_then_success_retries(self) -> None:
        request = httpx.Request("GET", "https://example.supabase.co")
        client = _SequenceClient([
            httpx.ConnectError("temporary", request=request),
            _FakeResponse(200, [{"id": "ok"}]),
        ])

        rows = _reader_with(client).table("inventory_items")

        self.assertEqual(rows, [{"id": "ok"}])
        self.assertEqual(client.calls, 2)
        self.assertEqual(self.sleeps, [0.75])

    def test_retry_after_header_is_honored(self) -> None:
        client = _SequenceClient([
            _FakeResponse(503, {"code": "PGRST002"}, {"retry-after": "3"}),
            _FakeResponse(200, []),
        ])

        self.assertEqual(_reader_with(client).table("inventory_items"), [])
        self.assertEqual(self.sleeps, [3.0])


if __name__ == "__main__":
    unittest.main()
