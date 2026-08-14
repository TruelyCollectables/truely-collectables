from __future__ import annotations

import sys
import unittest
from pathlib import Path

from app.inventory_learning_completion import apply_learning_completion_policy

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = SERVICE_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from inventory_training_git_snapshot import SnapshotInvalid
import sync_all_inventory_training_truth_snapshot_only as snapshot_target


class LearningCompletionPolicyTests(unittest.TestCase):
    def _receipt(self) -> dict:
        return {
            "counts": {},
            "strict_inventory_coverage": {
                "inventory_card_total": 100,
                "inventory_card_rows_represented": 90,
                "inventory_training_coverage_percent": 90.0,
            },
            "training": {
                "inventory_eligible_learned": 88,
                "inventory_card_rows_total": 100,
                "inventory_card_rows_represented": 90,
            },
            "safety": {},
        }

    def test_quarantine_preserves_strict_coverage(self) -> None:
        receipt = self._receipt()
        receipt["counts"].update({
            "skipped_incomplete_structured_identity": 4,
            "skipped_no_usable_image": 2,
            "skipped_image_error": 3,
            "skipped_current_inventory_pair_identity_conflict": 1,
        })
        result = apply_learning_completion_policy(receipt)

        self.assertEqual(result["strict_inventory_coverage"]["inventory_training_coverage_percent"], 90.0)
        self.assertEqual(result["training"]["inventory_training_coverage_percent"], 100.0)
        self.assertEqual(result["training"]["inventory_training_outstanding"], 0)
        self.assertEqual(result["training"]["inventory_eligible_total"], 88)
        self.assertEqual(result["training_quarantine"]["quarantined_inventory_rows"], 10)

    def test_unaccounted_row_blocks_eligibility(self) -> None:
        receipt = self._receipt()
        receipt["counts"]["skipped_no_usable_image"] = 9
        result = apply_learning_completion_policy(receipt)

        self.assertEqual(result["training_quarantine"]["unresolved_inventory_rows"], 1)
        self.assertEqual(result["training"]["inventory_training_outstanding"], 1)
        self.assertLess(result["training"]["inventory_training_coverage_percent"], 100.0)

    def test_fatal_import_error_blocks_eligibility(self) -> None:
        receipt = self._receipt()
        receipt["counts"]["skipped_no_usable_image"] = 10
        receipt["counts"]["skipped_lesson_create_error"] = 1
        result = apply_learning_completion_policy(receipt)

        self.assertEqual(result["training_quarantine"]["fatal_importer_rows"], 1)
        self.assertEqual(result["training"]["inventory_training_outstanding"], 1)
        self.assertLess(result["training"]["inventory_training_coverage_percent"], 100.0)


class _FakeDirectReader:
    instances = []

    def __init__(self, base_url: str, service_key: str):
        self.base_url = base_url
        self.service_key = service_key
        self.closed = False
        type(self).instances.append(self)

    def table(self, name: str, *, select: str = "*", page_size: int = 1000):
        return [{"source": "direct", "name": name, "select": select, "page_size": page_size}]

    def close(self) -> None:
        self.closed = True


class _FakeSnapshotReader:
    instances = []

    def __init__(self, base_url: str, service_key: str, *, envelope):
        self.base_url = base_url
        self.service_key = service_key
        self.envelope = envelope
        self.closed = False
        type(self).instances.append(self)

    def table(self, name: str, *, select: str = "*", page_size: int = 1000):
        return [{"source": "snapshot", "name": name, "select": select, "page_size": page_size}]

    def close(self) -> None:
        self.closed = True


class _FakeSnapshotKeyMismatch:
    def __init__(self, base_url: str, service_key: str, *, envelope):
        raise SnapshotInvalid("inventory snapshot authentication failed; refusing untrusted training data")


class _FakeSnapshotCorrupt:
    def __init__(self, base_url: str, service_key: str, *, envelope):
        raise SnapshotInvalid("inventory snapshot schema mismatch: 'broken'")


class SnapshotKeyMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        _FakeDirectReader.instances.clear()
        _FakeSnapshotReader.instances.clear()

    def test_snapshot_success_does_not_use_direct_fallback(self) -> None:
        reader_class = snapshot_target._snapshot_reader_class(
            {"schema_version": "test"},
            direct_reader_class=_FakeDirectReader,
            snapshot_reader_class=_FakeSnapshotReader,
        )
        reader = reader_class("https://example.supabase.co", "legacy-service-role")

        self.assertEqual(reader.source, "encrypted_authoritative_direct_db_snapshot")
        self.assertEqual(reader.table("inventory_items")[0]["source"], "snapshot")
        self.assertEqual(len(_FakeDirectReader.instances), 0)
        reader.close()
        self.assertTrue(_FakeSnapshotReader.instances[0].closed)

    def test_exact_user_authentication_failure_uses_current_server_key(self) -> None:
        reader_class = snapshot_target._snapshot_reader_class(
            {"schema_version": "test"},
            direct_reader_class=_FakeDirectReader,
            snapshot_reader_class=_FakeSnapshotKeyMismatch,
        )
        reader = reader_class("https://example.supabase.co", "sb_secret_current")

        self.assertEqual(reader.source, "authenticated_read_only_production_api_fallback")
        self.assertEqual(len(_FakeDirectReader.instances), 1)
        direct = _FakeDirectReader.instances[0]
        self.assertEqual(direct.base_url, "https://example.supabase.co")
        self.assertEqual(direct.service_key, "sb_secret_current")
        self.assertEqual(reader.table("inventory_items")[0]["source"], "direct")
        reader.close()
        self.assertTrue(direct.closed)

    def test_other_snapshot_integrity_failure_still_fails_closed(self) -> None:
        reader_class = snapshot_target._snapshot_reader_class(
            {"schema_version": "test"},
            direct_reader_class=_FakeDirectReader,
            snapshot_reader_class=_FakeSnapshotCorrupt,
        )

        with self.assertRaisesRegex(SnapshotInvalid, "schema mismatch"):
            reader_class("https://example.supabase.co", "sb_secret_current")
        self.assertEqual(len(_FakeDirectReader.instances), 0)

    def test_user_traceback_message_is_recognized_as_key_mismatch(self) -> None:
        exc = SnapshotInvalid("inventory snapshot authentication failed; refusing untrusted training data")
        self.assertTrue(snapshot_target._is_snapshot_key_mismatch(exc))
        self.assertFalse(
            snapshot_target._is_snapshot_key_mismatch(
                SnapshotInvalid("inventory snapshot decode failed")
            )
        )


if __name__ == "__main__":
    unittest.main()
