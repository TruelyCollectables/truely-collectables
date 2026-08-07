#!/usr/bin/env python3
from pathlib import Path

path = Path("src/lib/instacomp-image-orientation.ts")
source = path.read_text()

replacements = [
    (
        '        "Do not identify the card, do not determine its parallel, and do not use color or foil to decide orientation.",\n',
        '        "Do not identify the card or infer a color/foil parallel.",\n'
        '        "For the BACK side only, separately report whether a standalone printed word PRIZM appears as a card designation.",\n'
        '        "Do not count PRIZM when it appears only inside manufacturer, product, copyright, or legal text such as Panini - WNBA Prizm Basketball.",\n'
        '        "This narrow PRIZM designation receipt is independent from the orientation decision.",\n',
    ),
    (
        '                backEvidenceText: {\n'
        '                  type: "array",\n'
        '                  items: { type: "string" },\n'
        '                },\n'
        '                reason: { type: "string" },\n',
        '                backEvidenceText: {\n'
        '                  type: "array",\n'
        '                  items: { type: "string" },\n'
        '                },\n'
        '                backStandalonePrizm: {\n'
        '                  anyOf: [{ type: "boolean" }, { type: "null" }],\n'
        '                },\n'
        '                backDesignationConfidence: { type: "number" },\n'
        '                reason: { type: "string" },\n',
    ),
    (
        '                "frontEvidenceText",\n'
        '                "backEvidenceText",\n'
        '                "reason",\n',
        '                "frontEvidenceText",\n'
        '                "backEvidenceText",\n'
        '                "backStandalonePrizm",\n'
        '                "backDesignationConfidence",\n'
        '                "reason",\n',
    ),
    (
        '    const backEvidenceText = params.backDataUrl\n'
        '      ? normalizedEvidence(parsed.backEvidenceText)\n'
        '      : [];\n'
        '    const lowConfidenceSides = [\n',
        '    const backEvidenceText = params.backDataUrl\n'
        '      ? normalizedEvidence(parsed.backEvidenceText)\n'
        '      : [];\n'
        '    const backStandalonePrizm =\n'
        '      params.backDataUrl && typeof parsed.backStandalonePrizm === "boolean"\n'
        '        ? parsed.backStandalonePrizm\n'
        '        : null;\n'
        '    const backDesignationConfidence = params.backDataUrl\n'
        '      ? normalizedConfidence(parsed.backDesignationConfidence)\n'
        '      : 0;\n'
        '    const lowConfidenceSides = [\n',
    ),
    (
        '      frontEvidenceText,\n'
        '      backEvidenceText,\n'
        '      backStandalonePrizm: null,\n'
        '      backDesignationConfidence: 0,\n'
        '      reason: lowConfidenceSides.length\n',
        '      frontEvidenceText,\n'
        '      backEvidenceText,\n'
        '      backStandalonePrizm,\n'
        '      backDesignationConfidence,\n'
        '      reason: lowConfidenceSides.length\n',
    ),
]

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, found {count}: {old[:100]!r}")
    source = source.replace(old, new, 1)

path.write_text(source)
print(f"patched {path}")
