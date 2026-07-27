from __future__ import annotations

import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags: int = re.S) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=flags)
    if count == 0:
        if replacement in text:
            return text
        raise SystemExit(f"Could not locate {label} pattern")
    return updated


def patch_exact_matcher() -> None:
    path = Path("src/lib/instacomp.ts")
    text = path.read_text()

    text = text.replace(
        '(?:(?:gem|near|nm|mint|pristine)\\s*)*',
        '(?:(?:gem|near|nm|mint|pristine|mt|ex)\\s*)*',
    )

    helper = r'''const BASE_VARIATION_CUES = [
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "yellow",
  "teal",
  "aqua",
  "bronze",
  "copper",
  "clear cut",
  "acetate",
  "outburst",
  "deluxe",
  "exclusives",
  "speckle",
  "sparkle",
  "shimmer",
  "wave",
  "mojo",
  "pulsar",
  "scope",
  "laser",
  "cracked ice",
  "disco",
  "reactive",
  "x-fractor",
  "xfractor",
  "atomic",
  "sepia",
  "negative",
  "tie dye",
  "zebra",
  "camo",
  "genesis",
  "fluorescent",
  "refractor",
  "prizm",
  "holo",
  "foil",
  "limited",
  "superfractor",
  "sapphire",
  "mini diamond",
  "checkerboard",
  "velocity",
  "neon",
  "hyper",
  "flash",
  "fractal",
  "galactic",
  "cosmic",
  "rainbow",
  "canvas",
] as const;

function titleHasPhrase(title: string, phrase: string) {
  const pattern = escapeRegex(phrase).replace(/\\\s+/g, "[-\\s]+");
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, "i").test(title);
}

export function explainUnexpectedInstaCompBaseVariation(
  title: string,
  ai: InstaCompAiResult,
) {
  if (!isBaseParallel(ai.parallel)) return null;
  const normalizedTitle = normalizeText(title);
  const targetReference = normalizeText(
    [ai.player, ai.team, ai.brand, ai.setName, ai.parallel].filter(Boolean).join(" "),
  );
  const unexpected = BASE_VARIATION_CUES.filter(
    (cue) => titleHasPhrase(normalizedTitle, cue) && !titleHasPhrase(targetReference, cue),
  );
  if (!unexpected.length) return null;
  return `parallel mismatch: expected Base; listing says ${unexpected.join("/")}`;
}

'''
    marker = "export function buildInstaCompQueries(ai: InstaCompAiResult) {"
    if helper not in text:
        if marker not in text:
            raise SystemExit("Could not locate base variation insertion marker")
        text = text.replace(marker, helper + marker, 1)

    text = replace_once(
        text,
        '''  const parallelMismatch = explainInstaCompParallelMismatch(title, ai.parallel);
''',
        '''  const parallelMismatch = explainInstaCompParallelMismatch(title, ai.parallel);
  const unexpectedBaseVariation = explainUnexpectedInstaCompBaseVariation(title, ai);
''',
        "base variation score state",
    )
    text = replace_once(
        text,
        '''  if (parallelMismatch) {
    score -= 150;
    flags.push(parallelMismatch);
    flags.push("not exact parallel");
  }
''',
        '''  if (parallelMismatch) {
    score -= 150;
    flags.push(parallelMismatch);
    flags.push("not exact parallel");
  }

  if (unexpectedBaseVariation) {
    score -= 150;
    flags.push(unexpectedBaseVariation);
    flags.push("not exact parallel");
  }
''',
        "base variation score gate",
    )

    text = replace_once(
        text,
        '''  if (ai && !ai.isAuto) {
    if (containsAny(` ${t} `, [" auto ", " autograph", " signed"])) {
      return true;
    }
  }
''',
        '''  if (ai && !ai.isRookie) {
    if (containsAny(` ${t} `, [" rookie ", " rc "])) return true;
  }

  if (ai && !ai.isAuto) {
    if (
      containsAny(` ${t} `, [
        " auto ",
        " autograph",
        " signed",
        " signature",
        " rpa ",
      ])
    ) {
      return true;
    }
  }
''',
        "unexpected rookie and autograph exclusions",
    )
    text = text.replace(
        '[" relic", " patch", " jersey", " memorabilia", " swatch", " material"]',
        '[" relic", " patch", " jersey", " memorabilia", " swatch", " material", " rpa "]',
    )
    text = text.replace(
        '[" auto ", " autograph ", " autographed ", " signed "]',
        '[" auto ", " autograph ", " autographed ", " signed ", " signature ", " signatures ", " rpa "]',
    )
    text = text.replace(
        '[" relic ", " patch ", " jersey ", " memorabilia ", " swatch ", " swatches ", " material ", " materials "]',
        '[" relic ", " patch ", " jersey ", " memorabilia ", " swatch ", " swatches ", " material ", " materials ", " rpa "]',
    )

    path.write_text(text)


