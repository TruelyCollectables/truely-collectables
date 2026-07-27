from __future__ import annotations

import re
from collections import Counter
from pathlib import Path


def require(path: Path, values: list[str]) -> None:
    text = path.read_text()
    missing = [value for value in values if value not in text]
    if missing:
        raise SystemExit(f"{path}: missing final audit source invariants: {missing}")


def reject(path: Path, values: list[str]) -> None:
    text = path.read_text()
    present = [value for value in values if value in text]
    if present:
        raise SystemExit(f"{path}: forbidden final audit source fragments remain: {present}")


def assert_unique_functions(path: Path) -> None:
    text = path.read_text()
    names = re.findall(
        r"\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(",
        text,
    )
    duplicates = {name: count for name, count in Counter(names).items() if count > 1}
    if duplicates:
        raise SystemExit(f"{path}: duplicate function declarations remain: {duplicates}")


scan = Path("src/app/api/instacomp/scan/route.ts")
require(
    scan,
    [
        'import { normalizeInstaCompSideImages }',
        'import { readValidatedInstaCompImage }',
        'const normalizedSides = await normalizeInstaCompSideImages({',
        'frontImage = normalizedSides.frontFile;',
        'backImageForScan = normalizedSides.backFile;',
        'imageOrientation: input.imageOrientation || null,',
        'imageOrientation,\n      benchmarkDiagnostics:',
        'ocrDiagnostics: {\n        imageOrientation,',
    ],
)

benchmark = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
require(
    benchmark,
    [
        'from "../../../../../lib/instacomp-benchmark-title";',
        "benchmarkTitleEligible(title, testCase)",
        "x-instacomp-benchmark-ephemeral",
    ],
)
reject(
    benchmark,
    [
        "export function benchmarkTitleEligible",
        "export function benchmarkTitleHasExpectedYear",
        "export function benchmarkTitleHasExpectedParallel",
        "export function benchmarkTitleHasExpectedSerialRun",
    ],
)

benchmark_library = Path("src/lib/instacomp-benchmark-title.ts")
require(
    benchmark_library,
    [
        "export function benchmarkTitleHasExpectedYear",
        "export function benchmarkTitleHasExpectedParallel",
        "export function benchmarkTitleHasExpectedSerialRun",
        "export function benchmarkTitleEligible",
        "benchmarkTitleHasExpectedPlayer",
        "benchmarkTitleHasExpectedBrand",
        "benchmarkTitleHasExpectedSet",
    ],
)

seller = Path("src/app/api/account/seller/inventory/instacomp/route.ts")
require(
    seller,
    [
        'function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active")',
        'row.source.toLowerCase().startsWith("openai_web_")',
        'if (lane === "sold" && !row.soldAt) return false;',
        'const soldCompEvidence = acceptedSoldEvidence.filter',
        'const activePricingEvidence = activeCompetition.filter',
        'pricingIneligibleExactEvidence',
    ],
)

market = Path("src/lib/instacomp-live-pipeline.ts")
require(
    market,
    [
        'if (comp.sourceCategory === "sold" && !clean(comp.soldAt)) return false;',
        '.filter(isInstaCompPricingEligibleComp);',
    ],
)
reject(market, ["hasTrustedDeliveredPrice"])

matcher = Path("src/lib/instacomp.ts")
require(
    matcher,
    [
        "explainUnexpectedInstaCompBaseVariation",
        '" signature",',
        '" rpa ",',
        'if (ai && !ai.isRookie)',
        "gem|near|nm|mint|pristine|mt|ex",
    ],
)

catalog = Path("src/lib/instacomp-curated-checklist.ts")
require(
    catalog,
    [
        "officialBenchmarkCatalogFamily",
        "officialBenchmarkCatalogCandidate",
        "if (officialBenchmarkCatalogFamily(input) && !officialCandidate) return null;",
    ],
)

orientation = Path("src/lib/instacomp-image-orientation.ts")
require(
    orientation,
    [
        '.autoOrient()\n    .rotate(params.rotation)',
        "Judge FRONT and BACK independently",
        "frontRotation",
        "backRotation",
    ],
)
reject(orientation, [".rotate()\n    .rotate(params.rotation)"])

visual = Path("src/lib/instacomp-comp-visual-verification.ts")
require(visual, ["awaiting image proof"])

for path in [
    benchmark,
    benchmark_library,
    Path("src/app/api/instacomp/live-scan/route.ts"),
    scan,
    seller,
    matcher,
    catalog,
]:
    assert_unique_functions(path)

regression = Path("scripts/run-instacomp-exact-market-proof-regressions.ts")
require(regression, ['benchmarkTitleSource.includes("benchmarkTitleHasExpectedSerialRun")'])
reject(regression, ['benchmarkSource.includes("benchmarkTitleHasExpectedSerialRun")'])
reject(regression, ['benchmarkSource.includes("titleHasExpectedSerialRun")'])

final_regression = Path("scripts/run-instacomp-final-audit-regressions.ts")
require(final_regression, ['from "../src/lib/instacomp-benchmark-title";'])
reject(final_regression, ['from "../src/app/api/instacomp/benchmark/ebay-25/route";'])

print("Final InstaComp materialized source invariants passed.")
