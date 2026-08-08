from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one anchor in {path}, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


# 1) Preserve fresh Apple Vision OCR from scan.local_vision even when trusted memory has no local_suggestion.
path = "src/lib/instacomp-ai-local.ts"
replace_once(
    path,
    '''function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
''',
    '''function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localVisionOcrText(scan: InstaCompAiLocalScan, side: "front" | "back") {
  const localVision = record(scan.local_vision);
  const sideEvidence = record(localVision[side]);
  const observations = Array.isArray(sideEvidence.ocr) ? sideEvidence.ocr : [];
  return Array.from(
    new Set(
      observations
        .map((value) => record(value))
        .filter((value) => Number(value.confidence ?? 0) >= 0.5)
        .map((value) => text(value.text))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}
''',
)
replace_once(
    path,
    '''export function instaCompAiLocalScanToAi(
  scan: InstaCompAiLocalScan,
): InstaCompAiResultWithInternalReceipt | null {
  const trusted = scan.trusted_identity || null;
''',
    '''export function instaCompAiLocalScanToAi(
  scan: InstaCompAiLocalScan,
): InstaCompAiResultWithInternalReceipt | null {
  const freshFrontVisibleText = localVisionOcrText(scan, "front");
  const freshBackVisibleText = localVisionOcrText(scan, "back");
  const trusted = scan.trusted_identity || null;
''',
)
replace_once(
    path,
    '''      frontVisibleText: [],
      backVisibleText: [],
      backEvidence: null,
''',
    '''      frontVisibleText: freshFrontVisibleText,
      backVisibleText: freshBackVisibleText,
      backEvidence: freshBackVisibleText.join(" | ") || null,
''',
)
replace_once(
    path,
    '''  const frontVisibleText = textList(evidence?.front_visible_text);
  const backVisibleText = textList(evidence?.back_visible_text);
''',
    '''  const frontVisibleText = Array.from(
    new Set([...freshFrontVisibleText, ...textList(evidence?.front_visible_text)]),
  );
  const backVisibleText = Array.from(
    new Set([...freshBackVisibleText, ...textList(evidence?.back_visible_text)]),
  );
''',
)

# 2) Base is a real logical checklist set. Soft fresh OCR may narrow product-line-only set labels to an internal logical set.
path = "src/lib/instacomp-learning-server.ts"
replace_once(path, '''          "base",\n''', '')
replace_once(
    path,
    '''function normalizedBrandAlternatives(value: unknown) {
''',
    '''function isProductLineOnlySetEvidence(value: unknown) {
  const normalized = normalizedText(value);
  return ["prizm", "prism", "panini prizm", "panini prism"].includes(normalized);
}

function visibleTextSupportsLogicalSet(setName: unknown, visibleText: unknown) {
  if (isBaseParallel(setName)) return false;
  const setTokens = meaningfulTokens(setName);
  if (!setTokens.length) return false;
  const visibleTokens = new Set(meaningfulTokens(visibleText));
  return setTokens.every((token) => visibleTokens.has(token));
}

function normalizedBrandAlternatives(value: unknown) {
''',
)
replace_once(
    path,
    '''    const contextual =
      new RegExp(`\\\\b${color}\\\\b(?:\\\\s+\\\\w+){0,3}\\\\s+\\\\b(?:border|foil|finish|parallel|background|frame)\\\\b`).test(notes) ||
      new RegExp(`\\\\b(?:border|foil|finish|parallel|background|frame)\\\\b(?:\\\\s+\\\\w+){0,3}\\\\s+\\\\b${color}\\\\b`).test(notes);
''',
    '''    const contextual =
      new RegExp(`\\\\b${color}\\\\b(?:\\\\s+\\\\w+){0,3}\\\\s+\\\\b(?:border|foil|finish|parallel)\\\\b`).test(notes) ||
      new RegExp(`\\\\b(?:border|foil|finish|parallel)\\\\b(?:\\\\s+\\\\w+){0,3}\\\\s+\\\\b${color}\\\\b`).test(notes);
''',
)
replace_once(
    path,
    '''  const colorContext =
    /\\b(black|blue|gold|green|orange|pink|purple|red|silver|white)\\b(?:\\s+\\w+){0,3}\\s+\\b(border|background|frame|finish|foil|parallel)\\b/i;
''',
    '''  const colorContext =
    /\\b(black|blue|gold|green|orange|pink|purple|red|silver|white)\\b(?:\\s+\\w+){0,3}\\s+\\b(border|finish|foil|parallel)\\b/i;
''',
)
replace_once(
    path,
    '''  const scopedSetRows = (setResult.data || [])
    .filter((row: any) => activeVersionIds.has(String(row.version_id)))
    .map((row: any) => ({
      ...row,
      version: { id: row.version_id, is_active: true, status: "live" },
      release: releaseById.get(String(row.release_id)) || null,
    }));

  const exactCoveredSets = scopedSetRows.filter((row: any) =>
''',
    '''  const scopedSetRows = (setResult.data || [])
    .filter((row: any) => activeVersionIds.has(String(row.version_id)))
    .map((row: any) => ({
      ...row,
      version: { id: row.version_id, is_active: true, status: "live" },
      release: releaseById.get(String(row.release_id)) || null,
    }));
  const softVisibleSetRows = isProductLineOnlySetEvidence(ai.setName)
    ? scopedSetRows.filter((row: any) =>
        visibleTextSupportsLogicalSet(row.name, ai.registryVisibleText),
      )
    : [];
  const setRowsForCoverage = softVisibleSetRows.length
    ? softVisibleSetRows
    : scopedSetRows;

  const exactCoveredSets = setRowsForCoverage.filter((row: any) =>
''',
)
replace_once(
    path,
    '''    : scopedSetRows.filter((row: any) =>
        checklistSetCoverageMatches(ai, row, {
''',
    '''    : setRowsForCoverage.filter((row: any) =>
        checklistSetCoverageMatches(ai, row, {
''',
)