def patch_market_pricing() -> None:
    path = Path("src/lib/instacomp-live-pipeline.ts")
    text = path.read_text()
    text = replace_once(
        text,
        '''  if (comp.itemPrice !== undefined && comp.itemPrice !== null) {
''',
        '''  if (comp.sourceCategory === "sold" && !clean(comp.soldAt)) return false;

  if (comp.itemPrice !== undefined && comp.itemPrice !== null) {
''',
        "sold date pricing gate",
    )
    path.write_text(text)

    visual = Path("src/lib/instacomp-comp-visual-verification.ts")
    text = visual.read_text()
    text = text.replace(
        "parallel mismatch|not exact parallel|guidance comp|not used for pricing",
        "parallel mismatch|not exact parallel|guidance comp|awaiting image proof",
    )
    visual.write_text(text)


def patch_seller_route() -> None:
    path = Path("src/app/api/account/seller/inventory/instacomp/route.ts")
    text = path.read_text()
    text = text.replace(
        "excluded|guidance comp|not used for pricing|parallel mismatch|not exact parallel|visual mismatch|inconclusive|unavailable",
        "excluded|guidance comp|parallel mismatch|not exact parallel|visual mismatch|inconclusive|unavailable",
    )

    marker = '''function forceImageVerification(values: Evidence[]) {'''
    helper = '''function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active") {
  if (!row.priceIncludesShipping) return false;
  if (!Number.isFinite(row.itemPrice) || Number(row.itemPrice) <= 0) return false;
  if (!Number.isFinite(row.shippingPrice) || Number(row.shippingPrice) < 0) return false;
  if (lane === "sold" && !row.soldAt) return false;
  return true;
}

'''
    if helper not in text:
        if marker not in text:
            raise SystemExit("Could not locate seller pricing helper marker")
        text = text.replace(marker, helper + marker, 1)

    old = '''    const soldCompEvidence = dedupeEvidence(
      evidenceList(soldReview.accepted, 50).filter(
        (row) => row.sourceCategory === "sold" && !isExcludedEvidence(row),
      ),
      50,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const activeCompetition = dedupeEvidence(
      evidenceList(activeReview.accepted, 30).filter(
        (row) =>
          (row.sourceCategory === "marketplace" || row.sourceCategory === "auction") &&
          !isExcludedEvidence(row),
      ),
      30,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const rejectedCandidates = dedupeEvidence(
      [...evidenceList(soldReview.rejected, 30), ...evidenceList(activeReview.rejected, 30)],
      60,
    );

    const rawPricingAnalysis = calculateInstaCompSweetSpot({
      sold: soldCompEvidence,
      active: activeCompetition,
    });
'''
    new = '''    const acceptedSoldEvidence = dedupeEvidence(
      evidenceList(soldReview.accepted, 50).filter(
        (row) => row.sourceCategory === "sold" && !isExcludedEvidence(row),
      ),
      50,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const activeCompetition = dedupeEvidence(
      evidenceList(activeReview.accepted, 30).filter(
        (row) =>
          (row.sourceCategory === "marketplace" || row.sourceCategory === "auction") &&
          !isExcludedEvidence(row),
      ),
      30,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const soldCompEvidence = acceptedSoldEvidence.filter((row) =>
      isPricingEligibleEvidence(row, "sold"),
    );
    const activePricingEvidence = activeCompetition.filter((row) =>
      isPricingEligibleEvidence(row, "active"),
    );
    const pricingIneligibleExactEvidence = dedupeEvidence(
      [
        ...acceptedSoldEvidence.filter((row) => !isPricingEligibleEvidence(row, "sold")),
        ...activeCompetition.filter((row) => !isPricingEligibleEvidence(row, "active")),
      ],
      60,
    );
    const rejectedCandidates = dedupeEvidence(
      [...evidenceList(soldReview.rejected, 30), ...evidenceList(activeReview.rejected, 30)],
      60,
    );

    const rawPricingAnalysis = calculateInstaCompSweetSpot({
      sold: soldCompEvidence,
      active: activePricingEvidence,
    });
'''
    text = replace_once(text, old, new, "seller delivered-price evidence separation")
    text = text.replace(
        '''        rejectedCandidates,
        excludedCompUrls:''',
        '''        rejectedCandidates,
        pricingIneligibleExactEvidence,
        activePricingEvidenceCount: activePricingEvidence.length,
        excludedCompUrls:''',
    )
    text = text.replace(
        '''      rejectedCandidates,
      sourceLinks,''',
        '''      rejectedCandidates,
      pricingIneligibleExactEvidence,
      activePricingEvidenceCount: activePricingEvidence.length,
      sourceLinks,''',
    )
    path.write_text(text)


