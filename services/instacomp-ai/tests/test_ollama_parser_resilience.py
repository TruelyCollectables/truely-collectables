from app.ollama import normalize_confidence, normalize_identity_payload


def test_normalizes_camel_case_scalars_and_percent_confidence():
    payload = {
        "identity": {
            "year": 2025,
            "cardNumber": 122,
            "setName": "2025 Panini Prizm WNBA",
            "player": "Sonia Citron",
            "isRookie": "yes",
            "isAuto": "no",
            "isRelic": 0,
        },
        "evidence": {
            "frontVisibleText": "SONIA CITRON",
            "backVisibleText": ["NO. 122", "PRIZM"],
            "logos": "PANINI",
            "foilOrPattern": "dense repeating diagonal velocity lines",
        },
        "confidence": "92%",
        "explanation": "Visible front and back evidence.",
    }

    normalized = normalize_identity_payload(payload)

    assert normalized["identity"]["year"] == "2025"
    assert normalized["identity"]["card_number"] == "122"
    assert normalized["identity"]["set_name"] == "2025 Panini Prizm WNBA"
    assert normalized["identity"]["rookie"] is True
    assert normalized["identity"]["autograph"] is False
    assert normalized["identity"]["memorabilia"] is False
    assert normalized["evidence"]["front_visible_text"] == ["SONIA CITRON"]
    assert normalized["evidence"]["logos"] == ["PANINI"]
    assert normalized["confidence"] == 0.92


def test_normalizes_top_level_identity_and_nested_evidence_values():
    payload = {
        "year": 2025,
        "card_number": 5,
        "player": "Paige Bueckers",
        "evidence": {
            "visible_text": [["PAIGE"], ["BUECKERS"]],
            "colors": {"primary": "blue", "secondary": "silver"},
        },
        "confidence": 87,
    }

    normalized = normalize_identity_payload(payload)

    assert normalized["identity"]["year"] == "2025"
    assert normalized["identity"]["card_number"] == "5"
    assert normalized["evidence"]["visible_text"] == ["PAIGE", "BUECKERS"]
    assert normalized["evidence"]["colors"] == ["blue", "silver"]
    assert normalized["confidence"] == 0.87


def test_bad_confidence_is_safe_zero():
    assert normalize_confidence("high") == 0.0
    assert normalize_confidence(None) == 0.0
    assert normalize_confidence(1.5) == 0.015
