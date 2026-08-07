from pathlib import Path

path = Path("src/lib/instacomp-learning-server.ts")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        '    /\\b(speckle(?:d)?|sparkle|glitter|rainbow|holo(?:graphic)?|foil|acetate|clear[-\\s]*stock|transparent|translucent|outburst|refractor|prizm|prism|shimmer|wave|pulsar|mojo|mosaic|laser|black\\s+and\\s+white)\\b/i;\n',
        '    /\\b(speckle(?:d)?|sparkle|glitter|rainbow|holo(?:graphic)?|foil|acetate|clear[-\\s]*stock|transparent|translucent|outburst|refractor|shimmer|wave|pulsar|mojo|mosaic|laser|black\\s+and\\s+white)\\b/i;\n',
        "bare Prizm product-line surface-risk removal",
    ),
    (
        '  const explicitBase = isBaseParallel(ai.parallel);\n',
        '  const normalizedParallel = normalizedText(ai.parallel);\n  const explicitBase = Boolean(normalizedParallel) && isBaseParallel(ai.parallel);\n',
        "missing parallel is not explicit Base",
    ),
    (
        '  const signatureTokens = noteTokens.length ? noteTokens : directTokens;\n',
        '  const signatureTokens = directTokens.length ? directTokens : noteTokens;\n',
        "explicit parallel outranks descriptive notes",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source block, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("InstaComp Registry visible-evidence recovery patch: PASS")