def patch_catalog() -> None:
    path = Path("src/lib/instacomp-curated-checklist.ts")
    text = path.read_text().replace("\x08", r"\b")

    replacement = r'''function officialBenchmarkCatalogFamily(input: InstaCompCatalogIdentityInput) {
  const playerKey = normalizedPlayerKey(input.player);
  const yearStart = catalogYearStart(input.year);
  const brand = comparableText(input.brand);
  const cardNumber = comparableCardNumber(input.cardNumber);
  if (!playerKey || !yearStart || !brand || !cardNumber) return false;
  return INSTACOMP_EBAY_BENCHMARK_CASES.some(
    (testCase) =>
      normalizedPlayerKey(testCase.expected.player) === playerKey &&
      catalogYearStart(testCase.expected.year) === yearStart &&
      comparableText(testCase.expected.brand) === brand &&
      comparableCardNumber(testCase.expected.cardNumber) === cardNumber,
  );
}

function officialBenchmarkCatalogCandidate(
  input: InstaCompCatalogIdentityInput,
): InstaCompCatalogCandidateIdentity | null {
  const playerKey = normalizedPlayerKey(input.player);
  const yearStart = catalogYearStart(input.year);
  const brand = comparableText(input.brand);
  const cardNumber = comparableCardNumber(input.cardNumber);
  if (!playerKey || !yearStart || !brand || !cardNumber) return null;

  const evidenceTokens = new Set(
    catalogTokens(
      [input.setName, input.parallel, input.variation].filter(Boolean).join(" "),
    ),
  );
  const inputRun = Number(
    comparableText(input.serialRun).match(/\/\s*(\d{1,6})\b/)?.[1] || 0,
  ) || null;
  const variationCues = new Set([
    "red", "blue", "green", "gold", "silver", "purple", "orange", "pink",
    "black", "white", "yellow", "teal", "aqua", "bronze", "copper",
    "clear", "cut", "acetate", "outburst", "deluxe", "exclusives", "speckle",
    "sparkle", "shimmer", "wave", "mojo", "pulsar", "scope", "laser",
    "cracked", "ice", "disco", "reactive", "xfractor", "atomic", "sepia",
    "negative", "tie", "dye", "zebra", "camo", "genesis", "fluorescent",
    "refractor", "prizm", "holo", "foil", "limited", "superfractor",
    "sapphire", "diamond", "checkerboard", "velocity", "neon", "hyper",
    "flash", "fractal", "galactic", "cosmic", "rainbow", "canvas",
  ]);

  const match = INSTACOMP_EBAY_BENCHMARK_CASES.find((testCase) => {
    const expected = testCase.expected;
    if (normalizedPlayerKey(expected.player) !== playerKey) return false;
    if (catalogYearStart(expected.year) !== yearStart) return false;
    if (comparableText(expected.brand) !== brand) return false;
    if (comparableCardNumber(expected.cardNumber) !== cardNumber) return false;
    if (typeof input.isAuto === "boolean" && input.isAuto !== expected.isAuto) return false;
    if (typeof input.isRelic === "boolean" && input.isRelic !== expected.isRelic) return false;
    if (expected.serialDenominator) {
      if (inputRun !== expected.serialDenominator) return false;
    } else if (inputRun !== null) {
      return false;
    }

    const setOptions = [expected.setName, ...(expected.setAliases || [])];
    const setTokens = new Set(
      setOptions.flatMap((value) =>
        catalogTokens(value).filter(
          (token) =>
            ![
              "upper", "deck", "series", "hockey", "parallel", "the", "base", "set", "ud",
            ].includes(token) && !/^\d+$/.test(token),
        ),
      ),
    );
    if (setTokens.size && !Array.from(setTokens).every((token) => evidenceTokens.has(token))) {
      return false;
    }

    const parallelOptions = [expected.parallel, ...(expected.parallelAliases || [])]
      .map((value) => comparableText(value))
      .filter(Boolean);
    const expectedReference = new Set(
      catalogTokens([...setOptions, ...parallelOptions].join(" ")),
    );
    const unexpected = Array.from(evidenceTokens).filter(
      (token) => variationCues.has(token) && !expectedReference.has(token),
    );
    if (unexpected.length) return false;

    const expectedIsBase =
      !parallelOptions.length || parallelOptions.every((value) => isGenericBase(value));
    if (expectedIsBase) return true;
    return parallelOptions.some((value) => {
      const tokens = catalogTokens(value).filter(
        (token) => !["parallel", "prizm", "refractor", "holo", "the"].includes(token),
      );
      return tokens.length > 0 && tokens.every((token) => evidenceTokens.has(token));
    });
  });

  if (!match) return null;
  return {
    catalogId: `tcos-official-${match.id}`,
    sourceUrl: match.catalogSourceUrl,
    player: match.expected.player,
    year: match.expected.year,
    brand: match.expected.brand,
    setName: match.expected.setName,
    cardNumber: match.expected.cardNumber,
    parallel: match.expected.parallel || "Base",
    variation: match.expected.parallel || "Base",
    serialRun: match.expected.serialDenominator
      ? `/${match.expected.serialDenominator}`
      : null,
    team: match.expected.team,
    sport: match.expected.sport,
    isAuto: match.expected.isAuto,
    isRelic: match.expected.isRelic,
  };
}'''
    text = regex_once(
        text,
        r'''function officialBenchmarkCatalogCandidate\(\n  input: InstaCompCatalogIdentityInput,\n\): InstaCompCatalogCandidateIdentity \| null \{.*?\n\}''',
        replacement,
        "official benchmark catalog resolver",
    )

    old = '''  const officialCandidate = officialBenchmarkCatalogCandidate(input);
  const candidates = officialCandidate
    ? [officialCandidate]
    : TCOS_CURATED_CHECKLIST_CANDIDATES.filter((candidate) =>
        candidateIsPlausible(input, candidate),
      );
'''
    new = '''  const officialCandidate = officialBenchmarkCatalogCandidate(input);
  if (officialBenchmarkCatalogFamily(input) && !officialCandidate) return null;
  const candidates = officialCandidate
    ? [officialCandidate]
    : TCOS_CURATED_CHECKLIST_CANDIDATES.filter((candidate) =>
        !candidate.catalogId.startsWith("tcos-official-") &&
        candidateIsPlausible(input, candidate),
      );
'''
    text = replace_once(text, old, new, "official catalog family fail-closed gate")
    path.write_text(text)


