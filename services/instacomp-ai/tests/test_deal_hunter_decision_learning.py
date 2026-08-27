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

    def test_low_price_high_shipping_lot_requires_hidden_value(self):
        receipt = candidate_policy_receipt({"title": "WNBA rookie card lot", "itemPrice": 7, "inboundShipping": 6, "imageUrls": ["a", "b"]})
        self.assertEqual(receipt["total_acquisition_cost_before_estimated_tax"], 13.0)
        self.assertTrue(receipt["probable_lot"])
        self.assertIn("low_price_high_shipping_requires_hidden_value", receipt["manual_review_signals"])
        self.assertIn("lot_requires_multi_card_image_forensics", receipt["manual_review_signals"])

    def test_identity_and_marketplace_learning_stay_separate(self):
        manifest = decision_learning_manifest()
        self.assertGreaterEqual(manifest["lesson_count"], 20)
        self.assertFalse(manifest["separation"]["unverified_marketplace_guess_may_become_identity_truth"])

    def test_lessons_and_feedback_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "instacomp.sqlite3"
            initialize_decision_learning(path)
            self.assertEqual(len(load_decision_lessons(path)), len(DEFAULT_DEAL_HUNTER_LESSONS))
            record_decision_learning_event(path, candidate_key="mercari:test", event_type="PASS_TOO_MUCH_SHIPPING", payload={"item_price": 7, "shipping": 6})
            with sqlite3.connect(path) as db:
                row = db.execute("select event_type, trusted, payload_json from deal_hunter_learning_events").fetchone()
            self.assertEqual(row[0], "PASS_TOO_MUCH_SHIPPING")
            self.assertEqual(row[1], 1)
            self.assertIn('"shipping": 6', row[2])


if __name__ == "__main__":
    unittest.main()