# 3) Catalog parallel evidence uses canonical parallel tokens; one reader's generic background prose cannot veto exact Base.
path = "src/lib/instacomp-consensus.ts"
replace_once(
    path,
    '''function isUncertain(value: string | boolean | null | undefined) {
''',
    '''function isProductLineOnlySetValue(value: string | boolean | null | undefined) {
  const normalized = comparableText(value);
  return ["prizm", "prism", "panini prizm", "panini prism"].includes(normalized);
}

function isUncertain(value: string | boolean | null | undefined) {
''',
)
replace_once(
    path,
    '''  if (knownValue(catalogValue)) {
    const catalogKey = comparableFieldValue(field, catalogValue);
    const conflictingValues = groups
      .filter((group) => group.key !== catalogKey)
      .map((group) => String(group.value));

    return {
''',
    '''  if (knownValue(catalogValue)) {
    const catalogKey = comparableFieldValue(field, catalogValue);
    const groupMatchesCatalog = (group: ValueGroup) =>
      field === "setName" && catalogReferee?.identity
        ? catalogTextFieldMatchesReader(field, catalogReferee.identity, group.value)
        : group.key === catalogKey;
    const conflictingValues = groups
      .filter((group) => !groupMatchesCatalog(group))
      .map((group) => String(group.value));

    return {
''',
)
replace_once(
    path,
    '''        ...(groups
          .filter((group) => group.key === catalogKey)
          .flatMap((group) => group.sources)),
''',
    '''        ...(groups
          .filter((group) => groupMatchesCatalog(group))
          .flatMap((group) => group.sources)),
''',
)
replace_once(
    path,
    '''  if (field === "setName") {
    const registrySetName = catalogRegistrySetName(catalogIdentity);
    const catalogSetValues = [catalogValue, registrySetName].filter(Boolean);
''',
    '''  if (field === "setName") {
    const registrySetName = catalogRegistrySetName(catalogIdentity);
    const catalogSetValues = [catalogValue, registrySetName].filter(Boolean);
    if (isProductLineOnlySetValue(readerValue)) {
      const readerTokens = semanticTokens(readerValue);
      const productTokens = new Set(semanticTokens(catalogIdentity.product));
      return (
        readerTokens.length > 0 &&
        readerTokens.every((token) => productTokens.has(token))
      );
    }
''',
)
replace_once(
    path,
    '''  const evidenceTokens = new Set(semanticTokens(readerEvidenceText(reader)));
  const requiredTokens = semanticTokens(catalogParallel);
''',
    '''  const evidenceTokens = new Set(
    comparableParallel(readerEvidenceText(reader)).split(" ").filter(Boolean),
  );
  const requiredTokens = comparableParallel(catalogParallel)
    .split(" ")
    .filter(Boolean);
''',
)
replace_once(
    path,
    '''  const unresolvedSurfaceRisk = params.readers.some((reader) =>
    hasUnresolvedVisibleSurfaceRisk(readerEvidenceText(reader)),
  );

  if (isGenericBase(catalogParallel)) {
    if (unresolvedSurfaceRisk) {
''',
    '''  const unresolvedSurfaceRiskFamilies = uniqueStrings(
    params.readers
      .filter((reader) =>
        hasUnresolvedVisibleSurfaceRisk(readerEvidenceText(reader)),
      )
      .map((reader) => readerFamily(reader)),
  );

  if (isGenericBase(catalogParallel)) {
    if (unresolvedSurfaceRiskFamilies.length >= 2) {
''',
)
replace_once(
    path,
    '''  const colorContext =
    /\\b(black|blue|gold|green|orange|pink|purple|red|silver|white)\\b(?:\\s+\\w+){0,3}\\s+\\b(border|background|frame|finish|foil|parallel)\\b/i;
''',
    '''  const colorContext =
    /\\b(black|blue|gold|green|orange|pink|purple|red|silver|white)\\b(?:\\s+\\w+){0,3}\\s+\\b(border|finish|foil|parallel)\\b/i;
''',
)

# 4) Feed fresh Mac OCR to Registry as soft lookup evidence only; never into consensus identity.
path = "src/app/api/instacomp/scan/route.ts"
replace_once(
    path,
    '''    // Marketplace title facts are untrusted lookup coordinates only; they never vote in consensus.
    const listingIdentityHint = extractUntrustedListingIdentityHint(listingTitleHint);
    const registryProbeAi = {
      ...evidenceAi,
''',
    '''    // Marketplace title facts and fresh Apple Vision text are untrusted lookup coordinates only;
    // they may narrow internal Registry rows but never vote as hard identity fields.
    const listingIdentityHint = extractUntrustedListingIdentityHint(listingTitleHint);
    const internalReceipt = primaryAiResult.value as InstaCompAiResultWithInternalReceipt;
    const registryVisibleText = [
      ...internalReceipt.frontVisibleText,
      ...internalReceipt.backVisibleText,
    ].join(" ");
    const registryProbeAi = {
      ...evidenceAi,
      registryVisibleText,
''',
)
replace_once(
    path,
    '''    };
    const internalReceipt = primaryAiResult.value as InstaCompAiResultWithInternalReceipt;
    const receiptResolution = await revalidateChecklistRegistryReceipt({
''',
    '''    };
    const receiptResolution = await revalidateChecklistRegistryReceipt({
''',
)

print("PASS applied final cloud Registry/consensus v3 patch")
