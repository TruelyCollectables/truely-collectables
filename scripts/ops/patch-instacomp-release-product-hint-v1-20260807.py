from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f"expected one patch anchor in {path}, got {text.count(old)}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


# Listing product names are release coordinates, never logical checklist sets.
path = "src/app/api/instacomp/scan/route.ts"
old = '''  const productRules: Array<{ pattern: RegExp; brand: string; setName: string }> = [\n    { pattern: /\\bO-?Pee-?Chee\\s+Platinum\\b/i, brand: "O-Pee-Chee", setName: "O-Pee-Chee Platinum" },\n    { pattern: /\\bNational\\s+Hockey\\s+Card\\s+Day\\b/i, brand: "Upper Deck", setName: "National Hockey Card Day" },\n    { pattern: /\\bParkhurst\\b/i, brand: "Upper Deck", setName: "Parkhurst" },\n    { pattern: /\\bSPx\\b/i, brand: "Upper Deck", setName: "SPx" },\n    { pattern: /\\bFlair\\b/i, brand: "Upper Deck", setName: "Flair" },\n    { pattern: /\\bTopps\\s+Now\\b/i, brand: "Topps", setName: "Topps Now" },\n    { pattern: /\\bPrizm\\b/i, brand: "Panini", setName: "Prizm" },\n    { pattern: /\\bBowman\\s+Draft\\b/i, brand: "Topps", setName: "Bowman Draft" },\n    { pattern: /\\bBowman\\b/i, brand: "Topps", setName: "Bowman" },\n  ];\n  const product = productRules.find((rule) => rule.pattern.test(title)) || null;\n  const brand = product?.brand || (/\\bUpper\\s+Deck\\b/i.test(title) ? "Upper Deck" : null);\n  return { title, year: season, cardNumber, brand, setName: product?.setName || null };\n'''
new = '''  const productRules: Array<{ pattern: RegExp; brand: string; releaseProductHint: string }> = [\n    { pattern: /\\bO-?Pee-?Chee\\s+Platinum\\b/i, brand: "O-Pee-Chee", releaseProductHint: "O-Pee-Chee Platinum" },\n    { pattern: /\\bNational\\s+Hockey\\s+Card\\s+Day\\b/i, brand: "Upper Deck", releaseProductHint: "National Hockey Card Day" },\n    { pattern: /\\bParkhurst\\b/i, brand: "Upper Deck", releaseProductHint: "Parkhurst" },\n    { pattern: /\\bSPx\\b/i, brand: "Upper Deck", releaseProductHint: "SPx" },\n    { pattern: /\\bFlair\\b/i, brand: "Upper Deck", releaseProductHint: "Flair" },\n    { pattern: /\\bTopps\\s+Now\\b/i, brand: "Topps", releaseProductHint: "Topps Now" },\n    { pattern: /\\bPrizm\\b/i, brand: "Panini", releaseProductHint: "Prizm" },\n    { pattern: /\\bBowman\\s+Draft\\b/i, brand: "Topps", releaseProductHint: "Bowman Draft" },\n    { pattern: /\\bBowman\\b/i, brand: "Topps", releaseProductHint: "Bowman" },\n  ];\n  const product = productRules.find((rule) => rule.pattern.test(title)) || null;\n  const brand = product?.brand || (/\\bUpper\\s+Deck\\b/i.test(title) ? "Upper Deck" : null);\n  return { title, year: season, cardNumber, brand, releaseProductHint: product?.releaseProductHint || null };\n'''
replace_once(path, old, new)
replace_once(
    path,
    '''      ...(listingIdentityHint.brand ? { brand: listingIdentityHint.brand } : {}),\n      ...(listingIdentityHint.setName ? { setName: listingIdentityHint.setName } : {}),\n      ...(listingIdentityHint.cardNumber ? { cardNumber: listingIdentityHint.cardNumber } : {}),\n''',
    '''      ...(listingIdentityHint.brand ? { brand: listingIdentityHint.brand } : {}),\n      ...(listingIdentityHint.releaseProductHint\n        ? { setName: null, releaseProductHint: listingIdentityHint.releaseProductHint }\n        : {}),\n      ...(listingIdentityHint.cardNumber ? { cardNumber: listingIdentityHint.cardNumber } : {}),\n''',
)
replace_once(
    path,
    '''          brand: listingIdentityHint.brand,\n          setName: listingIdentityHint.setName,\n          cardNumber: listingIdentityHint.cardNumber,\n''',
    '''          brand: listingIdentityHint.brand,\n          releaseProductHint: listingIdentityHint.releaseProductHint,\n          cardNumber: listingIdentityHint.cardNumber,\n''',
)

