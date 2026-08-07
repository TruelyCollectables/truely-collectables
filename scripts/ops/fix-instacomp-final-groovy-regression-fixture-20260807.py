from pathlib import Path

path = Path("services/instacomp-ai/tests/test_ocr_registry_hard_facts.py")
text = path.read_text(encoding="utf-8")
old = '''def test_real_groovy_prominent_front_title_becomes_set_hint():
    front = side(
        "front",
        [
            obs("GROOVY", side="front", x=0.244, y=0.203, width=0.497, height=0.096, confidence=1.0),
            obs("SONIA CITRON", side="front", x=0.28, y=0.10, width=0.38, height=0.052, confidence=1.0),
            obs("WASHINGTON MYSTICS", side="front", x=0.31, y=0.06, width=0.30, height=0.030, confidence=1.0),
        ],
    )
    back = side(
        "back",
        [
            obs("No. 13", side="back", x=0.75, y=0.80, width=0.12, height=0.04, confidence=1.0),
            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.54, y=0.15, width=0.48, height=0.03, confidence=1.0),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.set_name == "GROOVY"
    assert identity.card_number == "13"
    assert identity.manufacturer == "Panini"
'''
new = '''def test_real_groovy_prominent_front_title_becomes_set_hint():
    def real_obs(text: str, *, side: str, x: float, y: float, width: float, height: float, confidence: float = 1.0):
        return OCRObservation(
            text=text,
            confidence=confidence,
            box=OCRBox(x=x, y=y, width=width, height=height),
            side=side,
            source="archived_production_apple_vision",
        )

    front = side(
        "front",
        [
            real_obs("GROOVY", side="front", x=0.244, y=0.203, width=0.497, height=0.096, confidence=1.0),
            real_obs("SONIA CITRON", side="front", x=0.28, y=0.10, width=0.38, height=0.052, confidence=1.0),
            real_obs("WASHINGTON MYSTICS", side="front", x=0.31, y=0.06, width=0.30, height=0.030, confidence=1.0),
        ],
    )
    back = side(
        "back",
        [
            real_obs("No. 13", side="back", x=0.75, y=0.80, width=0.12, height=0.04, confidence=1.0),
            real_obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.54, y=0.15, width=0.48, height=0.03, confidence=1.0),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.set_name == "GROOVY"
    assert identity.card_number == "13"
    assert identity.manufacturer == "Panini"
'''
if old not in text:
    raise SystemExit("Expected Groovy regression block was not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PASS corrected real Groovy OCR fixture geometry")
