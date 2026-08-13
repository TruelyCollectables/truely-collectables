from __future__ import annotations

import unittest

from app.inventory_learning_completion import apply_learning_completion_policy


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


if __name__ == "__main__":
    unittest.main()
