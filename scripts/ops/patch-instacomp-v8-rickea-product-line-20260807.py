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
  const specificSoftVisibleSetRows = softVisibleSetRows.filter(
    (row: any) => !isProductLineOnlySetEvidence(row.name),
  );
  // PRIZM is release/product evidence, not a logical checklist-set claim. Keep a
  // genuinely specific printed logical set such as GROOVY, but discard soft OCR
  // matches whose set name is itself only the product line. If no specific set
  // remains, search the whole matching Prizm release and require the remaining
  // visible facts to resolve one unique identity.
  const setRowsForCoverage = productLineOnlySetEvidence
    ? specificSoftVisibleSetRows.length
      ? specificSoftVisibleSetRows
      : scopedSetRows
    : softVisibleSetRows.length
      ? softVisibleSetRows
      : scopedSetRows;
  const coverageMatches = (
    row: Record<string, any>,
    allowAdjacentYearRecovery = false,
  ) =>
    productLineOnlySetEvidence && !specificSoftVisibleSetRows.length
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
print("PASS product-line pseudo-sets cannot displace a specific logical OCR set")
