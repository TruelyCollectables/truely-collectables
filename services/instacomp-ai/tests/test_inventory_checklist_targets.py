from app.inventory_checklist_targets import _clean_set_name, _infer_manufacturer
from app.sentinel import ChecklistSentinel


def test_parent_release_normalization_collapses_parallel_and_insert_names():
    assert _clean_set_name({"brand": "Topps", "set_name": "2014 Topps National League All-Stars"}) == "Topps"
    assert _clean_set_name({"brand": "Upper Deck", "set_name": "2024-25 Upper Deck Allure - Black Rainbow"}) == "Allure"
    assert _clean_set_name({"brand": "Panini", "set_name": "2021 Panini Prizm Draft Picks Collegiate - Green"}) == "Prizm Draft Picks Collegiate"
    assert _clean_set_name({"set_name": "2022-23 SP Authentic - Limited Red"}) == "SP Authentic"


def test_manufacturer_inference_uses_release_family():
    assert _infer_manufacturer({}, "SP Authentic") == "Upper Deck"
    assert _infer_manufacturer({}, "SP") == "Upper Deck"
    assert _infer_manufacturer({}, "TriStar PROjections") == "TriStar"
    assert _infer_manufacturer({"year": "2017-18"}, "Hoops") == "Panini"
    assert _infer_manufacturer({"year": "2022"}, "Score") == "Panini"
    assert _infer_manufacturer({"year": "2013"}, "Pinnacle") == "Panini"
    assert _infer_manufacturer({"year": "2022-23"}, "Parkhurst Champions") == "Upper Deck"
    assert _infer_manufacturer({"year": "2024-25"}, "SkyBox Metal Universe") == "Upper Deck"
    assert _infer_manufacturer({"year": "2025-26"}, "Flair") == "Upper Deck"
    assert _infer_manufacturer({"year": "1993", "brand": "Fleer"}, "Fleer") == "Fleer"
    assert _infer_manufacturer({"year": "1992"}, "Ultra") == "Fleer"
    assert _infer_manufacturer({"year": "2014-15"}, "Ultra") == "Upper Deck"
    assert _infer_manufacturer({"brand": "Prizm"}, "Prizm Draft Picks Collegiate") == "Panini"
    assert _infer_manufacturer({"brand": "Topps"}, "Topps") == "Topps"


def test_inventory_plan_guard_rejects_wrong_sport_and_accepts_exact_release():
    target = {"scope": "inventory-gap", "sport": "hockey", "year": 2024, "season": "2024-25", "manufacturer": "Upper Deck", "product": "Allure"}
    wrong = {"release": {"releaseYear": "2024", "season": "2024", "sport": "Wrestling", "manufacturer": "Upper Deck", "product": "Allure"}}
    exact = {"release": {"releaseYear": "2024", "season": "2024-25", "sport": "Hockey", "manufacturer": "Upper Deck", "product": "Allure"}}
    assert ChecklistSentinel._inventory_plan_identity_matches(target, wrong)[0] is False
    assert ChecklistSentinel._inventory_plan_identity_matches(target, exact)[0] is True


def test_hobby_season_and_zero_row_duplicate_progress_semantics():
    from app.inventory_checklist_targets import _season
    assert _season({"set_name": "2022-23 Upper Deck - UD Canvas", "year": "2022"}, "2022") == "2022-23"
    assert ChecklistSentinel._inventory_import_added_rows("release:x:covered=5210:inserted=0") is False
    assert ChecklistSentinel._inventory_import_added_rows("release:x:covered=100:inserted=25") is True


def test_unknown_manufacturer_is_not_safe_for_auto_recovery_contract():
    source = __import__("pathlib").Path(__file__).parents[1] / "app" / "inventory_checklist_targets.py"
    text = source.read_text(encoding="utf-8")
    assert "manufacturer_insufficient_for_safe_auto_recovery" in text
    assert "missing_manufacturer = not bool(item[\"manufacturer\"])" in text
