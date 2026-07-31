type UnknownRecord = Record<string, unknown>;

export type DualMarketplaceCardIdentity = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  gradingCompany: string | null;
  gradeValue: string | null;
  certificationNumber: string | null;
  team: string | null;
  sport: string | null;
  conditionGuess: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
};

export type DualMarketplaceListingDraft = {
  websiteTitle: string;
  websiteDescription: string;
  ebayTitle: string;
  ebayDescription: string;
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber: string;
  aspects: Record<string, string[]>;
  identity: DualMarketplaceCardIdentity;
};

export type DualMarketplaceListingInput = {
  title: string;
  description?: string | null;
  category?: string | null;
  condition?: string | null;
  metadata?: UnknownRecord | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, maximum = 240) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function booleanValue(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

function titleToken(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function uniqueTokens(values: Array<string | null | undefined>) {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const token = titleToken(value);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(token);
  }

  return output;
}

export function compactEbayTitle(value: string, maximum = 80) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maximum) return cleaned;

  const words = cleaned.split(" ");
  let output = "";

  for (const word of words) {
    const candidate = output ? `${output} ${word}` : word;
    if (candidate.length > maximum) break;
    output = candidate;
  }

  return output || cleaned.slice(0, maximum).trim();
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function line(label: string, value: string | null) {
  return value ? `${label}: ${value}` : null;
}

export function conservativeCardCondition(conditionGuess: string | null) {
  const normalized = String(conditionGuess || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized || /\b(?:unknown|review|uncertain|not graded|ungraded)\b/.test(normalized)) {
    return "";
  }
  if (/\b(?:not|below|less than) near mint\b/.test(normalized)) return "";
  if (/\bnear mint\b/.test(normalized) || normalized === "mint") {
    return "Near Mint or Better";
  }
  if (/\b(?:lightly played|excellent)\b/.test(normalized)) return "Excellent";
  if (/\b(?:moderately played|very good)\b/.test(normalized)) return "Very Good";
  if (/\b(?:heavily played|poor|damaged)\b/.test(normalized)) return "Poor";

  return "";
}

export function cardConditionForCategory(
  categoryId: string,
  conditionGuess: string | null,
) {
  const base = conservativeCardCondition(conditionGuess);
  if (categoryId !== "183454") return base;

  if (base === "Excellent") return "Lightly Played (Excellent)";
  if (base === "Very Good") return "Moderately Played (Very Good)";
  if (base === "Poor") return "Heavily Played (Poor)";
  return base;
}

function ebayCategoryId(identity: DualMarketplaceCardIdentity, category: string | null) {
  const combined = `${identity.sport || ""} ${category || ""}`.toLowerCase();

  if (
    ["pokemon", "pokémon", "magic", "mtg", "yugioh", "yu-gi-oh", "lorcana", "ccg", "tcg"].some(
      (term) => combined.includes(term),
    )
  ) {
    return "183454";
  }

  if (
    ["non-sport", "entertainment", "celebrity", "movie", "television"].some(
      (term) => combined.includes(term),
    )
  ) {
    return "183050";
  }

  return "261328";
}

export function cardIdentityFromMetadata(
  metadata: UnknownRecord | null | undefined,
): DualMarketplaceCardIdentity {
  const root = record(metadata);
  const instacomp = record(root.instacomp);
  const ai = record(instacomp.ai);

  return {
    player: text(ai.player),
    year: text(ai.year, 20),
    brand: text(ai.brand),
    setName: text(ai.setName),
    cardNumber: text(ai.cardNumber, 80),
    parallel: text(ai.parallel),
    serialNumber: text(ai.serialNumber, 80),
    gradingCompany: text(ai.gradingCompany, 120),
    gradeValue: text(ai.gradeValue, 40),
    certificationNumber: text(ai.certificationNumber, 40),
    team: text(ai.team),
    sport: text(ai.sport, 100),
    conditionGuess: text(ai.conditionGuess, 120),
    isRookie: booleanValue(ai.isRookie),
    isAuto: booleanValue(ai.isAuto),
    isRelic: booleanValue(ai.isRelic),
  };
}

