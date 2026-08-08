from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')
def replace_once(path, old, new):
    text=read(path)
    if text.count(old)!=1: raise SystemExit(f'anchor count {text.count(old)} in {path}: {old[:120]!r}')
    write(path,text.replace(old,new,1))

path='src/lib/instacomp-identity-guard.ts'
replace_once(path,
'''function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}
''',
'''function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}

function comparableSerial(value: string | null | undefined) {
  return cleanSignalText(value).toLowerCase().replace(/\\s+/g, "").replace(/^0+(?=\\d)/, "");
}

export function applyInstaCompSerialEvidenceGuard(
  ai: InstaCompAiResult,
  confirmedSerialNumbers: Array<string | null | undefined>,
): InstaCompAiResult {
  const candidate = cleanSignalText(ai.serialNumber);
  if (!candidate) return ai;
  const candidateKey = comparableSerial(candidate);
  const corroborated = confirmedSerialNumbers
    .map((value) => cleanSignalText(value))
    .filter(Boolean)
    .some((value) => comparableSerial(value) === candidateKey);
  if (corroborated) return ai;
  return {
    ...ai,
    serialNumber: null,
    notes: appendNote(ai.notes, `Serial evidence guard suppressed uncorroborated serial "${candidate}"; fresh printed evidence did not confirm that exact stamp.`),
  };
}
''')

path='src/app/api/instacomp/scan/route.ts'
replace_once(path,
'import { applyInstaCompIdentityGuard } from "../../../../lib/instacomp-identity-guard";\n',
'''import {
  applyInstaCompIdentityGuard,
  applyInstaCompSerialEvidenceGuard,
} from "../../../../lib/instacomp-identity-guard";
''')
replace_once(path,
'''    const baseAi = mergeGradingDetection(
      primaryAiResult.value,
      externalOcr,
    );
    const serialOcr = null as InstaCompSerialOcrResult | null;
    const baseAiForConsensus = applyOperatorSerialNumberOverride(
      baseAi,
      operatorSerialNumberOverride,
    );
''',
'''    const internalReceipt = primaryAiResult.value as InstaCompAiResultWithInternalReceipt;
    const deterministicSerialNumber = String(internalReceipt.internalDeterministicIdentity?.serialNumber || "").trim() || null;
    const confirmedSerialNumbers = [
      externalOcr?.serialNumber || null,
      deterministicSerialNumber,
      operatorSerialNumberOverride === undefined ? null : operatorSerialNumberOverride,
    ];
    const baseAi = applyInstaCompSerialEvidenceGuard(
      mergeGradingDetection(primaryAiResult.value, externalOcr),
      confirmedSerialNumbers,
    );
    const serialOcr = null as InstaCompSerialOcrResult | null;
    const baseAiForConsensus = applyOperatorSerialNumberOverride(baseAi, operatorSerialNumberOverride);
''')
replace_once(path,
'''    const listingIdentityHint = extractUntrustedListingIdentityHint(listingTitleHint);
    const internalReceipt = primaryAiResult.value as InstaCompAiResultWithInternalReceipt;
    const registryVisibleText = [
''',
'''    const listingIdentityHint = extractUntrustedListingIdentityHint(listingTitleHint);
    const registryVisibleText = [
''')
replace_once(path,
'''        ai: applyInstaCompIdentityGuard(
          applyOperatorSerialNumberOverride(
            mergeGradingDetection(mergeSerialOcrResult(reader.ai, serialOcr), externalOcr),
            operatorSerialNumberOverride,
          ),
''',
'''        ai: applyInstaCompIdentityGuard(
          applyOperatorSerialNumberOverride(
            applyInstaCompSerialEvidenceGuard(
              mergeGradingDetection(mergeSerialOcrResult(reader.ai, serialOcr), externalOcr),
              confirmedSerialNumbers,
            ),
            operatorSerialNumberOverride,
          ),
''')
replace_once(path,
'''    const registryProbeAi = {
      ...evidenceAi,
      registryVisibleText,
''',
'''    const registryProbeAi = {
      ...evidenceAi,
      registryVisibleText,
      // Internal resolver-only marker: the scanner council has already
      // adjudicated hard parallel identity. It is never accepted from listing
      // hints or OCR and is only true for a conflict-free council.
      parallelEvidenceAdjudicated: evidenceConsensus.status === "consensus_confirmed",
''')

