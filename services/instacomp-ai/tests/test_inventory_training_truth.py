from __future__ import annotations

from app.inventory_training import (
    build_inventory_truth,
    extract_inventory_identity,
    identity_has_training_truth,
    inventory_item_is_card,
    select_inventory_images,
)


def test_explicit_inventory_identity_wins_over_lower_priority_fields():
    item = {
        "id": "item-1",
        "card_uuid": "11111111-1111-4111-8111-111111111111",
        "title": "Correct inventory title",
        "category": "Sports Trading Cards",
        "metadata": {
            "card_identity": {
                "sport": "Basketball",
                "year": "2023-24",
                "brand": "Panini Prizm",
                "set_name": "Prizm",
                "player": "Victor Wembanyama",
                "card_number": "136",
                "parallel": "Silver Prizm",
                "rookie": True,
            },
            "player": "WRONG LOWER PRIORITY",
        },
    }
    identity = extract_inventory_identity(
        item,
        attributes={"Player/Athlete": "WRONG ATTRIBUTE", "Card Number": "999"},
        product={"player": "WRONG PRODUCT"},
    )
    assert identity.player == "Victor Wembanyama"
    assert identity.card_number == "136"
    assert identity.parallel == "Silver Prizm"
    assert identity.rookie is True
    assert identity_has_training_truth(identity)


def test_collx_style_structured_inventory_maps_without_title_guessing():
    item = {
        "id": "item-2",
        "card_uuid": "22222222-2222-4222-8222-222222222222",
        "title": "This title is deliberately not parsed",
        "category": "Sports Trading Cards",
        "metadata": {
            "source": "collx_csv_snapshot",
            "year": "2020-21",
            "name": "Connor McDavid",
            "number": "97",
            "brand": "Upper Deck",
            "set": "Series 1",
            "flags": ["All-Star"],
        },
    }
    identity = extract_inventory_identity(item, attributes={}, product={"sport": "Hockey"})
    assert identity.sport == "Hockey"
    assert identity.year == "2020-21"
    assert identity.player == "Connor McDavid"
    assert identity.card_number == "97"
    assert identity.brand == "Upper Deck"
    assert identity.set_name == "Series 1"
    assert identity.parallel is None
    assert identity.serial_run is None
    assert identity_has_training_truth(identity)


def test_serial_truth_is_only_taken_from_explicit_structured_fields():
    item = {
        "id": "item-3",
        "card_uuid": "33333333-3333-4333-8333-333333333333",
        "title": "Player Gold 17/99 -- title must not create serial truth",
        "category": "Sports Trading Cards",
        "metadata": {},
    }
    identity = extract_inventory_identity(
        item,
        attributes={
            "Sport": "Football",
            "Year": "2024",
            "Player/Athlete": "Jayden Daniels",
            "Set": "Prizm",
            "Card Number": "301",
            "Serial Number": "17/99",
            "Print Run": "99",
        },
    )
    assert identity.serial_number == "17/99"
    assert identity.serial_run == 99

    no_explicit_serial = extract_inventory_identity(
        {**item, "title": "Jayden Daniels #301 Gold 17/99"},
        attributes={
            "Sport": "Football",
            "Year": "2024",
            "Player/Athlete": "Jayden Daniels",
            "Set": "Prizm",
            "Card Number": "301",
        },
    )
    assert no_explicit_serial.serial_number is None
    assert no_explicit_serial.serial_run is None


def test_two_image_inventory_uses_order_as_front_back_only_for_exact_pair():
    front, back, source = select_inventory_images(
        [
            {"url": "https://cdn.example/card-a.jpg", "sort_order": 0},
            {"url": "https://cdn.example/card-b.jpg", "sort_order": 1},
        ]
    )
    assert front == "https://cdn.example/card-a.jpg"
    assert back == "https://cdn.example/card-b.jpg"
    assert source == "two_image_order"

    front, back, source = select_inventory_images(
        [
            {"url": "https://cdn.example/gallery-a.jpg", "sort_order": 0},
            {"url": "https://cdn.example/gallery-b.jpg", "sort_order": 1},
            {"url": "https://cdn.example/gallery-c.jpg", "sort_order": 2},
        ]
    )
    assert front == "https://cdn.example/gallery-a.jpg"
    assert back is None
    assert source == "ordered_inventory_images"


def test_collx_filename_markers_override_sort_order():
    front, back, source = select_inventory_images(
        [
            {"url": "https://cdn.example/12345-2-back.jpg", "sort_order": 0},
            {"url": "https://cdn.example/12345-1-front.jpg", "sort_order": 1},
        ]
    )
    assert front.endswith("12345-1-front.jpg")
    assert back.endswith("12345-2-back.jpg")
    assert source == "explicit_markers"


def test_build_inventory_truth_requires_uuid_structured_truth_and_image():
    item = {
        "id": "item-4",
        "card_uuid": "44444444-4444-4444-8444-444444444444",
        "title": "Inventory card",
        "category": "Sports Trading Cards",
        "metadata": {},
    }
    truth = build_inventory_truth(
        item,
        attributes={
            "Sport": "Baseball",
            "Year": "2025",
            "Player/Athlete": "Paul Skenes",
            "Set": "Topps Chrome",
            "Card Number": "1",
        },
        images=[{"url": "https://cdn.example/skenes-front.jpg", "alt_text": "front", "sort_order": 0}],
    )
    assert truth is not None
    assert truth.card_uuid == item["card_uuid"]
    assert truth.identity.player == "Paul Skenes"
    assert truth.front_url.endswith("skenes-front.jpg")


def test_inventory_card_detection_accepts_current_card_category_and_sport_product():
    assert inventory_item_is_card({"category": "Sports Trading Cards", "title": "A card"})
    assert inventory_item_is_card(
        {"category": "Collectibles", "title": "A card"},
        {"sport": "Hockey", "category": "Sports Trading Cards"},
    )
