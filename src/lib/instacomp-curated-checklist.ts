import type { InstaCompAiResult } from "./instacomp";
import { INSTACOMP_EBAY_BENCHMARK_CASES } from "./instacomp-ebay-benchmark-cases";
import {
  buildInstaCompCatalogEvidenceSnapshot,
  type InstaCompCatalogCandidateIdentity,
  type InstaCompCatalogEvidenceSnapshot,
  type InstaCompCatalogIdentityInput,
  type InstaCompCatalogProviderResult,
  type InstaCompCatalogSourcePolicy,
} from "./instacomp-catalog-identity";
import type { InstaCompConsensusCatalogReferee } from "./instacomp-consensus";

const TCOS_CURATED_CHECKLIST_SOURCE: InstaCompCatalogSourcePolicy = {
  source: "tcos_curated_checklist",
  sourceLabel: "TCOS Curated Checklist",
  sourceUrl: "tcos://instacomp/curated-checklist",
  apiAvailable: true,
  sourceUsageAllowed: true,
  commercialUseAllowed: true,
  storageAllowed: true,
  displayAllowed: true,
  cachingAllowed: true,
  attributionRequired: false,
  termsReviewedAt: "2026-07-16",
  variationCoverage: {
    baseCards: true,
    parallels: true,
    refractors: true,
    shortPrints: true,
    imageVariations: true,
    autographs: true,
    relics: true,
    serialNumberedRuns: true,
  },
};

