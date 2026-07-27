import type { InstaCompEbayBenchmarkCase } from "./instacomp-ebay-benchmark-cases";

const BENCHMARK_VARIATION_CUES = new Set([
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
  "clear",
  "cut",
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
  "cracked",
  "ice",
  "disco",
  "reactive",
  "xfractor",
  "atomic",
  "sepia",
  "negative",
  "tie",
  "dye",
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
  "diamond",
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
]);

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCardNumber(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function titleHasExactCardNumber(title: string, cardNumber: string) {
  const expected = compactCardNumber(cardNumber);
  if (!expected) return false;

  const escaped = normalized(cardNumber).replace(/\s+/g, "[-\\s]?");
  const explicit = new RegExp(
    `(?:#|card(?:\\s*(?:no\\.?|number))?)\\s*${escaped}(?![a-z0-9])`,
    "i",
  );
  if (explicit.test(title)) return true;

  const tokens = clean(title).match(/[a-z0-9]+(?:-[a-z0-9]+)*/gi) || [];
  const disallowedPrevious = new Set([
    "series",
    "season",
    "year",
    "lot",
    "qty",
    "quantity",
    "box",
    "case",
    "of",
  ]);
  return tokens.some((token, index) => {
    if (compactCardNumber(token) !== expected) return false;
    const previous = normalized(tokens[index - 1]);
    if (disallowedPrevious.has(previous)) return false;
    const occurrence = title.toLowerCase().indexOf(token.toLowerCase());
    if (occurrence > 0 && title[occurrence - 1] === "/") return false;
    return true;
  });
}

function rejectedTitle(title: string) {
  return /\b(?:lot|team set|complete set|reprint|custom|digital|nft|break|you pick|choose your card|psa|bgs|sgc|cgc|graded|gem mint|oversized|oversize|jumbo|mini|box topper|5x7|8x10|promo)\b/i.test(
    title,
  );
}

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
  return (
    Boolean(benchmarkSeasonStart(testCase.expected.year)) &&
    benchmarkSeasonStart(title) === benchmarkSeasonStart(testCase.expected.year)
  );
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
      ]
        .filter(Boolean)
        .join(" "),
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
      parallel
        .split(" ")
        .filter(Boolean)
        .every((token) => normalized(title).includes(token)),
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

function benchmarkTitleHasExpectedPlayer(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const text = normalized(title);
  return [testCase.expected.player, ...(testCase.expected.playerAliases || [])]
    .map(normalized)
    .filter(Boolean)
    .some((player) => text.includes(player));
}

function benchmarkTitleHasExpectedBrand(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const brand = normalized(testCase.expected.brand);
  return Boolean(brand) && normalized(title).includes(brand);
}

function benchmarkTitleHasExpectedSet(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const titleTokens = new Set(benchmarkTitleTokens(title));
  const ignored = new Set([
    "upper",
    "deck",
    "series",
    "hockey",
    "base",
    "card",
    "cards",
    "trading",
    "the",
    "set",
    "parallel",
    "2022",
    "2023",
    "2024",
    "2025",
    "2026",
  ]);
  return [testCase.expected.setName, ...(testCase.expected.setAliases || [])]
    .map((value) => benchmarkTitleTokens(value).filter((token) => !ignored.has(token)))
    .filter((tokens) => tokens.length > 0)
    .some((tokens) => tokens.every((token) => titleTokens.has(token)));
}

export function benchmarkTitleEligible(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  return (
    !rejectedTitle(title) &&
    benchmarkTitleHasExpectedPlayer(title, testCase) &&
    benchmarkTitleHasExpectedYear(title, testCase) &&
    benchmarkTitleHasExpectedBrand(title, testCase) &&
    benchmarkTitleHasExpectedSet(title, testCase) &&
    titleHasExactCardNumber(title, testCase.expected.cardNumber) &&
    benchmarkTitleHasExpectedParallel(title, testCase) &&
    benchmarkTitleHasExpectedSerialRun(title, testCase)
  );
}
