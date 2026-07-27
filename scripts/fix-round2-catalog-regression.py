from pathlib import Path


path = Path("scripts/harden-instacomp-certification-round2.py")
text = path.read_text()

# Positive fixture: the official benchmark contains the standard Canvas Young
# Guns C-111 card. Keep the first fixture aligned with that exact catalog entry.
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

# The official benchmark also contains the Black & White C-111 parallel. It
# must resolve to that exact catalog entry, while a genuinely unlisted Canvas
# variation must remain blocked from exact comps and automatic pricing.
variant_marker = '''const wrongCatalogParallel = buildInstaCompCuratedChecklistEvidence({'''
variant_tests = '''const officialBlackWhiteCanvasVariation = buildInstaCompCuratedChecklistEvidence({
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
assert.equal(officialBlackWhiteCanvasVariation?.status, "catalog_confirmed");
assert.equal(officialBlackWhiteCanvasVariation?.compIdentity?.cardNumber, "C-111");
assert.match(
  String(officialBlackWhiteCanvasVariation?.compIdentity?.parallel),
  /Black and White/i,
);

const unlistedCanvasVariation = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Lane Hutson",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Sepia Parallel - Young Guns",
    cardNumber: "C-111",
    parallel: "Sepia",
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
assert.notEqual(
  unlistedCanvasVariation?.status,
  "catalog_confirmed",
  "an unlisted Sepia C-111 variation must not be catalog confirmed",
);
assert.equal(
  unlistedCanvasVariation?.compIdentity ?? null,
  null,
  "an unlisted Sepia C-111 variation must not inherit a comp identity",
);
assert.equal(
  unlistedCanvasVariation?.actionPermissions.exactCompSearchAllowed ?? false,
  false,
  "an unlisted Sepia C-111 variation must remain blocked from exact comps",
);

'''
if variant_tests not in text and variant_marker in text:
    text = text.replace(variant_marker, variant_tests + variant_marker, 1)

path.write_text(text)
