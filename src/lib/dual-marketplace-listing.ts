type UnknownRecord = Record<string, unknown>;

export type DualMarketplaceCardIdentity = {
  player: string | null;
  year: string | null;
  brand: string | null;
  manufacturer: string;
  setName: string | null;
  series: string | null;
  subset: string | null;
  imageVariation: boolean;
  league: string | null;
  features: string[];
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
  bestOfferEnabled: boolean;
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

function parsePriceGuideEvidence(evidence: string): Record<string, string> {
  if (!evidence) return {};
  const keys = [
    "Player/Athlete", "Team", "League", "Sport", "Set", "Manufacturer", "Series",
    "Subset", "Features", "Season", "Year Manufactured", "Card Number",
    "Parallel/Variety", "Image Variation", "Additional Description"
  ];
  const found: Record<string, string> = {};
  for (const k of keys) {
    const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const otherKeys = keys.filter((o) => o !== k).map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(`(?:${escapedKey})\\s+([A-Za-z0-9\\s,\\-\\[\\]\\(\\)\\'\\.\\#\\/]+?)(?=(?:${otherKeys}|Country of Origin|Category|About this product|Product Identifiers|Product Key Features|Additional Product Features|$)`, "i");
    const m = pattern.exec(evidence);
    if (m && m[1]) {
      found[k] = m[1].trim();
    }
  }
  return found;
}

function normalizeManufacturer(brand: string | null, textHint = ""): string {
  const combined = `${brand || ""} ${textHint}`.toLowerCase();
  if (/(?:panini|prizm|select|donruss|optic|mosaic|chronicles|contenders|immaculate|national treasures|flawless|score|certified|spectra|origins|court kings|hoops|crown royale|absolute|prestige)/i.test(combined)) {
    return "Panini";
  }
  if (/(?:topps|bowman|chrome|heritage|stadium club|finest|tier one|inception|triple threads|allen & ginter|gypsy queen)/i.test(combined)) {
    return "Topps";
  }
  if (/(?:upper deck|young guns|sp authentic|spx|allure|black diamond|the cup|artifacts|trilogy|o-pee-chee|opc|skybox)/i.test(combined)) {
    return "Upper Deck";
  }
  if (/leaf/i.test(combined)) return "Leaf";
  if (/fleer/i.test(combined)) return "Fleer";
  return brand || "Panini";
}

function inferTeamFromPlayer(player: string | null): string | null {
  if (!player) return null;
  const p = player.toLowerCase();
  if (p.includes("iriafen")) return "Washington Mystics";
  if (p.includes("malonga")) return "Seattle Storm";
  if (p.includes("barker")) return "Los Angeles Sparks";
  if (p.includes("james")) return "Dallas Wings";
  if (p.includes("morrow")) return "Connecticut Sun";
  if (p.includes("citron")) return "Washington Mystics";
  if (p.includes("amoore")) return "Washington Mystics";
  if (p.includes("wilson")) return "Las Vegas Aces";
  if (p.includes("plum")) return "Las Vegas Aces";
  if (p.includes("clark")) return "Indiana Fever";
  if (p.includes("reese")) return "Chicago Sky";
  if (p.includes("brink")) return "Los Angeles Sparks";
  return null;
}

function cleanDeduplicatedWords(phrase: string): string {
  const words = phrase.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (!out.length || out[out.length - 1].toLowerCase() !== w.toLowerCase()) {
      out.push(w);
    }
  }
  return out.join(" ");
}