def patch_benchmark_source() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()

    replacement = r'''const BENCHMARK_VARIATION_CUES = new Set([
  "red", "blue", "green", "gold", "silver", "purple", "orange", "pink",
  "black", "white", "yellow", "teal", "aqua", "bronze", "copper", "clear",
  "cut", "acetate", "outburst", "deluxe", "exclusives", "speckle", "sparkle",
  "shimmer", "wave", "mojo", "pulsar", "scope", "laser", "cracked", "ice",
  "disco", "reactive", "xfractor", "atomic", "sepia", "negative", "tie", "dye",
  "zebra", "camo", "genesis", "fluorescent", "refractor", "prizm", "holo",
  "foil", "limited", "superfractor", "sapphire", "diamond", "checkerboard",
  "velocity", "neon", "hyper", "flash", "fractal", "galactic", "cosmic",
  "rainbow", "canvas",
]);

function benchmarkSeasonStart(value: unknown) {
  return normalized(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

function benchmarkTitleTokens(value: unknown) {
  return normalized(value).replace(/[/-]+/g, " ").split(/\s+/).filter(Boolean);
}

export function benchmarkTitleHasExpectedYear(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  return Boolean(benchmarkSeasonStart(testCase.expected.year)) &&
    benchmarkSeasonStart(title) === benchmarkSeasonStart(testCase.expected.year);
}

export function benchmarkTitleHasExpectedParallel(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const expectedParallel = normalized(testCase.expected.parallel);
  const referenceTokens = new Set(
    benchmarkTitleTokens(
      [
        testCase.expected.player,
        testCase.expected.team,
        testCase.expected.brand,
        testCase.expected.setName,
        ...(testCase.expected.setAliases || []),
        testCase.expected.parallel,
        ...(testCase.expected.parallelAliases || []),
      ].filter(Boolean).join(" "),
    ),
  );
  const titleTokens = benchmarkTitleTokens(title);
  if (
    titleTokens.some(
      (token) => BENCHMARK_VARIATION_CUES.has(token) && !referenceTokens.has(token),
    )
  ) {
    return false;
  }
  if (!expectedParallel || expectedParallel === "base") return true;
  return [testCase.expected.parallel, ...(testCase.expected.parallelAliases || [])]
    .map(normalized)
    .filter(Boolean)
    .some((parallel) =>
      parallel.split(" ").filter(Boolean).every((token) => normalized(title).includes(token)),
    );
}

function titleSerialDenominators(title: string) {
  const withoutSeason = title.replace(/\b(?:19|20)\d{2}\s*[-/]\s*\d{2,4}\b/g, " ");
  return Array.from(withoutSeason.matchAll(/(?:\b\d{1,6}\s*)?\/\s*(\d{1,6})\b/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export function benchmarkTitleHasExpectedSerialRun(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const denominators = titleSerialDenominators(title);
  const expected = testCase.expected.serialDenominator;
  if (!expected) return denominators.length === 0;
  return denominators.length > 0 && denominators.every((denominator) => denominator === expected);
}

export function benchmarkTitleEligible(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  return (
    !rejectedTitle(title) &&
    benchmarkTitleHasExpectedYear(title, testCase) &&
    titleHasExactCardNumber(title, testCase.expected.cardNumber) &&
    benchmarkTitleHasExpectedParallel(title, testCase) &&
    benchmarkTitleHasExpectedSerialRun(title, testCase)
  );
}'''
    text = regex_once(
        text,
        r'''function titleConflictsWithExpectedParallel\(.*?function titleHasExpectedSerialRun\(.*?\n\}''',
        replacement,
        "benchmark exact source helpers",
    )
    text = text.replace(
        "const yearPass = text.includes(normalized(expected.year));",
        "const yearPass = benchmarkTitleHasExpectedYear(title, { expected } as InstaCompEbayBenchmarkCase);",
    )
    text = regex_once(
        text,
        r'''\.filter\(\n      \(\{ item, title, score \}\) =>\n        item\.itemId &&\n        title &&\n        !rejectedTitle\(title\) &&.*?score >= 65,\n    \)''',
        '''.filter(
      ({ item, title, score }) =>
        item.itemId &&
        title &&
        benchmarkTitleEligible(title, testCase) &&
        score >= 65,
    )''',
        "benchmark candidate exact filter",
    )
    path.write_text(text)


