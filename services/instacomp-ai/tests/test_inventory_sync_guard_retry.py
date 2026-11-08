from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = SERVICE_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import sync_all_inventory_training_truth_guarded as target


class _FakeProcess:
    def __init__(self, lines: list[str], exit_code: int):
        self.stdout = [line if line.endswith("\n") else line + "\n" for line in lines]
        self._exit_code = exit_code

    def wait(self) -> int:
        return self._exit_code


class _PopenSequence:
    def __init__(self, specs: list[dict]):
        self.specs = list(specs)
        self.calls = 0

    def __call__(self, command, **kwargs):
        self.calls += 1
        spec = self.specs[self.calls - 1]
        if spec.get("final_receipt") is not None:
            receipt_index = command.index("--receipt") + 1
            receipt = Path(command[receipt_index])
            receipt.write_text(json.dumps(spec["final_receipt"]) + "\n", encoding="utf-8")
        return _FakeProcess(spec.get("lines", []), int(spec.get("exit_code", 0)))


class GuardedInventoryRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_popen = target.subprocess.Popen
        self.original_sleep = target._sleep
        self.original_argv = sys.argv[:]
        self.sleeps: list[float] = []
        target._sleep = self.sleeps.append

    def tearDown(self) -> None:
        target.subprocess.Popen = self.original_popen
        target._sleep = self.original_sleep
        sys.argv = self.original_argv

    def _run(self, popen: _PopenSequence) -> tuple[int, dict, str]:
        with tempfile.TemporaryDirectory(prefix="deal-hunter-guard-test-") as tmp:
            root = Path(tmp)
            receipt = root / "receipt.json"
            log_path = root / "sync.log"
            target.subprocess.Popen = popen
            sys.argv = [
                "sync_all_inventory_training_truth_guarded.py",
                "--receipt",
                str(receipt),
                "--log",
                str(log_path),
            ]
            code = target.main()
            payload = json.loads(receipt.read_text("utf-8"))
            log_text = log_path.read_text("utf-8")
            return code, payload, log_text

    def test_exact_pgrst002_failure_retries_full_sync_then_succeeds(self) -> None:
        popen = _PopenSequence([
            {
                "lines": [
                    'Read-only Supabase query failed for inventory_items: HTTP 503: '
                    '{"code":"PGRST002","message":"Could not query the database for the schema cache. Retrying."}'
                ],
                "exit_code": 1,
            },
            {
                "lines": ["inventory sync complete"],
                "exit_code": 0,
                "final_receipt": {
                    "schema_version": "tcos.instacomp-ai.inventory-training-import.v4",
                    "training": {"inventory_training_coverage_percent": 100.0},
                },
            },
        ])

        code, payload, log_text = self._run(popen)

        self.assertEqual(code, 0)
        self.assertEqual(popen.calls, 2)
        self.assertEqual(self.sleeps, [5.0])
        self.assertEqual(payload["schema_version"], "tcos.instacomp-ai.inventory-training-import.v4")
        self.assertIn("GUARD RETRY", log_text)

    def test_transient_failure_exhausts_three_full_sync_attempts(self) -> None:
        failure = {
            "lines": [
                'Read-only Supabase query failed for inventory_items: HTTP 503: {"code":"PGRST002"}'
            ],
            "exit_code": 1,
        }
        popen = _PopenSequence([failure, failure, failure])

        code, payload, log_text = self._run(popen)

        self.assertEqual(code, 1)
        self.assertEqual(popen.calls, target._MAX_TARGET_ATTEMPTS)
        self.assertEqual(self.sleeps, [5.0, 10.0])
        self.assertEqual(payload["schema_version"], target.WRAPPER_SCHEMA)
        self.assertEqual(payload["status"], "sync_failed_before_receipt")
        self.assertEqual(log_text.count("GUARD RETRY"), 2)

    def test_nonretryable_failure_does_not_rerun(self) -> None:
        popen = _PopenSequence([
            {
                "lines": ["Read-only Supabase query failed for inventory_items: HTTP 404"],
                "exit_code": 1,
            }
        ])

        code, payload, _ = self._run(popen)

        self.assertEqual(code, 1)
        self.assertEqual(popen.calls, 1)
        self.assertEqual(self.sleeps, [])
        self.assertEqual(payload["status"], "sync_failed_before_receipt")

    def test_real_v3_receipt_is_never_retried_even_if_output_mentions_503(self) -> None:
        popen = _PopenSequence([
            {
                "lines": ["image fetch HTTP 503 exhausted; quarantined"],
                "exit_code": 2,
                "final_receipt": {
                    "schema_version": "tcos.instacomp-ai.inventory-training-import.v4",
                    "training": {"inventory_training_coverage_percent": 99.9},
                },
            }
        ])

        code, payload, _ = self._run(popen)

        self.assertEqual(code, 2)
        self.assertEqual(popen.calls, 1)
        self.assertEqual(self.sleeps, [])
        self.assertEqual(payload["schema_version"], "tcos.instacomp-ai.inventory-training-import.v4")


if __name__ == "__main__":
    unittest.main()
