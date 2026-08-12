from __future__ import annotations

from app.inventory_training_keys import resolve_inventory_learning_uuid


def test_existing_inventory_card_uuid_wins():
    resolved, source = resolve_inventory_learning_uuid(
        {
            "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "card_uuid": "11111111-1111-4111-8111-111111111111",
        },
        {"card_uuid": "22222222-2222-4222-8222-222222222222"},
    )
    assert resolved == "11111111-1111-4111-8111-111111111111"
    assert source == "inventory_card_uuid"


def test_product_card_uuid_is_second_priority():
    resolved, source = resolve_inventory_learning_uuid(
        {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "card_uuid": None},
        {"card_uuid": "22222222-2222-4222-8222-222222222222"},
    )
    assert resolved == "22222222-2222-4222-8222-222222222222"
    assert source == "product_card_uuid"


def test_inventory_item_uuid_is_used_when_card_uuid_is_missing():
    resolved, source = resolve_inventory_learning_uuid(
        {
            "id": "3a40789e-0011-41b5-9430-d071a5fe4810",
            "card_uuid": None,
        },
        None,
    )
    assert resolved == "3a40789e-0011-41b5-9430-d071a5fe4810"
    assert source == "inventory_item_id"


def test_legacy_non_uuid_inventory_id_gets_stable_uuid5():
    first, first_source = resolve_inventory_learning_uuid({"id": "legacy-item-123"}, None)
    second, second_source = resolve_inventory_learning_uuid({"id": "legacy-item-123"}, None)
    other, _ = resolve_inventory_learning_uuid({"id": "legacy-item-124"}, None)

    assert first is not None
    assert first == second
    assert first != other
    assert first_source == "inventory_item_id_uuid5"
    assert second_source == "inventory_item_id_uuid5"


def test_missing_everything_stays_fail_closed():
    resolved, source = resolve_inventory_learning_uuid({}, None)
    assert resolved is None
    assert source == "missing_inventory_identity_key"
