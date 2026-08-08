from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f"expected one patch anchor in {path}, got {text.count(old)}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


# Registry set evidence must distinguish logical set names from release/product text.
path = "src/lib/instacomp-learning-server.ts"
anchor = '''function normalizedBrandAlternatives(value: unknown) {\n'''
helper = '''type LogicalSetEvidenceProfile =\n  | { kind: "missing"; tokens: string[] }\n  | { kind: "base"; tokens: string[] }\n  | { kind: "product_line_only"; tokens: string[] }\n  | { kind: "logical"; tokens: string[] };\n\nfunction isExplicitBaseSetEvidence(value: unknown) {\n  const normalized = normalizedText(value);\n  return ["base", "base card", "standard", "standard card", "regular", "regular card"].includes(normalized);\n}\n\nfunction logicalSetEvidenceProfile(\n  value: unknown,\n  releaseContext: unknown,\n): LogicalSetEvidenceProfile {\n  if (!normalizedText(value)) return { kind: "missing", tokens: [] };\n  if (isExplicitBaseSetEvidence(value)) return { kind: "base", tokens: [] };\n\n  const targetTokens = meaningfulTokens(value);\n  if (!targetTokens.length) return { kind: "missing", tokens: [] };\n  const releaseTokens = new Set(meaningfulTokens(releaseContext));\n  const logicalTokens = targetTokens.filter((token) => !releaseTokens.has(token));\n  if (!logicalTokens.length) {\n    return { kind: "product_line_only", tokens: targetTokens };\n  }\n  return { kind: "logical", tokens: logicalTokens };\n}\n\nfunction normalizedBrandAlternatives(value: unknown) {\n'''
replace_once(path, anchor, helper)

old = '''  const targetYear = yearStart(ai.year);\n  const targetSetTokens = new Set(meaningfulTokens(ai.setName));\n\n  const releaseYear = release.release_year || release.season || null;\n'''
new = '''  const targetYear = yearStart(ai.year);\n  const setProfile = logicalSetEvidenceProfile(\n    ai.setName,\n    [manufacturer.name, brand.name, release.product_name, sport.name, league.name]\n      .filter(Boolean)\n      .join(" "),\n  );\n\n  const releaseYear = release.release_year || release.season || null;\n'''
replace_once(path, old, new)
old = '''  const registrySetTokens = new Set(\n    meaningfulTokens(\n      [\n        brand.name,\n        release.product_name,\n        row.name,\n        sport.name,\n        league.name,\n      ]\n        .filter(Boolean)\n        .join(" "),\n    ),\n  );\n\n  return [...targetSetTokens].every((token) => registrySetTokens.has(token));\n'''
new = '''  if (setProfile.kind === "missing") return false;\n  if (setProfile.kind === "base") return isExplicitBaseSetEvidence(row.name);\n  if (setProfile.kind === "product_line_only") return true;\n\n  const registrySetTokens = new Set(meaningfulTokens(row.name));\n  return setProfile.tokens.every((token) => registrySetTokens.has(token));\n'''
replace_once(path, old, new)

old = '''  const year = yearStart(ai.year);\n  const brand = normalizedText(ai.brand);\n  const setTokens = meaningfulTokens(ai.setName);\n  const requiredSetEvidence = [ai.year, ai.brand, ai.setName];\n\n  if (\n    !year ||\n    !brand ||\n    !setTokens.length ||\n    requiredSetEvidence.some(evidenceTextIsUncertain)\n  ) {\n'''
new = '''  const year = yearStart(ai.year);\n  const brand = normalizedText(ai.brand);\n  const setEvidence = normalizedText(ai.setName);\n  const requiredSetEvidence = [ai.year, ai.brand, ai.setName];\n\n  if (\n    !year ||\n    !brand ||\n    !setEvidence ||\n    requiredSetEvidence.some(evidenceTextIsUncertain)\n  ) {\n'''
replace_once(path, old, new)

old = '''  const targetPlayers = normalizedSubjects(ai.player);\n  const targetYear = yearStart(ai.year);\n  const targetBrandAlternatives = normalizedBrandAlternatives(ai.brand);\n  const targetSetTokens = new Set(meaningfulTokens(ai.setName));\n  const targetVariation = normalizedText(ai.variation);\n'''
new = '''  const targetPlayers = normalizedSubjects(ai.player);\n  const targetYear = yearStart(ai.year);\n  const targetBrandAlternatives = normalizedBrandAlternatives(ai.brand);\n  const targetSetEvidence = normalizedText(ai.setName);\n  const targetVariation = normalizedText(ai.variation);\n'''
replace_once(path, old, new)
old = '''    !targetPlayers.length ||\n    !targetYear ||\n    !targetBrandAlternatives.length ||\n    !targetSetTokens.size\n  ) {\n'''
new = '''    !targetPlayers.length ||\n    !targetYear ||\n    !targetBrandAlternatives.length ||\n    !targetSetEvidence\n  ) {\n'''
replace_once(path, old, new)
old = '''    const registrySetTokens = new Set(\n      meaningfulTokens([brand, product, setName].filter(Boolean).join(" ")),\n    );\n    if (![...targetSetTokens].every((token) => registrySetTokens.has(token))) {\n      continue;\n    }\n'''
new = '''    const setProfile = logicalSetEvidenceProfile(\n      ai.setName,\n      [manufacturer, brand, product, release.sport?.name, release.league?.name]\n        .filter(Boolean)\n        .join(" "),\n    );\n    if (setProfile.kind === "missing") continue;\n    if (setProfile.kind === "base" && !isExplicitBaseSetEvidence(setName)) continue;\n    if (setProfile.kind === "logical") {\n      const registrySetTokens = new Set(meaningfulTokens(setName));\n      if (!setProfile.tokens.every((token) => registrySetTokens.has(token))) continue;\n    }\n'''
replace_once(path, old, new)