path='src/lib/instacomp-learning-server.ts'
replace_once(path,
'''function isProductLineOnlySetEvidence(value: unknown) {
  const normalized = normalizedText(value);
  return ["prizm", "prism", "panini prizm", "panini prism"].includes(normalized);
}
''',
'''function isProductLineOnlySetEvidence(value: unknown) {
  const normalized = normalizedText(value);
  return ["prizm", "prism", "panini prizm", "panini prism"].includes(normalized);
}

function normalizedProductLineTokens(value: unknown) {
  return meaningfulTokens(value).map((token) =>
    token === "prism" ? "prizm" : token,
  );
}

function releaseSupportsProductLineSetEvidence(
  ai: Record<string, any>,
  release: Record<string, any>,
) {
  if (
    !brandEvidenceMatches(ai.brand, [
      release.manufacturer?.name,
      release.brand?.name,
      release.product_name,
    ])
  ) {
    return false;
  }
  const targetTokens = normalizedProductLineTokens(ai.setName);
  if (!targetTokens.length) return false;
  const releaseTokens = new Set(
    normalizedProductLineTokens(
      [release.brand?.name, release.product_name].filter(Boolean).join(" "),
    ),
  );
  return targetTokens.every((token) => releaseTokens.has(token));
}
''')
replace_once(path,
'''function targetParallelProfile(ai: Record<string, any>, setContext: unknown) {
  const setTokens = new Set(meaningfulTokens(setContext));
  const normalizedParallel = normalizedText(ai.parallel);
  const explicitBase = Boolean(normalizedParallel) && isBaseParallel(ai.parallel);
  const directTokens = explicitBase
    ? []
    : checklistParallelTokens(ai.parallel).filter(
        (token) =>
          !setTokens.has(token) &&
          !GENERIC_PARALLEL_EVIDENCE_TOKENS.has(token),
      );
  const noteTokens = visibleParallelNoteTokens(ai.notes);
''',
'''function targetParallelProfile(ai: Record<string, any>, setContext: unknown) {
  const setTokens = new Set(meaningfulTokens(setContext));
  const normalizedParallel = normalizedText(ai.parallel);
  const explicitBase = Boolean(normalizedParallel) && isBaseParallel(ai.parallel);
  const directTokens = explicitBase
    ? []
    : checklistParallelTokens(ai.parallel).filter(
        (token) =>
          !setTokens.has(token) &&
          !GENERIC_PARALLEL_EVIDENCE_TOKENS.has(token),
      );
  // Notes may raise a variant suspicion before scanner-council review. Once a
  // conflict-free council has adjudicated the hard parallel field, note-only
  // prose is audit context and cannot re-enter as a new hard identity fact.
  const noteTokens = ai.parallelEvidenceAdjudicated === true
    ? []
    : visibleParallelNoteTokens(ai.notes);
''')
replace_once(path,
'''  if (
    parallelProfile.baseLike &&
    (parallelProfile.surfaceRisk || adjacentYearRecovered)
  ) {
    continue;
  }
''',
'''  // Free-form finish/color prose from one scanner may not veto an otherwise
  // exact Base Registry candidate after a conflict-free multi-reader council.
  // Adjacent-year Base recovery remains fail-closed.
  if (parallelProfile.baseLike && adjacentYearRecovered) {
    continue;
  }
''')
replace_once(path,
'''  const targetYear = yearStart(ai.year);
  const targetSetTokens = new Set(meaningfulTokens(ai.setName));

  const releaseYear = release.release_year || release.season || null;
''',
'''  const targetYear = yearStart(ai.year);
  const productLineOnlySetEvidence = isProductLineOnlySetEvidence(ai.setName);
  const setEvidenceTokens = (value: unknown) =>
    productLineOnlySetEvidence
      ? normalizedProductLineTokens(value)
      : meaningfulTokens(value);
  const targetSetTokens = new Set(setEvidenceTokens(ai.setName));

  const releaseYear = release.release_year || release.season || null;
''')
replace_once(path,
'''  const registrySetTokens = new Set(
    meaningfulTokens(
      [
        brand.name,
        release.product_name,
        row.name,
        sport.name,
        league.name,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
''',
'''  const registrySetTokens = new Set(
    setEvidenceTokens(
      [
        brand.name,
        release.product_name,
        row.name,
        sport.name,
        league.name,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
''')
replace_once(path,
'''  const candidateReleaseIds = unique(
    releaseRows
      .filter((release: any) =>
        yearMatches(year, release.release_year || release.season, true),
      )
      .map((release: any) => release.id),
  );
''',
'''  // Product-line-only OCR such as PRIZM is release evidence, not a logical
  // checklist-set name. Narrow the bounded set query to matching product
  // releases before looking for Base versus a visible insert/subset. This
  // avoids year-wide set truncation while preserving exact-card uniqueness.
  const releaseRowsForCoverage = isProductLineOnlySetEvidence(ai.setName)
    ? releaseRows.filter((release: any) =>
        releaseSupportsProductLineSetEvidence(ai, release),
      )
    : releaseRows;
  const candidateReleaseIds = unique(
    releaseRowsForCoverage
      .filter((release: any) =>
        yearMatches(year, release.release_year || release.season, true),
      )
      .map((release: any) => release.id),
  );
''')

print('PASS applied clean v8 final-two repair')
