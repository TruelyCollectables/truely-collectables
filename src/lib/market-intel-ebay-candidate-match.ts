export type MarketIntelEbayCandidateIdentity = {
  subject_name: string;
  season_year: string | null;
  manufacturer: string | null;
  product_line: string | null;
  set_name: string | null;
  insert_name: string | null;
  card_number: string | null;
  parallel_name: string;
  variation_name: string | null;
  condition_type: string;
  grading_company: string | null;
  grade: string | null;
  autograph: boolean;
  memorabilia: boolean;
  serial_numbered_to?: number | null;
};

export type MarketIntelEbayCandidateItem = {
  title?: string;
  shortDescription?: string;
  condition?: string;
};

export type MarketIntelEbayIdentityMatch = {
  baseScore: number;
  score: number;
  reasons: string[];
  conflicts: string[];
  hardConflict: boolean;
  lotListing: boolean;
};

const PARALLEL_MARKERS = [
  "red rainbow",
  "black rainbow",
  "silver outburst",
  "gold outburst",
  "outburst",
  "shimmer",
  "speckle",
  "sapphire",
  "mega box mojo",
  "mojo",
  "true blue",
  "blue refractor",
  "green refractor",
  "gold refractor",
  "orange refractor",
  "purple refractor",
  "pink refractor",
  "aqua refractor",
  "wave refractor",
  "raywave",
  "ray wave",
  "atomic refractor",
  "mini diamond",
  "x fractor",
  "x-fractor",
  "prism refractor",
  "sepia refractor",
  "negative refractor",
  "lava refractor",
  "superfractor",
  "clear cut",
  "high gloss",
  "exclusive",
  "deluxe",
  "french variation",
  "canvas",
] as const;

const PRODUCT_MARKERS = [
  "allure",
  "artifacts",
  "sp authentic",
  "sp game used",
  "o pee chee platinum",
  "opc platinum",
  "national hockey card day",
  "bowman chrome sapphire",
] as const;

export function normalizeMarketIntelCandidateText(
  value: string | null | undefined,
) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return normalizeMarketIntelCandidateText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function hasAllTokens(title: string, value: string | null | undefined) {
  const expected = tokens(value);
  return expected.length > 0 && expected.every((token) => title.includes(token));
}

function includesCardNumber(text: string, cardNumber: string | null | undefined) {
  const normalizedCardNumber = normalizeMarketIntelCandidateText(cardNumber);
  if (!normalizedCardNumber) return false;
  const pattern = new RegExp(
    `(^|[^a-z0-9])${normalizedCardNumber.replace(/\s+/g, "[\\s-]*")}([^a-z0-9]|$)`,
    "i",
  );
  return pattern.test(text);
}

