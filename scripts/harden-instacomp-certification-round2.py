from __future__ import annotations

import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count == 0:
        if replacement in text:
            return text
        raise SystemExit(f"Could not locate {label} pattern")
    return updated


def patch_benchmark_source_and_ephemeral_mode() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()

    text = regex_once(
        text,
        r'''function titleConflictsWithExpectedParallel\(\n  title: string,\n  testCase: InstaCompEbayBenchmarkCase,\n\) \{.*?\n\}''',
        '''function titleConflictsWithExpectedParallel(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const expectedParallel = normalized(testCase.expected.parallel);
  if (expectedParallel && expectedParallel !== "base") return false;

  const titleText = normalized(title);
  const conflictingParallels = new Set<string>();
  for (const candidate of INSTACOMP_EBAY_BENCHMARK_CASES) {
    if (normalized(candidate.expected.setName) !== normalized(testCase.expected.setName)) continue;
    const namedParallel = normalized(candidate.expected.parallel);
    if (!namedParallel || namedParallel === "base") continue;
    const names = [candidate.expected.parallel, ...(candidate.expected.parallelAliases || [])]
      .map(normalized)
      .filter((value) => value && value !== "base");
    for (const name of names) conflictingParallels.add(name);
  }
  return Array.from(conflictingParallels).some((parallel) =>
    parallel.split(" ").every((token) => titleText.includes(token)),
  );
}

function titleHasExpectedParallel(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const expectedParallel = normalized(testCase.expected.parallel);
  if (!expectedParallel || expectedParallel === "base") return true;
  return [testCase.expected.parallel, ...(testCase.expected.parallelAliases || [])]
    .map(normalized)
    .filter(Boolean)
    .some((parallel) => parallel.split(" ").every((token) => normalized(title).includes(token)));
}

function titleSerialDenominators(title: string) {
  const withoutSeason = title.replace(/\b(?:19|20)\d{2}\s*[-/]\s*\d{2,4}\b/g, " ");
  return Array.from(withoutSeason.matchAll(/(?:\b\d{1,6}\s*)?\/\s*(\d{1,6})\b/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function titleHasExpectedSerialRun(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const denominators = titleSerialDenominators(title);
  const expected = testCase.expected.serialDenominator;
  if (!expected) return denominators.length === 0;
  return denominators.length > 0 && denominators.every((denominator) => denominator === expected);
}''',
        "benchmark source parallel and serial gates",
    )

    text = replace_once(
        text,
        '''        !rejectedTitle(title) &&
        !titleConflictsWithExpectedParallel(title, testCase) &&
        score >= 65,
''',
        '''        !rejectedTitle(title) &&
        !titleConflictsWithExpectedParallel(title, testCase) &&
        titleHasExpectedParallel(title, testCase) &&
        titleHasExpectedSerialRun(title, testCase) &&
        score >= 65,
''',
        "benchmark source filter",
    )

    text = replace_once(
        text,
        '''    formData.append("aiCouncilTier", "adaptive");
''',
        '''    formData.append("aiCouncilTier", "adaptive");
''',
        "benchmark form data anchor",
    )

    text = replace_once(
        text,
        '''        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminSession)}`,
        "x-forwarded-for": "127.0.0.1",
''',
        '''        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminSession)}`,
        "x-forwarded-for": "127.0.0.1",
        "x-instacomp-benchmark-ephemeral": clean(process.env.INSTACOMP_BENCHMARK_TOKEN),
''',
        "benchmark ephemeral header",
    )

    path.write_text(text)