function generatedTitle(identity: DualMarketplaceCardIdentity, fallback: string) {
  const features = [
    identity.isRookie ? "RC" : null,
    identity.isAuto ? "Auto" : null,
    identity.isRelic ? "Relic" : null,
  ];
  const grade =
    identity.gradingCompany && identity.gradeValue
      ? `${identity.gradingCompany} ${identity.gradeValue}`
      : null;
  const cardNumber = identity.cardNumber
    ? `#${identity.cardNumber.replace(/^#/, "")}`
    : null;
  const tokens = uniqueTokens([
    identity.year,
    identity.brand,
    identity.setName,
    identity.player,
    identity.team,
    identity.parallel,
    cardNumber,
    identity.serialNumber,
    ...features,
    grade,
  ]);

  return tokens.join(" ") || fallback.replace(/\s+/g, " ").trim() || "Trading Card";
}

function buildAspects(identity: DualMarketplaceCardIdentity) {
  const aspects: Record<string, string[]> = {};

  function add(name: string, value: string | null) {
    if (value) aspects[name] = [value];
  }

  add("Player/Athlete", identity.player);
  add("Team", identity.team);
  add("Sport", identity.sport);
  add("Manufacturer", identity.brand);
  add("Set", identity.setName);
  add("Year Manufactured", identity.year);
  add("Card Number", identity.cardNumber);
  add("Parallel/Variety", identity.parallel);
  add("Professional Grader", identity.gradingCompany);
  add("Grade", identity.gradeValue);

  const features = uniqueTokens([
    identity.isRookie ? "Rookie" : null,
    identity.isAuto ? "Autograph" : null,
    identity.isRelic ? "Memorabilia" : null,
    identity.serialNumber ? "Serial Numbered" : null,
  ]);

  if (features.length) aspects.Features = features;
  return aspects;
}

export function createDualMarketplaceListingDraft(
  input: DualMarketplaceListingInput,
): DualMarketplaceListingDraft {
  const identity = cardIdentityFromMetadata(input.metadata);
  const title = generatedTitle(identity, input.title);
  const graded = Boolean(identity.gradingCompany && identity.gradeValue);
  const websiteTitle = title.slice(0, 200);
  const ebayTitle = compactEbayTitle(title, 80);
  const categoryId = ebayCategoryId(identity, text(input.category, 100));
  const cardCondition = cardConditionForCategory(
    categoryId,
    identity.conditionGuess,
  );
  const details = [
    line("Player/Subject", identity.player),
    line("Team", identity.team),
    line("Sport", identity.sport),
    line("Year", identity.year),
    line("Manufacturer", identity.brand),
    line("Set", identity.setName),
    line("Card Number", identity.cardNumber),
    line("Parallel/Variation", identity.parallel),
    line("Serial Number", identity.serialNumber),
    identity.isRookie ? "Rookie Card: Yes" : null,
    identity.isAuto ? "Autograph: Yes" : null,
    identity.isRelic ? "Memorabilia/Relic: Yes" : null,
    line("Grader", identity.gradingCompany),
    line("Grade", identity.gradeValue),
    line("Certification Number", identity.certificationNumber),
    line("Condition", graded ? "Professionally Graded" : cardCondition || null),
  ].filter((value): value is string => Boolean(value));

  const websiteDescription = [
    websiteTitle,
    "",
    "Add this exact card to your collection. The listing images show the card you will receive; front and back are included when available.",
    "",
    ...details,
    "",
    "Please review every image for centering, corners, edges, surface, autograph, relic, serial numbering, and slab condition before purchasing. Raw-card condition must be reviewed by the operator and is not a professional grade.",
  ].join("\n");

  const ebayDetailRows = details
    .map((detail) => {
      const [label, ...valueParts] = detail.split(":");
      const value = valueParts.join(":").trim();
      return value
        ? `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`
        : `<li>${htmlEscape(detail)}</li>`;
    })
    .join("");
  const ebayDescription = [
    `<div>`,
    `<h2>${htmlEscape(ebayTitle)}</h2>`,
    `<p>You are purchasing the exact card shown in the listing photos. Front and back images are included whenever available.</p>`,
    ebayDetailRows ? `<ul>${ebayDetailRows}</ul>` : "",
    `<p>Please inspect all photos for condition details. Raw-card condition is an operator-reviewed estimate and is not a professional grade. Graded-card information should be verified against the certification number when supplied.</p>`,
    `<p>Cards are packed carefully for shipment by Truely Collectables.</p>`,
    `</div>`,
  ].join("");

  return {
    websiteTitle,
    websiteDescription,
    ebayTitle,
    ebayDescription,
    ebayCategoryId: categoryId,
    ebayCondition: graded ? "LIKE_NEW" : "USED_VERY_GOOD",
    cardCondition,
    grader: identity.gradingCompany || "",
    grade: identity.gradeValue || "",
    certificationNumber: identity.certificationNumber || "",
    aspects: buildAspects(identity),
    identity,
  };
}