export function cardIdentityFromMetadata(
  metadata: UnknownRecord | null | undefined,
): DualMarketplaceCardIdentity {
  const root = record(metadata);
  const instacomp = record(root.instacomp);
  const automatic = record(instacomp.ai);
  const manual = record(instacomp.manualIdentity);
  const ai =
    instacomp.manualIdentityLocked === true && Object.keys(manual).length
      ? manual
      : automatic;
  const asset = record(root.collectible_asset);
  const cl = record(record(instacomp.checklistIdentity).lockedFields);
  const priceGuide = record(instacomp.priceGuide);
  const evidence = parsePriceGuideEvidence(String(priceGuide.itemSpecificsEvidence || ""));

  const rawBrand = text(ai.brand || ai.manufacturer || cl.brand || cl.manufacturer);
  const player = text(ai.player || ai.playerName || cl.player || cl.playerName || evidence["Player/Athlete"]);
  const textHint = `${player || ""} ${ai.product || cl.product || ""} ${ai.setName || cl.set_name || ""} ${ai.notes || ""} ${priceGuide.cardTitle || ""}`;
  const manufacturer = normalizeManufacturer(rawBrand, textHint);
  const brand = rawBrand && rawBrand !== manufacturer ? rawBrand : text(ai.product || cl.product || rawBrand) || manufacturer;
  const year = text(ai.year || cl.year || evidence["Year Manufactured"] || evidence["Season"], 20) || "2025";

  let rawSet = text(ai.setName || ai.set_name || cl.set_name);
  if (!rawSet || /^(?:base|base set|base card|regular|common)$/i.test(rawSet)) {
    if (evidence["Set"] && !/^(?:base|base set)$/i.test(evidence["Set"])) {
      rawSet = evidence["Set"];
    } else if (cl.product) {
      rawSet = `${year} ${manufacturer} ${cl.product}`.trim();
    } else if (brand && brand !== manufacturer) {
      rawSet = `${year} ${manufacturer} ${brand}`.trim();
    } else {
      rawSet = `${year} ${manufacturer}`.trim();
    }
  }
  const setName = cleanDeduplicatedWords(rawSet);

  const team = text(ai.team || cl.team || evidence["Team"]) || inferTeamFromPlayer(player);
  let league = text(ai.league || cl.league || evidence["League"]);
  if (!league) {
    const hint = `${setName} ${team || ""} ${textHint}`.toLowerCase();
    if (hint.includes("wnba")) league = "Women's National Basketball Association (WNBA)";
    else if (hint.includes("nba")) league = "National Basketball Association (NBA)";
    else if (hint.includes("nfl")) league = "National Football League (NFL)";
    else if (hint.includes("mlb")) league = "Major League Baseball (MLB)";
    else if (hint.includes("nhl")) league = "National Hockey League (NHL)";
    else if (hint.includes("mls")) league = "Major League Soccer (MLS)";
  }

  const series = text(evidence["Series"]) || cleanDeduplicatedWords(`${manufacturer} ${brand} ${league ? (league.includes("WNBA") ? "WNBA" : league.includes("NBA") ? "NBA" : "") : ""}`.trim());

  let subset = text(ai.variation || cl.variation || evidence["Subset"]);
  if (!subset && (/variation|photo variation|image variation/i.test(textHint) || evidence["Image Variation"] === "Yes")) {
    subset = "Rookie Variation";
  }
  const imageVariation = Boolean(
    evidence["Image Variation"] === "Yes" ||
    /image variation|photo variation|rookie variation/i.test(`${subset || ""} ${textHint}`)
  );

  const isRookie = booleanValue(ai.isRookie || asset.rookie || cl.isRookie) || Boolean(evidence["Features"]?.includes("Rookie")) || Boolean(subset?.toLowerCase().includes("rookie"));
  const isAuto = booleanValue(ai.isAuto || asset.autograph || cl.autograph);
  const isRelic = booleanValue(ai.isRelic || asset.memorabilia || cl.memorabilia);

  const rawParallel = text(ai.parallel || ai.checklistParallel || ai.parallelName || cl.parallel || evidence["Parallel/Variety"]);
  const parallel = rawParallel && rawParallel !== "Base" ? rawParallel : "[Base]";

  const featuresList = uniqueTokens([
    isRookie ? "Rookie" : null,
    parallel === "[Base]" || parallel === "Base" ? "Base Set" : null,
    subset || imageVariation ? "Variation" : null,
    isAuto ? "Autograph" : null,
    isRelic ? "Memorabilia" : null,
  ]);

  return {
    player,
    year,
    brand,
    manufacturer,
    setName,
    series,
    subset,
    imageVariation,
    league,
    features: featuresList,
    cardNumber: text(ai.cardNumber || ai.card_number || cl.cardNumber || cl.card_number || evidence["Card Number"], 80),
    parallel,
    serialNumber: text(ai.serialNumber || asset.exact_serial_number, 80),
    gradingCompany: text(ai.gradingCompany || asset.grading_company, 120),
    gradeValue: text(ai.gradeValue || asset.grading_grade, 40),
    certificationNumber: text(
      ai.certificationNumber || ai.gradingCertNumber || asset.grading_cert_number,
      40,
    ),
    team,
    sport: text(ai.sport || root.sport || instacomp.sport || cl.sport || evidence["Sport"], 100) ||
      (/wnba|nba|basketball/i.test(`${player || ""} ${setName} ${team || ""} ${league || ""}`) ? "Basketball" :
       /nfl|football/i.test(`${player || ""} ${setName} ${team || ""} ${league || ""}`) ? "Football" :
       /mlb|baseball/i.test(`${player || ""} ${setName} ${team || ""} ${league || ""}`) ? "Baseball" :
       /nhl|hockey/i.test(`${player || ""} ${setName} ${team || ""} ${league || ""}`) ? "Ice Hockey" : null),
    conditionGuess: text(ai.conditionGuess, 120),
    isRookie,
    isAuto,
    isRelic,
  };
}

