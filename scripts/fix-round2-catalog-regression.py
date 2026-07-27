from pathlib import Path


path = Path("scripts/harden-instacomp-certification-round2.py")
text = path.read_text()

# Positive fixture: the official benchmark contains the standard Canvas Young
# Guns C-111 card. Keep the fixture aligned with that exact catalog entry.
text = text.replace(
    'setName: "2024-25 Upper Deck Series 1 - UD Canvas Black and White Parallel - Young Guns",',
    'setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",',
)
text = text.replace(
    'setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",',
    'setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",',
)
text = text.replace(
    'parallel: "Black and White",',
    'parallel: "Canvas Young Guns",',
)
text = text.replace(
    'parallel: "UD Canvas",',
    'parallel: "Canvas Young Guns",',
)
text = text.replace(
    'assert.match(String(officialCatalogMatch?.compIdentity?.parallel), /Black and White/i);',
    'assert.match(String(officialCatalogMatch?.compIdentity?.parallel), /Canvas Young Guns/i);',
)

# Negative fixture: an unlisted Black & White variation of that physical card
# must not be accepted as the standard Canvas Young Guns catalog entry.
negative_marker = '''const wrongCatalogParallel = buildInstaCompCuratedChecklistEvidence({'''
negative_test = '''const wrongCanvasVariation = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Lane Hutson",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Black and White Parallel - Young Guns",
    cardNumber: "C-111",
    parallel: "Black and White",
    serialNumber: null,
    team: "Montreal Canadiens",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.95,
    notes: null,
  },
});
assert.equal(
  wrongCanvasVariation,
  null,
  "an unlisted Black & White C-111 variation must not fall back to Canvas Young Guns",
);

'''
if negative_test not in text and negative_marker in text:
    text = text.replace(negative_marker, negative_test + negative_marker, 1)

path.write_text(text)
