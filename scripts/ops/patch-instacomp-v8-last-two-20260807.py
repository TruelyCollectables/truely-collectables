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


# 1) A serial number is identity evidence only when an independent printed reader corroborates it.
path = "src/lib/instacomp-identity-guard.ts"
replace_once(
    path,
    '''function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}
''',
    '''function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}

function comparableSerial(value: string | null | undefined) {
  return cleanSignalText(value)
    .toLowerCase()
    .replace(/\\s+/g, "")
    .replace(/^0+(?=\\d)/, "");
}

export function applyInstaCompSerialEvidenceGuard(
  ai: InstaCompAiResult,
  confirmedSerialNumbers: Array<string | null | undefined>,
): InstaCompAiResult {
  const candidate = cleanSignalText(ai.serialNumber);
  if (!candidate) return ai;
  const candidateKey = comparableSerial(candidate);
  const confirmed = confirmedSerialNumbers
    .map((value) => cleanSignalText(value))
    .filter(Boolean);
  const corroborated = confirmed.some(
    (value) => comparableSerial(value) === candidateKey,
  );
  if (corroborated) return ai;

  return {
    ...ai,
    serialNumber: null,
    notes: appendNote(
      ai.notes,
      `Serial evidence guard suppressed uncorroborated serial "${candidate}"; fresh printed evidence did not confirm that exact stamp.`,
    ),
  };
}
''',
)

# 2) Apply the serial evidence guard before the primary reader, escalation, and Registry probe.
path = "src/app/api/instacomp/scan/route.ts"
replace_once(
    path,
    'import { applyInstaCompIdentityGuard } from "../../../../lib/instacomp-identity-guard";\n',
    '''import {
  applyInstaCompIdentityGuard,
  applyInstaCompSerialEvidenceGuard,
} from "../../../../lib/instacomp-identity-guard";
''',
)
replace_once(
    path,
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
    const deterministicSerialNumber = String(
      internalReceipt.internalDeterministicIdentity?.serialNumber || "",
    ).trim() || null;
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
    const baseAiForConsensus = applyOperatorSerialNumberOverride(
      baseAi,
      operatorSerialNumberOverride,
    );
''',
)
replace_once(
    path,
    '''    const listingIdentityHint = extractUntrustedListingIdentityHint(listingTitleHint);
    const internalReceipt = primaryAiResult.value as InstaCompAiResultWithInternalReceipt;
    const registryVisibleText = [
''',
    '''    const listingIdentityHint = extractUntrustedListingIdentityHint(listingTitleHint);
    const registryVisibleText = [
''',
)
replace_once(
    path,
    '''        ai: applyInstaCompIdentityGuard(
          applyOperatorSerialNumberOverride(
            mergeGradingDetection(mergeSerialOcrResult(reader.ai, serialOcr), externalOcr),
            operatorSerialNumberOverride,
          ),
          {
            externalOcrText: externalOcr?.text || null,
          },
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
          {
            externalOcrText: externalOcr?.text || null,
          },
        ),
''',
)

# 3) Product-line-only set evidence covers all logical sets inside the matching release when
# no fresh OCR names a more specific logical set. Player/card#/parallel still must make one unique identity.
path = "src/lib/instacomp-learning-server.ts"
replace_once(
    path,
    '''function checklistSetCoverageMatches(
  ai: Record<string, any>,
  row: Record<string, any>,
  options: { allowAdjacentYearRecovery?: boolean } = {},
) {
''',
    '''function checklistProductLineCoverageMatches(
  ai: Record<string, any>,
  row: Record<string, any>,
  options: { allowAdjacentYearRecovery?: boolean } = {},
) {
  const release = record(row.release);
  const manufacturer = record(release.manufacturer);
  const brand = record(release.brand);
  const targetYear = yearStart(ai.year);
  const targetProductTokens = meaningfulTokens(ai.setName);
  const releaseYear = release.release_year || release.season || null;
  if (
    !yearMatches(
      targetYear,
      releaseYear,
      options.allowAdjacentYearRecovery === true,
    )
  ) {
    return false;
  }
  if (
    !brandEvidenceMatches(ai.brand, [
      manufacturer.name,
      brand.name,
      release.product_name,
    ])
  ) {
    return false;
  }
  const releaseProductTokens = new Set(
    meaningfulTokens([brand.name, release.product_name].filter(Boolean).join(" ")),
  );
  return targetProductTokens.every((token) => releaseProductTokens.has(token));
}

function checklistSetCoverageMatches(
  ai: Record<string, any>,
  row: Record<string, any>,
  options: { allowAdjacentYearRecovery?: boolean } = {},
) {
''',
)
replace_once(
    path,
    '''  const setRowsForCoverage = softVisibleSetRows.length
    ? softVisibleSetRows
    : scopedSetRows;

  const exactCoveredSets = setRowsForCoverage.filter((row: any) =>
    checklistSetCoverageMatches(ai, row),
  );
  const adjacentCoveredSets = exactCoveredSets.length
    ? []
    : setRowsForCoverage.filter((row: any) =>
        checklistSetCoverageMatches(ai, row, {
          allowAdjacentYearRecovery: true,
        }),
      );
''',
    '''  const productLineOnlySetEvidence = isProductLineOnlySetEvidence(ai.setName);
  const setRowsForCoverage = softVisibleSetRows.length
    ? softVisibleSetRows
    : scopedSetRows;
  const coverageMatches = (
    row: Record<string, any>,
    allowAdjacentYearRecovery = false,
  ) =>
    productLineOnlySetEvidence && !softVisibleSetRows.length
      ? checklistProductLineCoverageMatches(ai, row, {
          allowAdjacentYearRecovery,
        })
      : checklistSetCoverageMatches(ai, row, {
          allowAdjacentYearRecovery,
        });

  const exactCoveredSets = setRowsForCoverage.filter((row: any) =>
    coverageMatches(row),
  );
  const adjacentCoveredSets = exactCoveredSets.length
    ? []
    : setRowsForCoverage.filter((row: any) =>
        coverageMatches(row, true),
      );
''',
)

print("PASS applied v8 last-two repair")
