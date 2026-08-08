from pathlib import Path

path = Path("src/lib/instacomp-learning-server.ts")
text = path.read_text(encoding="utf-8")
old = '''  const productLineOnlySetEvidence = isProductLineOnlySetEvidence(ai.setName);
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
'''
new = '''  const productLineOnlySetEvidence = isProductLineOnlySetEvidence(ai.setName);
  // A product-line label (for example PRIZM) is release evidence, not a logical
  // checklist-set claim. Never let a coincidental OCR phrase shrink the release
  // to a guessed set before player/card-number/parallel uniqueness is evaluated.
  const setRowsForCoverage = productLineOnlySetEvidence
    ? scopedSetRows
    : softVisibleSetRows.length
      ? softVisibleSetRows
      : scopedSetRows;
  const coverageMatches = (
    row: Record<string, any>,
    allowAdjacentYearRecovery = false,
  ) =>
    productLineOnlySetEvidence
      ? checklistProductLineCoverageMatches(ai, row, {
          allowAdjacentYearRecovery,
        })
      : checklistSetCoverageMatches(ai, row, {
          allowAdjacentYearRecovery,
        });
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one product-line coverage anchor, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PASS product-line labels always bound release scope, never preselect logical set")