def patch_scan_image_pipeline() -> None:
    path = Path("src/app/api/instacomp/scan/route.ts")
    text = path.read_text()
    import_marker = '''import { detectGradingDetails } from "../../../../lib/grading-cert";
'''
    import_replacement = '''import { detectGradingDetails } from "../../../../lib/grading-cert";
import { normalizeInstaCompSideImages } from "../../../../lib/instacomp-image-orientation";
import { readValidatedInstaCompImage } from "../../../../lib/instacomp-image-safety";
'''
    text = replace_once(text, import_marker, import_replacement, "scan image safety imports")
    text = regex_once(
        text,
        r'''async function fileToDataUrl\(file: File\) \{.*?\n\}''',
        '''async function fileToDataUrl(file: File, label = "Image") {
  return (await readValidatedInstaCompImage(file, label)).dataUrl;
}''',
        "validated file data URL",
    )
    text = replace_once(
        text,
        '''  let operatorSerialNumberOverride: string | null | undefined = undefined;
''',
        '''  let operatorSerialNumberOverride: string | null | undefined = undefined;
  let imageOrientation: Awaited<ReturnType<typeof normalizeInstaCompSideImages>>["orientation"] | null = null;
''',
        "scan orientation state",
    )
    insertion_marker = '''    const detailImageJobs = detailImageFiles.map(async (detailImage) => {
'''
    insertion = '''    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage,
      backImage: backImageForScan,
    });
    frontImage = normalizedSides.frontFile;
    backImageForScan = normalizedSides.backFile;
    imageOrientation = normalizedSides.orientation;

'''
    if insertion not in text:
        if insertion_marker not in text:
            raise SystemExit("Could not locate scan orientation insertion marker")
        text = text.replace(insertion_marker, insertion + insertion_marker, 1)
    text = text.replace(
        'dataUrl: await fileToDataUrl(detailImage),',
        'dataUrl: await fileToDataUrl(detailImage, `Detail image ${detailImage.name || "crop"}`),',
    )
    old = '''    const [frontDataUrl, backDataUrl, detailImages] = await Promise.all([
      fileToDataUrl(frontImage),
      backImageForScan ? fileToDataUrl(backImageForScan) : Promise.resolve(undefined),
      Promise.all(detailImageJobs),
    ]);
'''
    new = '''    const [detailImages] = await Promise.all([Promise.all(detailImageJobs)]);
    const frontDataUrl = normalizedSides.frontDataUrl;
    const backDataUrl = normalizedSides.backDataUrl;
'''
    text = replace_once(text, old, new, "normalized scan side data URLs")
    text = replace_once(
        text,
        '''  catalogEvidence?: unknown;
}) {
''',
        '''  catalogEvidence?: unknown;
  imageOrientation?: unknown;
}) {
''',
        "scan persistence orientation signature",
    )
    text = replace_once(
        text,
        '''        catalogEvidence: input.catalogEvidence || null,
''',
        '''        catalogEvidence: input.catalogEvidence || null,
        imageOrientation: input.imageOrientation || null,
''',
        "scan persistence orientation data",
    )
    text = replace_once(
        text,
        '''      catalogEvidence,
    });
''',
        '''      catalogEvidence,
      imageOrientation,
    });
''',
        "scan persistence orientation call",
    )
    text = replace_once(
        text,
        '''      catalogEvidence,
      ocrDiagnostics: {
''',
        '''      catalogEvidence,
      imageOrientation,
      ocrDiagnostics: {
        imageOrientation,
''',
        "scan response orientation diagnostics",
    )
    path.write_text(text)