# Catalog hard-evidence guard: product-line text such as PRIZM is not a logical set contradiction.
path = "src/lib/instacomp-consensus.ts"
anchor = '''function catalogTextFieldMatchesReader(\n'''
helper = '''function catalogProductName(\n  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,\n) {\n  return cleanText(\n    (identity as (Partial<InstaCompCatalogCompIdentity> & {\n      product?: string | null;\n      registryBrand?: string | null;\n    }) | null | undefined)?.product,\n  );\n}\n\nfunction readerSetIsReleaseProductOnly(\n  value: string | boolean | null | undefined,\n  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,\n) {\n  if (isGenericBase(value)) return false;\n  const readerTokens = semanticTokens(value);\n  if (!readerTokens.length) return false;\n  const productTokens = new Set(semanticTokens(catalogProductName(identity)));\n  if (!productTokens.size) return false;\n  return readerTokens.every((token) => productTokens.has(token));\n}\n\nfunction catalogTextFieldMatchesReader(\n'''
replace_once(path, anchor, helper)
old = '''  if (field === "setName") {\n    const registrySetName = catalogRegistrySetName(catalogIdentity);\n    const catalogSetValues = [catalogValue, registrySetName].filter(Boolean);\n'''
new = '''  if (field === "setName") {\n    const registrySetName = catalogRegistrySetName(catalogIdentity);\n    const catalogSetValues = [catalogValue, registrySetName].filter(Boolean);\n    // A reader saying only the release/product line (for example PRIZM) has not\n    // actually contradicted a logical Registry set such as Base or Groovy.\n    // Treat it as non-conflicting, while the Registry remains the referee for\n    // the logical set name.\n    if (readerSetIsReleaseProductOnly(readerValue, catalogIdentity)) return true;\n'''
replace_once(path, old, new)

# Regression simulation: exact Registry referee must survive primary PRIZM product-line text.
path = "scripts/run-instacomp-final-identity-consensus-simulations.ts"
replace_once(
    path,
    'const baseMatch = { ...iceMatch, identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f", fingerprintSha256: "2".repeat(64), player: "Sonia Citron", cardNumber: "122", parallel: "Base" };\n',
    'const baseMatch = { ...iceMatch, identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f", fingerprintSha256: "2".repeat(64), player: "Sonia Citron", cardNumber: "122", parallel: "Base", team: "Washington Mystics" };\n',
)
old = '''assert.equal(baseDecision.confirmed, true);\nassert.ok(baseDecision.confidence >= 0.95);\n\nconst local = instaCompAiLocalScanToAi({\n'''
new = '''assert.equal(baseDecision.confirmed, true);\nassert.ok(baseDecision.confidence >= 0.95);\n\nconst productLineOnlyBaseConsensus = buildInstaCompMultiScannerConsensus({\n  readers: [\n    {\n      readerId: "primary-product-line-base",\n      label: "Primary local Qwen",\n      kind: "primary_vision",\n      family: "instacomp_internal",\n      identity: { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "PRIZM", cardNumber: "122", team: "Washington Mystics", sport: "Basketball", isRookie: true, isAuto: false, isRelic: false },\n      confidence: 0.98,\n      evidence: ["front/back model"],\n    },\n    {\n      readerId: "deterministic-product-line-base",\n      label: "Apple Vision/OpenCV deterministic evidence",\n      kind: "ocr_printed_evidence",\n      family: "instacomp_local_deterministic",\n      identity: { year: "2025", brand: "Panini", cardNumber: "122", isRookie: true },\n      confidence: 0.99,\n      evidence: ["printed hard facts"],\n    },\n  ],\n  baseIdentity: { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "PRIZM", cardNumber: "122", team: "Washington Mystics", sport: "Basketball", isRookie: true, isAuto: false, isRelic: false },\n  catalogReferee: catalogEvidenceToConsensusReferee(baseCatalog),\n  escalation: applyInstaCompRegistryFastLane(\n    { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "escalated_multi_ai", councilMode: "full_council", riskTier: "high", runSecondaryVision: false, reasons: ["missing_setName"], scannerPlan: [], explanation: "test" },\n    baseMatch.identityId,\n  ),\n});\nassert.equal(productLineOnlyBaseConsensus.catalogReferee.status, "catalog_confirmed");\nassert.equal(productLineOnlyBaseConsensus.trustedForIdentity, true);\nassert.equal(productLineOnlyBaseConsensus.finalIdentity.setName, "Base");\nconst productLineOnlyBaseDecision = buildInstaCompEvidenceIdentityDecision({\n  resolution: { status: "internal_exact_match", match: baseMatch, reasons: [], candidateCount: 1, coveredReleaseIds: ["r"], coveredVersionIds: ["v"], coveredSetIds: ["s"], sourceTier: "internal", externalLookupEligible: false, externalLookupAttempted: false },\n  consensus: productLineOnlyBaseConsensus,\n  hasBackImage: true,\n  threshold: 0.95,\n});\nassert.equal(productLineOnlyBaseDecision.confirmed, true);\nassert.ok(productLineOnlyBaseDecision.confidence >= 0.95);\n\nconst local = instaCompAiLocalScanToAi({\n'''
replace_once(path, old, new)

print("PASS applied web-only Registry/consensus final v3 patch")
