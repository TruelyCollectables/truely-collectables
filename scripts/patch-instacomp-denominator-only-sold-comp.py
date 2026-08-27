#!/usr/bin/env python3
from pathlib import Path

path = Path("src/lib/instacomp.ts")
source = path.read_text("utf-8")
old = '''function serialRunDenominatorFromTitle(title: string) {
  const normalized = stripSeasonRanges(
    normalizeText(title)
      .replace(/\\bone\\s+of\\s+one\\b/g, "1/1")
      .replace(/\\b1\\s+of\\s+1\\b/g, "1/1"),
  );
  const parsed = extractInstaCompSerialNumber(normalized);
  const denominator = Number(parsed?.denominator);

  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}
'''
new = '''function serialRunDenominatorFromTitle(title: string) {
  const normalized = stripSeasonRanges(
    normalizeText(title)
      .replace(/\\bone\\s+of\\s+one\\b/g, "1/1")
      .replace(/\\b1\\s+of\\s+1\\b/g, "1/1"),
  );
  const parsed = extractInstaCompSerialNumber(normalized);
  const denominator = Number(parsed?.denominator);
  if (Number.isFinite(denominator) && denominator > 0) return denominator;

  // Sold listings frequently omit the physical copy numerator and advertise
  // only the configuration-level print run (for example "Refractor /499").
  // That is sufficient for exact comping because 355/499 and 29/499 are the
  // same card configuration. The copy numerator remains physical-card data.
  const denominatorOnly = Array.from(
    normalized.matchAll(/(?:^|[^0-9])\\/\\s*(\\d{1,6})\\b/g),
  )
    .map((match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return denominatorOnly.length ? denominatorOnly[denominatorOnly.length - 1] : null;
}
'''
if new in source:
    print("denominator-only exact sold-comp support already present")
elif source.count(old) != 1:
    raise SystemExit(f"Expected exactly one serialRunDenominatorFromTitle block; found {source.count(old)}")
else:
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print("patched exact-market denominator-only sold-comp matching")
