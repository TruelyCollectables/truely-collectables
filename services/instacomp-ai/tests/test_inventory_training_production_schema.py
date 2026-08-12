from __future__ import annotations

from app.inventory_training import (
    extract_inventory_identity,
    inventory_card_reason,
    inventory_item_is_card,
    select_inventory_images,
)
from app.inventory_training_schema import attributes_by_item, images_by_item


def test_production_attribute_columns_feed_identity():
    rows = [
        {
            "inventory_item_id": "item-1",
            "attribute_name": "Year",
            "attribute_value": "2025",
        },
        {
            "inventory_item_id": "item-1",
            "attribute_name": "Set",
            "attribute_value": "Upper Deck National Hockey Card Day",
        },
        {
            "inventory_item_id": "item-1",
            "attribute_name": "Player/Athlete",
            "attribute_value": "Macklin Celebrini",
        },
        {
            "inventory_item_id": "item-1",
            "attribute_name": "Card Number",
            "attribute_value": "NHCD-31",
        },
    ]
    indexed = attributes_by_item(rows)
    identity = extract_inventory_identity(
        {"id": "item-1", "title": "correct inventory title"},
        attributes=indexed["item-1"],
    )
    assert identity.year == "2025"
    assert identity.set_name == "Upper Deck National Hockey Card Day"
    assert identity.player == "Macklin Celebrini"
    assert identity.card_number == "NHCD-31"


def test_production_image_url_columns_feed_front_back_selection():
    rows = [
        {
            "inventory_item_id": "item-1",
            "image_url": "https://example.com/card-front.jpg",
            "alt_text": "Front",
            "sort_order": 0,
            "is_primary": True,
        },
        {
            "inventory_item_id": "item-1",
            "image_url": "https://example.com/card-back.jpg",
            "alt_text": "Back",
            "sort_order": 1,
            "is_primary": False,
        },
    ]
    indexed = images_by_item(rows)
    front, back, source = select_inventory_images(indexed["item-1"])
    assert front == "https://example.com/card-front.jpg"
    assert back == "https://example.com/card-back.jpg"
    assert source == "explicit_markers"


def test_normalized_sports_cards_category_is_in_card_census():
    item = {"category": "sports_cards", "title": "Upper Deck Young Guns #201"}
    assert inventory_item_is_card(item)
    assert inventory_card_reason(item) == "inventory_card_category"


def test_normalized_trading_cards_category_is_in_card_census():
    item = {"category": "trading_cards", "title": "Pokemon single"}
    assert inventory_item_is_card(item)
    assert inventory_card_reason(item) == "inventory_card_category"


def test_durable_collx_sku_is_card_even_after_migration_metadata_is_removed():
    item = {
        "sku": "COLLX-1025593273719528448",
        "category": "other",
        "metadata": {"sale_activation_20260811": {"state": "active"}},
        "title": "ME05: Pitch Black #040/084 Marshadow",
    }
    assert inventory_item_is_card(item)
    assert inventory_card_reason(item) == "collx_card_sku"


def test_sealed_wax_does_not_become_single_card_lora_truth():
    item = {
        "sku": "BOX-1",
        "category": "sealed_wax",
        "title": "2025 sealed hobby box",
    }
    assert not inventory_item_is_card(item)
    assert inventory_card_reason(item) is None


def test_non_card_collectible_remains_outside_card_census():
    item = {
        "sku": "SHOE-1",
        "category": "athletic_shoes",
        "title": "New Balance sneakers",
    }
    assert not inventory_item_is_card(item)
    assert inventory_card_reason(item) is None
