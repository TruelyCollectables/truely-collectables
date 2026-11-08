from app.models import CardIdentity
from app.ollama import normalize_identity_payload


def test_directional_blue_prizm_is_velocity_not_cracked_ice():
    payload = {
        "identity": {
            "brand": "Panini",
            "set_name": "2025 Panini Prizm WNBA",
            "player": "Sonia Citron",
            "card_number": "122",
            "parallel": "Blue Cracked Ice Prizm",
        },
        "evidence": {
            "colors": ["blue"],
            "foil_or_pattern": [
                "dense repeating diagonal slashes and criss-cross velocity lines"
            ],
            "front_notes": ["directional speed-line surface pattern"],
            "back_visible_text": ["PRIZM"],
        },
        "confidence": 0.92,
        "explanation": "Blue directional line pattern with PRIZM printed on back.",
    }

    normalized = normalize_identity_payload(payload)

    assert normalized["identity"]["parallel"] == "Blue Velocity Prizm"


def test_irregular_polygonal_blue_prizm_remains_cracked_ice():
    payload = {
        "identity": {
            "brand": "Panini",
            "set_name": "2025 Panini Prizm WNBA",
            "player": "Example Player",
            "card_number": "1",
            "parallel": "Blue Cracked Ice Prizm",
        },
        "evidence": {
            "colors": ["blue"],
            "foil_or_pattern": [
                "irregular polygonal shattered-ice facets like broken glass"
            ],
            "back_visible_text": ["PRIZM"],
        },
        "confidence": 0.93,
        "explanation": "Irregular faceted cracked-ice geometry.",
    }

    normalized = normalize_identity_payload(payload)

    assert normalized["identity"]["parallel"] == "Blue Cracked Ice Prizm"


def test_generic_blue_prizm_with_velocity_geometry_becomes_velocity():
    payload = {
        "identity": {
            "brand": "Panini",
            "set_name": "2025 Panini Prizm WNBA",
            "player": "Example Player",
            "card_number": "2",
            "parallel": "Blue Prizm",
        },
        "evidence": {
            "colors": ["blue"],
            "foil_or_pattern": ["repeating diagonal chevrons and speed lines"],
            "back_visible_text": ["PRIZM"],
        },
        "confidence": 0.9,
        "explanation": "Directional velocity geometry.",
    }

    normalized = normalize_identity_payload(payload)

    assert normalized["identity"]["parallel"] == "Blue Velocity Prizm"


def test_numeric_year_and_card_number_are_normalized_before_validation():
    payload = {
        "identity": {
            "year": 2025,
            "manufacturer": "Panini",
            "brand": "Prizm",
            "set_name": "Prizm WNBA",
            "player": "Sonia Citron",
            "card_number": 122,
            "parallel": "Base",
            "rookie": True,
        },
        "evidence": {
            "front_visible_text": ["SONIA CITRON"],
            "back_visible_text": ["122"],
        },
        "confidence": 0.97,
        "explanation": "Visible front and back evidence.",
    }

    normalized = normalize_identity_payload(payload)
    identity = CardIdentity.model_validate(normalized["identity"])

    assert identity.year == "2025"
    assert identity.card_number == "122"
    assert identity.player == "Sonia Citron"