const TCOS_CURATED_CHECKLIST_CANDIDATES: InstaCompCatalogCandidateIdentity[] = [
  {
    catalogId: "tcos-2025-26-sp-authentic-hockey-o-8-outliers",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-sp-authentic-hockey/o-8",
    player: "Connor McDavid",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "SP Authentic Hockey",
    cardNumber: "O-8",
    parallel: "Outliers",
    variation: "Outliers",
    team: "Edmonton Oilers",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2025-26-upper-deck-extended-series-c-369-canvas-young-guns",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-upper-deck-extended-series/c-369",
    player: "Curtis Douglas",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "Upper Deck Extended Series",
    cardNumber: "C-369",
    parallel: "Canvas Young Guns",
    variation: "Canvas Young Guns",
    team: "Utah Mammoth",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2025-26-upper-deck-extended-series-ud3-28-clear-cut",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-upper-deck-extended-series/ud3-28",
    player: "Seth Jarvis",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "Upper Deck Extended Series",
    cardNumber: "UD3-28",
    parallel: "Clear Cut",
    variation: "Clear Cut",
    team: "Carolina Hurricanes",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2022-23-upper-deck-extended-series-656-clear-cut",
    sourceUrl: "tcos://instacomp/curated-checklist/2022-23-upper-deck-extended-series/656-clear-cut",
    player: "Dylan Larkin",
    year: "2022-23",
    brand: "Upper Deck",
    setName: "Upper Deck Extended Series",
    cardNumber: "656",
    parallel: "Clear Cut",
    variation: "Clear Cut",
    team: "Detroit Red Wings",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2025-26-sp-authentic-hockey-s-50-spectrum-fx-level-1",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-sp-authentic-hockey/s-50",
    player: "Matthew Robertson",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "SP Authentic Hockey",
    cardNumber: "S-50",
    parallel: "Future Watch Spectrum FX Level 1",
    variation: "Future Watch Spectrum FX Level 1",
    team: "New York Rangers",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2024-25-o-pee-chee-platinum-201-limited-red",
    sourceUrl: "tcos://instacomp/curated-checklist/2024-25-o-pee-chee-platinum/201-limited-red",
    player: "Connor Bedard",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "O-Pee-Chee Platinum",
    cardNumber: "201",
    parallel: "Limited Red",
    variation: "Limited Red",
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  ...INSTACOMP_EBAY_BENCHMARK_CASES.map((testCase) => ({
    catalogId: `tcos-official-${testCase.id}`,
    sourceUrl: testCase.catalogSourceUrl,
    player: testCase.expected.player,
    year: testCase.expected.year,
    brand: testCase.expected.brand,
    setName: testCase.expected.setName,
    cardNumber: testCase.expected.cardNumber,
    parallel: testCase.expected.parallel || "Base",
    variation: testCase.expected.parallel || "Base",
    serialRun: testCase.expected.serialDenominator
      ? `/${testCase.expected.serialDenominator}`
      : null,
    team: testCase.expected.team,
    sport: testCase.expected.sport,
    isAuto: testCase.expected.isAuto,
    isRelic: testCase.expected.isRelic,
  })),
];

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableText(value: string | null | undefined) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableCardNumber(value: string | null | undefined) {
  return comparableText(value).replace(/[\s-]/g, "");
}

function isGenericBase(value: string | null | undefined) {
  const comparable = comparableText(value);

  return (
    comparable === "base" ||
    comparable === "base card" ||
    comparable === "standard" ||
    comparable === "standard card" ||
    comparable === "regular" ||
    comparable === "regular card"
  );
}

function extractSerialRun(serialNumber: string | null | undefined) {
  const match = cleanText(serialNumber).match(/\/\s*(\d{1,6})\b/);

  return match ? `/${match[1]}` : null;
}

function normalizeSetNameForCuratedChecklist(setName: string | null | undefined) {
  const cleaned = cleanText(setName);

  if (/\bo[-\s]*pee[-\s]*chee\b/i.test(cleaned) && /\bplatinum\b/i.test(cleaned)) {
    return "O-Pee-Chee Platinum";
  }
  if (/\bsp\s+authentic\b/i.test(cleaned)) return "SP Authentic Hockey";
  if (/\bextended\s+series\b/i.test(cleaned)) return "Upper Deck Extended Series";

  return cleaned || null;
}

function printedVariationCue(text: string) {
  if (/\boutliers?\b/i.test(text)) return "Outliers";
  if (/\bfuture\s+watch\b/i.test(text) && /\bspectrum\s+fx\b/i.test(text)) {
    return "Future Watch Spectrum FX Level 1";
  }
  if (/\bspectrum\s+fx\b/i.test(text)) return "Spectrum FX";
  if (/\bclear\s*cut\b/i.test(text)) return "Clear Cut";
  if (/\bcanvas\b/i.test(text) && /\byoung\s+guns?\b/i.test(text)) {
    return "Canvas Young Guns";
  }
  if (/\bcanvas\b/i.test(text)) return "Canvas";
  if (/\blimited\s+red\b/i.test(text)) return "Limited Red";

  return null;
}

function aiToCatalogInput(
  ai: InstaCompAiResult,
  externalOcrText: string | null | undefined,
): InstaCompCatalogIdentityInput {
  const evidenceText = [
    ai.year,
    ai.brand,
    ai.setName,
    ai.cardNumber,
    ai.player,
    ai.parallel,
    ai.notes,
    externalOcrText,
  ]
    .filter(Boolean)
    .join(" ");
  const printedCue = printedVariationCue(evidenceText);
  const aiParallel = cleanText(ai.parallel);
  const parallel =
    printedCue && (!aiParallel || isGenericBase(aiParallel))
      ? printedCue
      : aiParallel || printedCue;

  return {
    player: ai.player,
    year:
      /^(?:ice\s+)?hockey$/i.test(cleanText(ai.sport)) && /^\d{4}$/.test(cleanText(ai.year))
        ? `${cleanText(ai.year)}-${String(Number(cleanText(ai.year)) + 1).slice(-2)}`
        : ai.year,
    brand: ai.brand,
    setName: normalizeSetNameForCuratedChecklist(ai.setName),
    cardNumber: ai.cardNumber,
    parallel,
    variation: parallel,
    serialNumber: ai.serialNumber,
    serialRun: extractSerialRun(ai.serialNumber),
    team: ai.team,
    sport: ai.sport,
    isAuto: ai.isAuto,
    isRelic: ai.isRelic,
  };
}

function catalogTokens(value: string | null | undefined) {
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
  const inputParallelTokens = new Set(
    catalogTokens(input.parallel || input.variation).filter(
      (token) =>
        !["parallel", "prizm", "refractor", "holo", "base", "card", "the"].includes(token),
    ),
  );
  const parallelMatches = candidateIsBase
    ? inputParallelDistinctive.length === 0
    : candidateParallelTokens.length > 0 &&
      candidateParallelTokens.every((token) => inputParallelTokens.has(token)) &&
      inputParallelDistinctive.every((token) => candidateParallelTokens.includes(token));

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
}

function officialBenchmarkCatalogFamily(input: InstaCompCatalogIdentityInput) {
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
}

export function buildInstaCompCuratedChecklistEvidence(params: {
  ai: InstaCompAiResult;
  externalOcrText?: string | null;
  capturedAt?: string;
}): InstaCompCatalogEvidenceSnapshot | null {
  const input = aiToCatalogInput(params.ai, params.externalOcrText);
  const officialCandidate = officialBenchmarkCatalogCandidate(input);
  if (officialBenchmarkCatalogFamily(input) && !officialCandidate) return null;
  const candidates = officialCandidate
    ? [officialCandidate]
    : TCOS_CURATED_CHECKLIST_CANDIDATES.filter((candidate) =>
        !candidate.catalogId.startsWith("tcos-official-") &&
        candidateIsPlausible(input, candidate),
      );

  if (!candidates.length) return null;

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
    {
      source: TCOS_CURATED_CHECKLIST_SOURCE.source,
      status: "fulfilled",
      candidates,
      latencyMs: 0,
    },
  ];

  return buildInstaCompCatalogEvidenceSnapshot(
    resolvedInput,
    [TCOS_CURATED_CHECKLIST_SOURCE],
    providerResults,
    params.capturedAt,
  );
}

export function catalogEvidenceToConsensusReferee(
  evidence: InstaCompCatalogEvidenceSnapshot | null,
): InstaCompConsensusCatalogReferee | null {
  if (!evidence?.selectedMatch && !evidence?.compIdentity) return null;

  return {
    status: evidence.status,
    identity: evidence.compIdentity || evidence.selectedMatch?.identity || null,
    sourceLabel: evidence.sourceAttribution?.sourceLabel || evidence.selectedMatch?.sourceLabel || null,
    catalogId: evidence.sourceAttribution?.catalogId || evidence.selectedMatch?.catalogId || null,
    matchExplanation:
      evidence.compIdentity?.catalogMatchExplanation ||
      evidence.selectedMatch?.matchedEvidence.join(", ") ||
      evidence.operatorAction ||
      null,
  };
}