def patch_batch_ui() -> None:
    path = Path("src/app/instacomp-test/InstaCompBatchLiveScanner.tsx")
    text = path.read_text()
    text = replace_once(
        text,
        '''  pipelineDiagnostics?: PipelineDiagnostics;
};
''',
        '''  pipelineDiagnostics?: PipelineDiagnostics;
  imageOrientation?: {
    status: string;
    model: string | null;
    frontRotation: 0 | 90 | 180 | 270;
    backRotation: 0 | 90 | 180 | 270;
    frontConfidence: number;
    backConfidence: number;
    reason: string;
  } | null;
};
''',
        "batch orientation response type",
    )
    text = text.replace(
        '<img src={card.frontPreview} alt={`Card ${index + 1} front`} style={queuePreviewStyle} />',
        '<img src={card.frontPreview} alt={`Card ${index + 1} front`} style={{ ...queuePreviewStyle, transform: `rotate(${card.result?.imageOrientation?.frontRotation || 0}deg)` }} />',
    )
    text = text.replace(
        '<img src={card.backPreview} alt={`Card ${index + 1} back`} style={queuePreviewStyle} />',
        '<img src={card.backPreview} alt={`Card ${index + 1} back`} style={{ ...queuePreviewStyle, transform: `rotate(${card.result?.imageOrientation?.backRotation || 0}deg)` }} />',
    )
    status_marker = '''              <StatusBox
                label="Identity"
'''
    status = '''              <StatusBox
                label="Orientation"
                status={result.imageOrientation?.status || "review"}
                detail={`Front ${result.imageOrientation?.frontRotation || 0}°; back ${result.imageOrientation?.backRotation || 0}°`}
              />
'''
    if status not in text:
        if status_marker not in text:
            raise SystemExit("Could not locate batch orientation status marker")
        text = text.replace(status_marker, status + status_marker, 1)
    path.write_text(text)


def main() -> None:
    patch_exact_matcher()
    patch_market_pricing()
    patch_seller_route()
    patch_catalog()
    patch_benchmark_source()
    patch_scan_image_pipeline()
    patch_batch_ui()


if __name__ == "__main__":
    main()