# Registry lookup may use a release/product hint to narrow scope, but it never
# turns that hint into the logical checklist set. Exact identity still requires
# one unique Registry identity after card/player/year/brand and other evidence.
path = "src/lib/instacomp-learning-server.ts"
anchor = '''function normalizedBrandAlternatives(value: unknown) {\n'''
helper = '''function releaseProductHintMatches(value: unknown, release: Record<string, any>) {\n  const hintTokens = meaningfulTokens(value);\n  if (!hintTokens.length) return true;\n  const releaseTokens = new Set(\n    meaningfulTokens(\n      [\n        release.manufacturer?.name,\n        release.brand?.name,\n        release.product_name,\n      ]\n        .filter(Boolean)\n        .join(" "),\n    ),\n  );\n  return hintTokens.every((token) => releaseTokens.has(token));\n}\n\nfunction normalizedBrandAlternatives(value: unknown) {\n'''
replace_once(path, anchor, helper)

replace_once(
    path,
    '''  const targetBrandAlternatives = normalizedBrandAlternatives(ai.brand);\n  const targetSetEvidence = normalizedText(ai.setName);\n  const targetVariation = normalizedText(ai.variation);\n''',
    '''  const targetBrandAlternatives = normalizedBrandAlternatives(ai.brand);\n  const targetSetEvidence = normalizedText(ai.setName);\n  const targetReleaseProductHint = normalizedText(ai.releaseProductHint);\n  const targetVariation = normalizedText(ai.variation);\n''',
)
replace_once(
    path,
    '''    !targetPlayers.length ||\n    !targetYear ||\n    !targetBrandAlternatives.length ||\n    !targetSetEvidence\n  ) {\n''',
    '''    !targetPlayers.length ||\n    !targetYear ||\n    !targetBrandAlternatives.length ||\n    (!targetSetEvidence && !targetReleaseProductHint)\n  ) {\n''',
)
replace_once(
    path,
    '''    const manufacturer = release.manufacturer?.name || null;\n    const brand = release.brand?.name || null;\n    const product = release.product_name || null;\n''',
    '''    if (!releaseProductHintMatches(ai.releaseProductHint, release)) continue;\n\n    const manufacturer = release.manufacturer?.name || null;\n    const brand = release.brand?.name || null;\n    const product = release.product_name || null;\n''',
)
replace_once(
    path,
    '''    if (setProfile.kind === "missing") continue;\n    if (setProfile.kind === "base" && !isExplicitBaseSetEvidence(setName)) continue;\n''',
    '''    if (setProfile.kind === "missing" && !targetReleaseProductHint) continue;\n    if (setProfile.kind === "base" && !isExplicitBaseSetEvidence(setName)) continue;\n''',
)

replace_once(
    path,
    '''  const targetYear = yearStart(ai.year);\n  const setProfile = logicalSetEvidenceProfile(\n''',
    '''  const targetYear = yearStart(ai.year);\n  if (!releaseProductHintMatches(ai.releaseProductHint, release)) return false;\n  const setProfile = logicalSetEvidenceProfile(\n''',
)
replace_once(
    path,
    '''  if (setProfile.kind === "missing") return false;\n  if (setProfile.kind === "base") return isExplicitBaseSetEvidence(row.name);\n''',
    '''  if (setProfile.kind === "missing") return Boolean(normalizedText(ai.releaseProductHint));\n  if (setProfile.kind === "base") return isExplicitBaseSetEvidence(row.name);\n''',
)

replace_once(
    path,
    '''  const year = yearStart(ai.year);\n  const brand = normalizedText(ai.brand);\n  const setEvidence = normalizedText(ai.setName);\n  const requiredSetEvidence = [ai.year, ai.brand, ai.setName];\n\n  if (\n    !year ||\n    !brand ||\n    !setEvidence ||\n    requiredSetEvidence.some(evidenceTextIsUncertain)\n  ) {\n''',
    '''  const year = yearStart(ai.year);\n  const brand = normalizedText(ai.brand);\n  const setEvidence = normalizedText(ai.setName);\n  const releaseProductHint = normalizedText(ai.releaseProductHint);\n  const requiredReleaseEvidence = [ai.year, ai.brand];\n\n  if (\n    !year ||\n    !brand ||\n    (!setEvidence && !releaseProductHint) ||\n    requiredReleaseEvidence.some(evidenceTextIsUncertain) ||\n    (setEvidence && evidenceTextIsUncertain(ai.setName)) ||\n    (releaseProductHint && evidenceTextIsUncertain(ai.releaseProductHint))\n  ) {\n''',
)
replace_once(
    path,
    '''      .filter((release: any) =>\n        yearMatches(year, release.release_year || release.season, true),\n      )\n''',
    '''      .filter((release: any) =>\n        yearMatches(year, release.release_year || release.season, true) &&\n        releaseProductHintMatches(ai.releaseProductHint, release),\n      )\n''',
)

print("PASS applied release-product-only Registry hint repair v1")
