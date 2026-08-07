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


def test_total_acquisition_cost_uses_shipping_not_sticker_price():
    assert total_acquisition_cost(item_price=7, inbound_shipping=6) == 13.0
    assert shipping_share(item_price=7, inbound_shipping=6) == 0.4615


def test_low_price_high_shipping_lot_is_not_treated_as_seven_dollar_deal():
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
    assert receipt["total_acquisition_cost_before_estimated_tax"] == 13.0
    assert receipt["probable_lot"] is True
    assert "low_price_high_shipping_requires_hidden_value" in receipt["manual_review_signals"]
    assert "lot_requires_multi_card_image_forensics" in receipt["manual_review_signals"]


def test_policy_requires_real_image_evidence_for_lots():
    receipt = candidate_policy_receipt(
        {
            "title": "Assorted Prizm collection",
            "itemPrice": 20,
            "inboundShipping": 0,
            "imageUrls": ["https://example.test/group.jpg"],
        }
    )
    assert "lot_requires_multi_card_image_forensics" in receipt["manual_review_signals"]
    assert "insufficient_distinct_listing_images" in receipt["manual_review_signals"]


def test_manifest_keeps_marketplace_learning_out_of_identity_truth():
    manifest = decision_learning_manifest()
    assert manifest["lesson_count"] == len(DEFAULT_DEAL_HUNTER_LESSONS)
    assert manifest["lesson_count"] >= 20
    assert manifest["separation"]["unverified_marketplace_guess_may_become_identity_truth"] is False


def test_lessons_and_operator_feedback_persist(tmp_path: Path):
    db_path = tmp_path / "instacomp.sqlite3"
    initialize_decision_learning(db_path)
    lessons = load_decision_lessons(db_path)
    assert len(lessons) == len(DEFAULT_DEAL_HUNTER_LESSONS)
    assert any(row["lesson_key"] == "landed_cost_not_sticker" for row in lessons)

    record_decision_learning_event(
        db_path,
        candidate_key="mercari:example",
        event_type="PASS_TOO_MUCH_SHIPPING",
        payload={"item_price": 7, "shipping": 6, "operator_note": "shipping kills deal"},
    )

    import sqlite3

    with sqlite3.connect(db_path) as db:
        row = db.execute(
            "SELECT event_type, trusted, payload_json FROM deal_hunter_learning_events"
        ).fetchone()
    assert row[0] == "PASS_TOO_MUCH_SHIPPING"
    assert row[1] == 1
    assert '"shipping": 6' in row[2]
