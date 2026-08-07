import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.deal_hunter_learning import (
    DEFAULT_DEAL_HUNTER_LESSONS,
    candidate_policy_receipt,
    decision_learning_manifest,
    initialize_decision_learning,
    load_decision_lessons,
    record_decision_learning_event,
    shipping_share,
    total_acquisition_cost,
)


class DealHunterDecisionLearningTests(unittest.TestCase):
    def test_total_acquisition_cost_uses_shipping_not_sticker_price(self):
        self.assertEqual(total_acquisition_cost(item_price=7, inbound_shipping=6), 13.0)
        self.assertEqual(shipping_share(item_price=7, inbound_shipping=6), 0.4615)

    def test_low_price_high_shipping_lot_is_not_treated_as_seven_dollar_deal(self):
        receipt = candidate_policy_receipt(
            {
                "title": "WNBA rookie card lot",
                "itemPrice": 7,
                "inboundShipping": 6,
                "buyerFees": 0,
                "tax": 0,
                "imageUrls": ["https://example.test/a.jpg", "https://example.test/b.jpg"],
            }
        )
        self.assertEqual(receipt["total_acquisition_cost_before_estimated_tax"], 13.0)
        self.assertTrue(receipt["probable_lot"])
        self.assertIn("low_price_high_shipping_requires_hidden_value", receipt["manual_review_signals"])
        self.assertIn("lot_requires_multi_card_image_forensics", receipt["manual_review_signals"])

    def test_policy_requires_real_image_evidence_for_lots(self):
        receipt = candidate_policy_receipt(
            {
                "title": "Assorted Prizm collection",
                "itemPrice": 20,
                "inboundShipping": 0,
                "imageUrls": ["https://example.test/group.jpg"],
            }
        )
        self.assertIn("lot_requires_multi_card_image_forensics", receipt["manual_review_signals"])
        self.assertIn("insufficient_distinct_listing_images", receipt["manual_review_signals"])

    def test_manifest_keeps_marketplace_learning_out_of_identity_truth(self):
        manifest = decision_learning_manifest()
        self.assertEqual(manifest["lesson_count"], len(DEFAULT_DEAL_HUNTER_LESSONS))
        self.assertGreaterEqual(manifest["lesson_count"], 20)
        self.assertFalse(manifest["separation"]["unverified_marketplace_guess_may_become_identity_truth"])

    def test_lessons_and_operator_feedback_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "instacomp.sqlite3"
            initialize_decision_learning(db_path)
            lessons = load_decision_lessons(db_path)
            self.assertEqual(len(lessons), len(DEFAULT_DEAL_HUNTER_LESSONS))
            self.assertTrue(any(row["lesson_key"] == "landed_cost_not_sticker" for row in lessons))

            record_decision_learning_event(
                db_path,
                candidate_key="mercari:example",
                event_type="PASS_TOO_MUCH_SHIPPING",
                payload={"item_price": 7, "shipping": 6, "operator_note": "shipping kills deal"},
            )

            with sqlite3.connect(db_path) as db:
                row = db.execute(
                    "SELECT event_type, trusted, payload_json FROM deal_hunter_learning_events"
                ).fetchone()
            self.assertEqual(row[0], "PASS_TOO_MUCH_SHIPPING")
            self.assertEqual(row[1], 1)
            self.assertIn('"shipping": 6', row[2])


if __name__ == "__main__":
    unittest.main()
