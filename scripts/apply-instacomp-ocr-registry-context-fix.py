from pathlib import Path

server_path = Path("src/lib/instacomp-checklist-first-server.ts")
text = server_path.read_text()

old = '''  const inferredPlayer = input.player || inferPlayerFromOcr(ocr, candidates);
  const reasons = [
    !input.year && inferredYear ? "ocr_inferred_year" : null,
    !input.manufacturer && inferredManufacturer
      ? "ocr_inferred_manufacturer"
      : null,
    !input.player && inferredPlayer ? "ocr_inferred_player" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    input: {
      ...input,
      year: inferredYear || null,
      manufacturer: inferredManufacturer || null,
      player: inferredPlayer || null,
      ocrText: null,
    },
    reasons,
  };
'''

new = '''  const inferredPlayer = input.player || inferPlayerFromOcr(ocr, candidates);
  const boundedProductCandidates = candidates.filter((candidate) => {
    if (
      input.cardNumber &&
      normalizedCardNumber(candidate.cardNumber) !== normalizedCardNumber(input.cardNumber)
    ) {
      return false;
    }
    if (
      inferredYear &&
      registryYearStart(candidate.year) !== registryYearStart(inferredYear)
    ) {
      return false;
    }
    if (inferredManufacturer) {
      const target = normalizedText(inferredManufacturer);
      const values = [candidate.manufacturer, candidate.brand, candidate.product]
        .map(normalizedText)
        .filter(Boolean);
      if (
        !values.some(
          (value) =>
            value === target || value.includes(target) || target.includes(value),
        )
      ) {
        return false;
      }
    }
    if (
      inferredPlayer &&
      normalizedText(candidate.player) !== normalizedText(inferredPlayer)
    ) {
      return false;
    }
    return true;
  });
  const uniqueBrands = uniqueNormalized(
    boundedProductCandidates.map(
      (candidate) => candidate.brand || candidate.product || null,
    ),
  );
  const uniqueSets = uniqueNormalized(
    boundedProductCandidates.map(
      (candidate) => candidate.setName || candidate.product || null,
    ),
  );
  const inferredBrand =
    input.brand || (uniqueBrands.length === 1 ? uniqueBrands[0] : null);
  const inferredSetName =
    input.setName || (uniqueSets.length === 1 ? uniqueSets[0] : null);
  const reasons = [
    !input.year && inferredYear ? "ocr_inferred_year" : null,
    !input.manufacturer && inferredManufacturer
      ? "ocr_inferred_manufacturer"
      : null,
    !input.player && inferredPlayer ? "ocr_inferred_player" : null,
    !input.brand && inferredBrand ? "ocr_bounded_inferred_brand" : null,
    !input.setName && inferredSetName ? "ocr_bounded_inferred_set" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    input: {
      ...input,
      year: inferredYear || null,
      manufacturer: inferredManufacturer || null,
      brand: inferredBrand || null,
      setName: inferredSetName || null,
      player: inferredPlayer || null,
      ocrText: null,
    },
    reasons,
  };
'''

if new not in text:
    if old not in text:
        raise SystemExit("OCR Registry enrichment anchor missing")
    text = text.replace(old, new, 1)
server_path.write_text(text)

test_path = Path("scripts/run-instacomp-ocr-registry-primary-regressions.ts")
test = test_path.read_text()
old_assert = '''assert.deepEqual(enriched.reasons.sort(), [
  "ocr_inferred_manufacturer",
  "ocr_inferred_player",
  "ocr_inferred_year",
]);
'''
new_assert = '''assert.equal(enriched.input.brand, "Panini Prizm");
assert.equal(enriched.input.setName, "Panini Prizm WNBA");
assert.deepEqual(enriched.reasons.sort(), [
  "ocr_bounded_inferred_brand",
  "ocr_bounded_inferred_set",
  "ocr_inferred_manufacturer",
  "ocr_inferred_player",
  "ocr_inferred_year",
]);
'''
if new_assert not in test:
    if old_assert not in test:
        raise SystemExit("OCR Registry regression assertion anchor missing")
    test = test.replace(old_assert, new_assert, 1)
test_path.write_text(test)

smoke_path = Path("scripts/smoke-admin-runtime.mjs")
smoke = smoke_path.read_text()
anchor = '''  {
    path: "/admin/instacomp/checklists",
    auth: true,
    expectedText: "Checklist Registry",
  },
'''
addition = '''  {
    path: "/admin/instacomp/checklists",
    auth: true,
    expectedText: "Checklist Registry",
  },
  {
    path: "/admin/instacomp/checklist-sentinel",
    auth: true,
    expectedText: "Checklist Sentinel",
  },
  {
    path: "/admin/instacomp/fast",
    auth: true,
    expectedText: "InstaComp",
  },
'''
if 'path: "/admin/instacomp/checklist-sentinel"' not in smoke:
    if anchor not in smoke:
        raise SystemExit("admin runtime smoke InstaComp anchor missing")
    smoke = smoke.replace(anchor, addition, 1)
if 'path: "/admin/instacomp/fast"' not in smoke:
    if anchor not in smoke:
        raise SystemExit("admin runtime smoke fast scanner anchor missing")
    smoke = smoke.replace(anchor, addition, 1)
smoke_path.write_text(smoke)
