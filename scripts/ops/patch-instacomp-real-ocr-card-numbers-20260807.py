from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source block, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

vision = Path("services/instacomp-ai/app/local_vision.py")
replace_once(
    vision,
    '    re.compile(r"\\b(?:CARD\\s*(?:NO\\.?|NUMBER)?|NO\\.?)\\s*[:#-]?\\s*([A-Z0-9-]{1,12})\\b", re.I),\n',
    '    re.compile(r"\\b(?:CARD\\s+(?:NO(?:\\.(?!\\w)|\\b)|NUMBER)|NO(?:\\.(?!\\w)|\\b))\\s*[:#-]?\\s*([A-Z0-9-]{1,12})\\b", re.I),\n',
    "standalone No label boundary",
)

old = '''            dx = abs(cx - lx)\n            dy = abs(cy - ly)\n            if dx > 0.34 or dy > 0.16:\n                continue\n            score = (2.0 - 2.5 * dy - 1.2 * dx) + candidate.confidence\n'''
new = '''            dx = abs(cx - lx)\n            dy = abs(cy - ly)\n            upper_back_label = label.side == "back" and ly >= 0.72\n            max_dy = 0.34 if upper_back_label else 0.16\n            if dx > 0.34 or dy > max_dy:\n                continue\n            # Real Prizm backs can place the printed number well below an upper\n            # "No." label. Allow that bounded layout, but never reach down into\n            # the statistics table or trust a weak OCR token as the card number.\n            if upper_back_label and (cy < 0.50 or candidate.confidence < 0.60):\n                continue\n            score = (2.0 - 2.5 * dy - 1.2 * dx) + candidate.confidence\n'''
replace_once(vision, old, new, "real upper-back split-label geometry")

tests = Path("services/instacomp-ai/tests/test_ocr_registry_hard_facts.py")
text = tests.read_text(encoding="utf-8")
marker = "def test_real_sonia_notre_dame_text_cannot_become_tre_card_number():"
if marker not in text:
    text += '''\n\ndef test_real_sonia_notre_dame_text_cannot_become_tre_card_number():\n    front = side(\n        "front",\n        [\n            obs("SONIA CITRON", side="front", x=0.30, y=0.10, confidence=1.0),\n            obs("22", side="front", x=0.53, y=0.565, confidence=1.0),\n        ],\n    )\n    back = side(\n        "back",\n        [\n            # Coordinates mirror the archived Production Apple Vision evidence.\n            obs("No.", side="back", x=0.761, y=0.810, confidence=1.0),\n            obs("122", side="back", x=0.773, y=0.782, confidence=1.0),\n            obs("2024-25 NOTRE DAME", side="back", x=0.187, y=0.349, confidence=1.0),\n            obs("movement, poise and aggression. She's not loud about it, and", side="back", x=0.244, y=0.248, confidence=1.0),\n            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.55, y=0.15, confidence=1.0),\n        ],\n    )\n    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())\n    assert identity.card_number == "122"\n    assert identity.card_number != "TRE"\n\n\ndef test_real_paige_split_no_label_reaches_printed_five_not_stats_table():\n    front = side(\n        "front",\n        [\n            obs("PAIGE BUECKERS", side="front", x=0.30, y=0.10, confidence=1.0),\n            obs("5", side="front", x=0.530, y=0.592, confidence=1.0),\n        ],\n    )\n    back = side(\n        "back",\n        [\n            # Archived Production OCR: label is high-right, printed 5 is lower.\n            obs("No.", side="back", x=0.782, y=0.847, confidence=1.0),\n            obs("5", side="back", x=0.529, y=0.588, confidence=1.0),\n            # Stats-table values must stay outside the bounded label pairing.\n            obs("756", side="back", x=0.769, y=0.416, confidence=1.0),\n            obs("104", side="back", x=0.724, y=0.388, confidence=1.0),\n            obs("Dallas as the No. 1 overall pick and hit the ground running.", side="back", x=0.234, y=0.213, confidence=1.0),\n            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.540, y=0.156, confidence=1.0),\n        ],\n    )\n    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())\n    assert identity.card_number == "5"\n\n\ndef test_notre_without_real_number_label_fails_closed():\n    front = side("front", [obs("SONIA CITRON", side="front", x=0.30, y=0.10)])\n    back = side(\n        "back",\n        [\n            obs("2024-25 NOTRE DAME", side="back", x=0.187, y=0.349, confidence=1.0),\n            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.55, y=0.15, confidence=1.0),\n        ],\n    )\n    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())\n    assert identity.card_number is None\n'''
    tests.write_text(text, encoding="utf-8")

print("Real frozen-five OCR card-number patch: PASS")