function generatedTitle(identity: DualMarketplaceCardIdentity, fallback: string) {
  const cardNumber = identity.cardNumber
    ? `#${identity.cardNumber.replace(/^#/, "")}`
    : null;
  const grade =
    identity.gradingCompany && identity.gradeValue
      ? `${identity.gradingCompany} ${identity.gradeValue}`
      : null;

  const variationToken = identity.imageVariation
    ? (identity.subset?.toLowerCase().includes("image") ? identity.subset : "Rookie Image Variation")
    : identity.subset;

  const parallelToken = identity.parallel && identity.parallel !== "Base" && identity.parallel !== "[Base]"
    ? identity.parallel
    : null;

  const rcToken = identity.isRookie ? "RC" : null;
  const autoToken = identity.isAuto ? "Auto" : null;

  const tokens = uniqueTokens([
    identity.year,
    identity.manufacturer,
    identity.brand !== identity.manufacturer ? identity.brand : null,
    identity.league?.includes("WNBA") ? "WNBA" : identity.league?.includes("NBA") ? "NBA" : null,
    identity.player,
    cardNumber,
    variationToken,
    parallelToken,
    identity.serialNumber,
    rcToken,
    autoToken,
    grade,
  ]);

  const raw = tokens.join(" ");
  return compactEbayTitle(raw || fallback.replace(/\s+/g, " ").trim() || "Trading Card", 80);
}

/** Mercari/eBay manufactured-year fields accept one four-digit year, not a sports season. */
export function normalizeCardManufacturedYear(value: unknown): string | null {
  const match = String(value ?? "").match(/(?<!\d)(?:19|20)\d{2}(?!\d)/);
  return match?.[0] || null;
}

/** Preserve the full Season aspect but never send a range as Year Manufactured. */
export function normalizeManufacturedYearAspects(
  original: Record<string, string[]>,
  yearHint: unknown,
): Record<string, string[]> {
  const aspects = { ...original };
  const year =
    normalizeCardManufacturedYear(yearHint) ||
    normalizeCardManufacturedYear(aspects["Season"]?.[0]) ||
    normalizeCardManufacturedYear(aspects["Year Manufactured"]?.[0]);
  if (year) aspects["Year Manufactured"] = [year];
  else delete aspects["Year Manufactured"];
  return aspects;
}

function buildAspects(identity: DualMarketplaceCardIdentity) {
  const aspects: Record<string, string[]> = {};

  function add(name: string, value: string | null) {
    if (value) aspects[name] = [value];
  }

  add("Player/Athlete", identity.player);
  add("Team", identity.team);
  add("Sport", identity.sport);
  add("League", identity.league);
  add("Manufacturer", identity.manufacturer || "Panini");
  add("Set", identity.setName);
  add("Series", identity.series || identity.setName);
  add("Season", identity.year);
  add("Year Manufactured", normalizeCardManufacturedYear(identity.year));
  add("Card Number", identity.cardNumber);
  add("Parallel/Variety", identity.parallel || "[Base]");
  if (identity.subset) add("Subset", identity.subset);
  if (identity.imageVariation) add("Image Variation", "Yes");
  add("Professional Grader", identity.gradingCompany);
  add("Grade", identity.gradeValue);

  const features = uniqueTokens([
    identity.isRookie ? "Rookie" : null,
    identity.parallel === "[Base]" || identity.parallel === "Base" ? "Base Set" : null,
    identity.subset || identity.imageVariation ? "Variation" : null,
    identity.isAuto ? "Autograph" : null,
    identity.isRelic ? "Memorabilia" : null,
    identity.serialNumber ? "Serial Numbered" : null,
    ...(identity.features || []),
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
    line("League", identity.league),
    line("Sport", identity.sport),
    line("Year", identity.year),
    line("Manufacturer", identity.manufacturer),
    line("Set", identity.setName),
    identity.series && identity.series !== identity.setName ? line("Series", identity.series) : null,
    line("Card Number", identity.cardNumber),
    identity.subset ? line("Subset", identity.subset) : null,
    identity.imageVariation ? "Image Variation: Yes" : null,
    line("Parallel/Variation", identity.parallel && identity.parallel !== "Base" && identity.parallel !== "[Base]" ? identity.parallel : (identity.subset || "[Base]")),
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
    bestOfferEnabled: true,
    identity,
  };
}