function explicitCardNumbers(rawTitle: string) {
  const values: string[] = [];
  for (const match of rawTitle.matchAll(/#\s*([a-z0-9]+(?:-[a-z0-9]+)*)/gi)) {
    const value = normalizeMarketIntelCandidateText(match[1]);
    if (value) values.push(value);
  }
  for (const match of rawTitle.matchAll(/\b([a-z]{1,8}-\d{1,4})\b/gi)) {
    const value = normalizeMarketIntelCandidateText(match[1]);
    if (value) values.push(value);
  }
  return Array.from(new Set(values));
}

function serialDenominators(rawTitle: string) {
  const values: number[] = [];
  for (const match of rawTitle.matchAll(/(?:^|[\s#])(?:\d{1,4}\s*)?\/\s*(\d{1,4})(?=$|[\s,.)-])/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) values.push(value);
  }
  return Array.from(new Set(values));
}

function detectedParallelMarkers(titleText: string) {
  return PARALLEL_MARKERS.filter((marker) =>
    titleText.includes(normalizeMarketIntelCandidateText(marker)),
  );
}

function targetAllowsParallelMarker(targetParallel: string, marker: string) {
  const target = normalizeMarketIntelCandidateText(targetParallel);
  const found = normalizeMarketIntelCandidateText(marker);
  if (!target || target === "base") return false;
  if (target === found) return true;
  if (target === "refractor") return found === "refractor";
  return target.includes(found) || found.includes(target);
}

function productConflicts(
  identity: MarketIntelEbayCandidateIdentity,
  titleText: string,
) {
  const expected = normalizeMarketIntelCandidateText(
    [identity.product_line, identity.set_name].filter(Boolean).join(" "),
  );
  return PRODUCT_MARKERS.filter((marker) => {
    const normalizedMarker = normalizeMarketIntelCandidateText(marker);
    return titleText.includes(normalizedMarker) && !expected.includes(normalizedMarker);
  });
}

function looksGraded(item: MarketIntelEbayCandidateItem, rawTitle: string) {
  if (normalizeMarketIntelCandidateText(item.condition) === "graded") return true;
  return /\b(psa|bgs|beckett|sgc|cgc|hga)\s*(?:authentic|gem\s*mint|mint|[1-9](?:\.5)?|10)\b/i.test(
    rawTitle,
  );
}

function looksAutographed(rawTitle: string) {
  return /\b(auto|autograph|autographed|signed)\b/i.test(rawTitle);
}

function looksMemorabilia(rawTitle: string) {
  return /\b(relic|patch|jersey|game[- ]used|game[- ]worn|player[- ]worn|swatch)\b/i.test(
    rawTitle,
  );
}

function looksLikeLot(rawTitle: string) {
  return /(?:^|[\s(])(?:lot(?:\s+of)?|pair|[2-9]x|two\s+cards?|three\s+cards?|four\s+cards?|[2-9]\s+cards?)(?:$|[\s):,/-])/i.test(
    rawTitle,
  );
}

export function evaluateMarketIntelEbayIdentityMatch(
  identity: MarketIntelEbayCandidateIdentity,
  item: MarketIntelEbayCandidateItem,
): MarketIntelEbayIdentityMatch {
  const rawTitle = String(item.title || "").trim();
  const rawText = `${rawTitle} ${item.shortDescription || ""}`.trim();
  const titleText = normalizeMarketIntelCandidateText(rawTitle);
  const text = normalizeMarketIntelCandidateText(rawText);
  const reasons: string[] = [];
  const conflicts: string[] = [];
  let score = 0;

  if (hasAllTokens(text, identity.subject_name)) {
    score += 34;
    reasons.push("player/subject tokens match");
  }
  if (
    identity.season_year &&
    text.includes(normalizeMarketIntelCandidateText(identity.season_year))
  ) {
    score += 12;
    reasons.push("year matches");
  }
  if (identity.card_number && includesCardNumber(text, identity.card_number)) {
    score += 22;
    reasons.push("card number matches");
  }
  if (identity.product_line && hasAllTokens(text, identity.product_line)) {
    score += 8;
    reasons.push("product line matches");
  }
  if (identity.set_name && hasAllTokens(text, identity.set_name)) {
    score += 8;
    reasons.push("set matches");
  }
  if (
    normalizeMarketIntelCandidateText(identity.parallel_name) !== "base" &&
    hasAllTokens(text, identity.parallel_name)
  ) {
    score += 10;
    reasons.push("parallel matches");
  }
  if (identity.autograph && looksAutographed(rawTitle)) {
    score += 6;
    reasons.push("autograph marker matches");
  }
  if (identity.memorabilia && looksMemorabilia(rawTitle)) {
    score += 6;
    reasons.push("memorabilia marker matches");
  }

  const targetCardNumber = normalizeMarketIntelCandidateText(identity.card_number);
  const listedCardNumbers = explicitCardNumbers(rawTitle);
  const conflictingCardNumbers = targetCardNumber
    ? listedCardNumbers.filter((value) => value !== targetCardNumber)
    : [];
  if (conflictingCardNumbers.length > 0) {
    conflicts.push(
      `explicit card number conflicts (${conflictingCardNumbers.map((value) => `#${value}`).join(", ")})`,
    );
  }

  const targetParallel = normalizeMarketIntelCandidateText(identity.parallel_name);
  const foundParallelMarkers = detectedParallelMarkers(titleText);
  const conflictingParallelMarkers = foundParallelMarkers.filter(
    (marker) => !targetAllowsParallelMarker(targetParallel, marker),
  );
  if (conflictingParallelMarkers.length) {
    conflicts.push(`parallel conflicts (${conflictingParallelMarkers.join(", ")})`);
  }

  const denominators = serialDenominators(rawTitle);
  const expectedSerial = Number(identity.serial_numbered_to || 0);
  if (denominators.length) {
    if (!expectedSerial) {
      conflicts.push(`serial-numbered listing conflicts (/${denominators.join(", /")})`);
    } else if (denominators.some((value) => value !== expectedSerial)) {
      conflicts.push(
        `serial print run conflicts (expected /${expectedSerial}; found /${denominators.join(", /")})`,
      );
    }
  }

  if (identity.condition_type === "raw" && looksGraded(item, rawTitle)) {
    conflicts.push("graded listing conflicts with raw identity");
  }
  if (!identity.autograph && looksAutographed(rawTitle)) {
    conflicts.push("autograph/signed listing conflicts with non-autograph identity");
  }
  if (!identity.memorabilia && looksMemorabilia(rawTitle)) {
    conflicts.push("relic/memorabilia listing conflicts with non-memorabilia identity");
  }

  for (const marker of productConflicts(identity, titleText)) {
    conflicts.push(`product line conflicts (${marker})`);
  }

  const lotListing = looksLikeLot(rawTitle);
  if (lotListing) {
    conflicts.push("multi-card lot requires the lot-composition workflow");
  }

  const uniqueConflicts = Array.from(new Set(conflicts));
  const adjustedScore = Math.max(0, Math.min(100, score - uniqueConflicts.length * 35));

  return {
    baseScore: Math.min(100, score),
    score: adjustedScore,
    reasons,
    conflicts: uniqueConflicts,
    hardConflict: uniqueConflicts.length > 0,
    lotListing,
  };
}
