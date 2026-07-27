from pathlib import Path


path = Path("scripts/harden-instacomp-certification-round2.py")
text = path.read_text()
text = text.replace(
    'setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",',
    'setName: "2024-25 Upper Deck Series 1 - UD Canvas Black and White Parallel - Young Guns",',
)
text = text.replace(
    'parallel: "UD Canvas",',
    'parallel: "Black and White",',
)
text = text.replace(
    'assert.match(String(officialCatalogMatch?.compIdentity?.parallel), /Canvas Young Guns/i);',
    'assert.match(String(officialCatalogMatch?.compIdentity?.parallel), /Black and White/i);',
)
path.write_text(text)