def patch_scan_ephemeral_persistence() -> None:
    path = Path("src/app/api/instacomp/scan/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''import { createHash } from "crypto";
''',
        '''import { createHash, timingSafeEqual } from "crypto";
''',
        "timing-safe crypto import",
    )

    text = replace_once(
        text,
        '''export async function POST(req: NextRequest) {
  let persistentContext: PersistentJobScanContext | null = null;
''',
        '''function authorizedEphemeralBenchmark(req: NextRequest) {
  if (String(process.env.VERCEL_ENV || "").trim() !== "preview") return false;
  const expected = String(process.env.INSTACOMP_BENCHMARK_TOKEN || "").trim();
  const supplied = String(req.headers.get("x-instacomp-benchmark-ephemeral") || "").trim();
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  let persistentContext: PersistentJobScanContext | null = null;
''',
        "ephemeral benchmark authorization",
    )

    text = replace_once(
        text,
        '''  try {
    const actor = await requireInstaCompJobActor(req);
''',
        '''  try {
    const ephemeralBenchmark = authorizedEphemeralBenchmark(req);
    const actor = await requireInstaCompJobActor(req);
''',
        "ephemeral benchmark request state",
    )

    text = replace_once(
        text,
        '''    const scanId = await saveScanToSupabase({
      imageFilename: frontImage.name || null,
      ai,
      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      stats,
      soldStats,
      links,
      providers,
      sourceCoverage,
      marketValueComps,
      soldComps,
      remainingCards,
      catalogEvidence,
    });
''',
        '''    const scanId = ephemeralBenchmark
      ? null
      : await saveScanToSupabase({
          imageFilename: frontImage.name || null,
          ai,
          searchQuery: queries.primary,
          backupQueries: queries.backupQueries,
          stats,
          soldStats,
          links,
          providers,
          sourceCoverage,
          marketValueComps,
          soldComps,
          remainingCards,
          catalogEvidence,
        });
''',
        "ephemeral persistence bypass",
    )

    text = replace_once(
        text,
        '''      ocrDiagnostics: {
''',
        '''      benchmarkDiagnostics: {
        ephemeral: ephemeralBenchmark,
        persistenceSkipped: ephemeralBenchmark,
      },
      ocrDiagnostics: {
''',
        "ephemeral response diagnostics",
    )

    path.write_text(text)


def patch_catalog_resolution() -> None:
    path = Path("src/lib/instacomp-curated-checklist.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''    year: ai.year,
''',
        '''    year:
      /^(?:ice\s+)?hockey$/i.test(cleanText(ai.sport)) && /^\d{4}$/.test(cleanText(ai.year))
        ? `${cleanText(ai.year)}-${String(Number(cleanText(ai.year)) + 1).slice(-2)}`
        : ai.year,
''',
        "hockey season year normalization",
    )

    text = regex_once(
        text,
        r'''function candidateIsPlausible\(\n  input: InstaCompCatalogIdentityInput,\n  candidate: InstaCompCatalogCandidateIdentity,\n\) \{.*?\n\}''',
        '''function catalogTokens(value: string | null | undefined) {
  return comparableText(value)
    .replace(/[/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedPlayerKey(value: string | null | undefined) {
  return catalogTokens(value)
    .filter((token) => token !== "and")
    .sort()
    .join(" ");
}

function catalogYearStart(value: string | null | undefined) {
  return comparableText(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

function candidateIsPlausible(
  input: InstaCompCatalogIdentityInput,
  candidate: InstaCompCatalogCandidateIdentity,
) {
  const cardNumberMatches =
    Boolean(comparableCardNumber(input.cardNumber)) &&
    comparableCardNumber(input.cardNumber) === comparableCardNumber(candidate.cardNumber);
  const yearMatches =
    Boolean(catalogYearStart(input.year)) &&
    catalogYearStart(input.year) === catalogYearStart(candidate.year);
  const brandMatches =
    Boolean(comparableText(input.brand)) &&
    comparableText(input.brand) === comparableText(candidate.brand);
  const playerMatches =
    Boolean(normalizedPlayerKey(input.player)) &&
    normalizedPlayerKey(input.player) === normalizedPlayerKey(candidate.player);

  const inputSetTokens = new Set(
    catalogTokens([input.setName, input.parallel, input.variation].filter(Boolean).join(" ")),
  );
  const candidateSetTokens = catalogTokens(candidate.setName).filter(
    (token) =>
      ![
        "upper",
        "deck",
        "series",
        "hockey",
        "parallel",
        "the",
      ].includes(token) && !/^\d+$/.test(token),
  );
  const setMatches =
    candidateSetTokens.length > 0 &&
    (candidateSetTokens.every((token) => inputSetTokens.has(token)) ||
      (candidateSetTokens.includes("base") &&
        catalogTokens(input.setName).join(" ").includes("upper deck series 1")));

  const candidateParallel = comparableText(candidate.parallel || candidate.variation);
  const candidateParallelTokens = catalogTokens(candidateParallel).filter(
    (token) => !["parallel", "prizm", "refractor", "holo", "the"].includes(token),
  );
  const candidateIsBase = !candidateParallel || isGenericBase(candidateParallel);
  const setTokenSet = new Set(candidateSetTokens);
  const inputParallelDistinctive = catalogTokens(input.parallel || input.variation).filter(
    (token) =>
      !["parallel", "prizm", "refractor", "holo", "base", "card", "the"].includes(token) &&
      !setTokenSet.has(token),
  );
  const parallelMatches = candidateIsBase
    ? inputParallelDistinctive.length === 0
    : candidateParallelTokens.every((token) => inputSetTokens.has(token));

  const candidateSerialRun = comparableText(candidate.serialRun);
  const serialMatches =
    !candidateSerialRun || comparableText(input.serialRun) === candidateSerialRun;
  const autographMatches =
    typeof candidate.isAuto !== "boolean" || input.isAuto === candidate.isAuto;
  const relicMatches =
    typeof candidate.isRelic !== "boolean" || input.isRelic === candidate.isRelic;

  return Boolean(
    cardNumberMatches &&
      yearMatches &&
      brandMatches &&
      playerMatches &&
      setMatches &&
      parallelMatches &&
      serialMatches &&
      autographMatches &&
      relicMatches,
  );
}''',
        "catalog candidate gate",
    )

    text = replace_once(
        text,
        '''  if (!candidates.length) return null;

  const providerResults: InstaCompCatalogProviderResult[] = [
''',
        '''  if (!candidates.length) return null;

  const resolvedInput: InstaCompCatalogIdentityInput =
    candidates.length === 1
      ? {
          ...input,
          player: candidates[0].player,
          year: candidates[0].year,
          brand: candidates[0].brand,
          setName: candidates[0].setName,
          cardNumber: candidates[0].cardNumber,
          parallel: candidates[0].parallel,
          variation: candidates[0].variation,
          serialRun: candidates[0].serialRun,
          team: candidates[0].team,
          sport: candidates[0].sport,
          isAuto: candidates[0].isAuto,
          isRelic: candidates[0].isRelic,
        }
      : input;

  const providerResults: InstaCompCatalogProviderResult[] = [
''',
        "catalog resolved input",
    )

    text = replace_once(
        text,
        '''  return buildInstaCompCatalogEvidenceSnapshot(
    input,
''',
        '''  return buildInstaCompCatalogEvidenceSnapshot(
    resolvedInput,
''',
        "catalog normalized evidence input",
    )

    path.write_text(text)


def patch_regressions() -> None:
    path = Path("scripts/run-instacomp-exact-market-proof-regressions.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
''',
        '''import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
import { buildInstaCompCuratedChecklistEvidence } from "../src/lib/instacomp-curated-checklist";
''',
        "catalog regression import",
    )

    marker = '''console.log(
  "InstaComp Batch 001 exact-market regression passed:'''
    if marker not in text:
        raise SystemExit("Could not locate regression completion marker")
    tests = '''const officialCatalogMatch = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Lane Hutson",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",
    cardNumber: "C-111",
    parallel: "UD Canvas",
    serialNumber: null,
    team: "Montreal Canadiens",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.95,
    notes: null,
  },
});
assert.equal(officialCatalogMatch?.status, "catalog_confirmed");
assert.equal(officialCatalogMatch?.compIdentity?.cardNumber, "C-111");
assert.equal(officialCatalogMatch?.compIdentity?.year, "2024-25");
assert.match(String(officialCatalogMatch?.compIdentity?.parallel), /Canvas Young Guns/i);

const wrongCatalogParallel = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Connor Bedard",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - City Satellites",
    cardNumber: "CS-11",
    parallel: "Blue parallel",
    serialNumber: null,
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isRookie: false,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.8,
    notes: null,
  },
});
assert.equal(
  wrongCatalogParallel,
  null,
  "an unlisted blue City Satellites variation must not fall back to the base catalog card",
);

const scanSource = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const benchmarkSource = fs.readFileSync(
  "src/app/api/instacomp/benchmark/ebay-25/route.ts",
  "utf8",
);
assert.ok(scanSource.includes("authorizedEphemeralBenchmark"));
assert.ok(scanSource.includes("const scanId = ephemeralBenchmark"));
assert.ok(benchmarkSource.includes("x-instacomp-benchmark-ephemeral"));
assert.ok(benchmarkSource.includes("titleHasExpectedSerialRun"));

'''
    text = text.replace(marker, tests + marker, 1)
    path.write_text(text)


def main() -> None:
    patch_benchmark_source_and_ephemeral_mode()
    patch_scan_ephemeral_persistence()
    patch_catalog_resolution()
    patch_regressions()


if __name__ == "__main__":
    main()
