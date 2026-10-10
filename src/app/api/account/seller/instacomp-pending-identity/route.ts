import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { runKingmakerMacScan } from "../../../../../lib/kingmaker-mac-scan-server";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../../lib/instacomp-checklist-first-server";
import { buildPendingListingIdentity } from "../../../../../lib/instacomp-pending-listing-identity";
import { buildInstaCompCanonicalTitle } from "../../../../../lib/instacomp-canonical-title";
import type { InstaCompChecklistLookupInput } from "../../../../../lib/instacomp-checklist-first";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function booleanValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "auto", "autograph", "relic", "memorabilia"].includes(normalized)) return true;
      if (["false", "no", "0", "none", "base"].includes(normalized)) return false;
    }
  }
  return null;
}

function positiveInteger(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function validCardNumber(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  const normalized = text.trim().toUpperCase();
  if (["T", "CREDITS", "NO", "NONE", "N/A", "NA", "UNKNOWN"].includes(normalized)) return null;
  if (/^\d{4}$/.test(normalized) && Number(normalized) >= 1900 && Number(normalized) <= 2035) return null;
  return normalized;
}

function inferSerialRunFromEvidence(texts: string[]) {
  for (const raw of texts) {
    const explicit = raw.match(/(?:full\s+serial\s+number|serial(?:\s+number)?|numbered)\s*:?\s*\d{1,5}\s*\/\s*(\d{1,5})/i);
    if (explicit) return Number(explicit[1]);
  }
  for (const raw of texts) {
    const titleLike = raw.match(/(?:^|\s)\/\s*(\d{1,5})(?:\s|$)/);
    if (titleLike) return Number(titleLike[1]);
  }
  return null;
}

function inferSubsetFromEvidence(texts: string[]) {
  const combined = texts.join(" ").toLowerCase().replace(/\s+/g, " ");
  const patterns: Array<[RegExp, string]> = [
    [/\bpremier level\b/i, "Premier Level"],
    [/\bcourtside\b/i, "Courtside"],
    [/\bconcourse\b/i, "Concourse"],
    [/\bscore select throwback\b/i, "Score Select Throwback"],
    [/\bscore select wnba\b/i, "Score Select Throwback"],
    [/\bselect future\b/i, "Select Future"],
    [/\bsnapshots\b/i, "Snapshots"],
    [/\ben fuego\b/i, "En Fuego"],
    [/\ball-stars?\b/i, "All-Stars"],
    [/\btop tier\b/i, "Top Tier"],
    [/\bkaleidoscopic\b/i, "Kaleidoscopic"],
    [/\bfractal\b/i, "Fractal"],
    [/\bgroovy\b/i, "Groovy"],
    [/\bfireworks\b/i, "Fireworks"],
    [/\bfearless\b/i, "Fearless"],
  ];
  for (const [pattern, value] of patterns) if (pattern.test(combined)) return value;
  return null;
}

function inferAutoFromEvidence(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  return /\bautograph(?:ed|s)?\b|\bsignature(?:s)?\b|\bsigned\b/.test(combined) ? true : null;
}

function inferRelicFromEvidence(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  return /\brelic\b|\bmemorabilia\b|\bjersey\b|\bpatch\b/.test(combined) ? true : null;
}

function normalizeCardTypeParallel(value: unknown, isAuto: unknown) {
  let parallel = textValue(value);
  if (!parallel) return null;
  if (isAuto === true) {
    parallel = parallel
      .replace(/\b(?:autograph(?:ed)?|auto)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!parallel) return null;
  }
  return parallel;
}

function inferVariationFromEvidence(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  if (!/\bvariation\b/.test(combined)) return null;
  return /\brookie\b|\brc\b/.test(combined) ? "Rookie Variation" : "Variation";
}

function textList(value: unknown, limit = 50) {
  return Array.isArray(value)
    ? value
        .map((entry) => textValue(entry))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

async function storedImageFile(urlValue: string, side: "front" | "back", requestUrl: string) {
  const url = new URL(urlValue, requestUrl).toString();
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Stored ${side} image returned HTTP ${response.status}.`);
  }
  const contentType = String(response.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim() || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Stored ${side} image is not an image response.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1_000 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error(`Stored ${side} image has an invalid size.`);
  }
  return new File([bytes], `pending-${side}.jpg`, { type: contentType });
}

function storedPairUrls(
  rows: Array<{ image_url?: string | null; alt_text?: string | null; sort_order?: number | null; is_primary?: boolean | null }>,
  metadata: JsonRecord,
) {
  const ordered = [...rows]
    .filter((row) => Boolean(textValue(row.image_url)))
    .sort((left, right) => {
      if (left.is_primary === true && right.is_primary !== true) return -1;
      if (right.is_primary === true && left.is_primary !== true) return 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    });
  const instacomp = recordValue(metadata.instacomp);
  const frontRow = ordered.find((row) => /front/i.test(String(row.alt_text || ""))) || ordered[0];
  const backRow = ordered.find((row) => /back/i.test(String(row.alt_text || ""))) || ordered.find((row) => row !== frontRow);
  const front = textValue(frontRow?.image_url, instacomp.frontImageUrl);
  const back = textValue(backRow?.image_url, instacomp.backImageUrl);
  return front && back && front !== back ? { front, back } : null;
}

function buildIdentitySummary(fields: Record<string, unknown>) {
  const canonical = buildInstaCompCanonicalTitle(fields);
  return canonical ? `Card read: ${canonical}.` : null;
}

function subsetValue(fields: Record<string, unknown>) {
  const candidate = textValue(
    fields.subset,
    fields.insertName,
    fields.insert,
    fields.seriesName,
    fields.series,
    fields.parallelName,
    fields.parallel,
  );
  if (!candidate) return null;
  const normalized = candidate.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^base$/i.test(normalized)) return null;
  const canonical =
    normalized === "all american" || normalized === "all-american"
      ? "All American"
      : normalized === "crunch time" || normalized === "crunch-time"
        ? "Crunch Time"
        : normalized === "future watch"
          ? "Future Watch"
          : normalized === "young guns"
            ? "Young Guns"
            : normalized === "spectrum fx"
              ? "Spectrum FX"
              : null;
  return canonical;
}

const SUBSET_PHRASES = new Map([
  ["all american", "All American"],
  ["all-american", "All American"],
  ["crunch time", "Crunch Time"],
  ["crunch-time", "Crunch Time"],
]);

function buildIdentityTitle(fields: Record<string, unknown>) {
  return buildInstaCompCanonicalTitle(fields) || null;
}

function collectEvidenceTexts(metadata: JsonRecord) {
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const macReceipt = recordValue(instaComp.macReceipt);
  const imageOrientation = recordValue(instaComp.imageOrientation);
  const coreVisualEvidence = recordValue(instaComp.coreVisualEvidence);

  const texts = [
    textValue(instaComp.identitySummary),
    textValue(coreVisualEvidence.identitySummary),
    textValue(coreVisualEvidence.reason),
    textValue(imageOrientation.reason),
    textValue(macReceipt.reason),
    ...textList(ai.frontVisibleText),
    ...textList(ai.backVisibleText),
    ...textList(coreVisualEvidence.frontVisibleText),
    ...textList(coreVisualEvidence.backVisibleText),
    ...textList(imageOrientation.frontEvidenceText),
    ...textList(imageOrientation.backEvidenceText),
    ...textList(recordValue(macReceipt.imageOrientation).front_evidence),
    ...textList(recordValue(macReceipt.imageOrientation).back_evidence),
    ...textList(recordValue(macReceipt.imageOrientation).frontEvidenceText),
    ...textList(recordValue(macReceipt.imageOrientation).backEvidenceText),
    ...textList(instaComp.exactMarketQueries),
    ...textList(Object.values(recordValue(instaComp.sourceLinks))),
    textValue(metadata.title),
    textValue(metadata.description),
    textValue(instaComp.exactStoredTitleQuery),
    textValue(instaComp.fallbackIdentityQuery),
    textValue(recordValue(metadata.collectible_asset).title),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(texts));
}

function inferManufacturer(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  for (const [needle, canonical] of Object.entries({
    panini: "Panini",
    topps: "Topps",
    bowman: "Bowman",
    "upper deck": "Upper Deck",
    leaf: "Leaf",
    donruss: "Donruss",
    fleer: "Fleer",
    score: "Score",
    "o-pee-chee": "O-Pee-Chee",
    "o pee chee": "O-Pee-Chee",
  })) {
    if (combined.includes(needle)) return canonical;
  }
  return null;
}

function inferYear(texts: string[]) {
  const scores = new Map<number, number>();
  for (const rawText of texts) {
    const text = rawText.toLowerCase();
    const hasManufacturer = ["panini", "topps", "bowman", "upper deck", "leaf", "donruss", "fleer", "score"].some((needle) =>
      text.includes(needle),
    );
    const hasProduct = ["prizm", "select", "optic", "mosaic", "chrome", "basketball", "baseball", "football", "hockey", "wnba", "nba"].some((needle) =>
      text.includes(needle),
    );
    for (const match of rawText.matchAll(/\b((?:19|20)\d{2})\b/g)) {
      const year = Number(match[1]);
      if (year < 1900 || year > 2035) continue;
      let score = 1;
      if (hasManufacturer) score += 4;
      if (hasProduct) score += 2;
      if (text.includes("copyright") || text.includes("licensed product") || text.includes("official")) score += 1;
      scores.set(year, (scores.get(year) || 0) + score);
    }
  }
  if (!scores.size) return null;
  return String([...scores.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0][0]);
}

function inferCardNumber(texts: string[]) {
  const combined = texts.join(" | ");
  const labeledPatterns = [
    /\b(?:card\s*(?:no\.?|number)|card\s*#)\s*([A-Z0-9][A-Z0-9-]{0,8})\b/i,
    /\b(?:no\.?|#)\s*([A-Z0-9][A-Z0-9-]{0,8})\b/i,
  ];
  for (const pattern of labeledPatterns) {
    const match = combined.match(pattern)?.[1];
    if (!match) continue;
    const normalized = match.trim().toUpperCase();
    if (/^\d{4}$/.test(normalized) && Number(normalized) >= 1900 && Number(normalized) <= 2035) continue;
    return normalized;
  }
  return null;
}

function inferPlayer(texts: string[]) {
  const banned = new Set([
    "panini",
    "prizm",
    "prism",
    "select",
    "wnba",
    "nba",
    "rookie",
    "card",
    "cards",
    "basketball",
    "official",
    "trading",
    "copyright",
    "concourse",
    "premier",
    "courtside",
    "silver",
    "green",
    "blue",
    "red",
    "gold",
    "velocity",
    "cracked",
    "ice",
    "all",
    "american",
    "time",
  ]);

  const candidates: Array<{ score: number; value: string }> = [];
  for (const rawText of texts) {
    const cleaned = rawText.replace(/[^A-Za-z .'-]+/g, " ").replace(/\s+/g, " ").trim();
    const words = cleaned.split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 5) continue;
    if (words.some((word) => word.length < 2)) continue;
    const lowered = words.map((word) => word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, ""));
    if (lowered.some((word) => banned.has(word))) continue;
    const normalized = lowered.join(" ");
    if (SUBSET_PHRASES.has(normalized)) continue;
    if (lowered.every((word) => word.length <= 3)) continue;
    let score = 1;
    if (words.length >= 2 && words.length <= 4) score += 1;
    if (cleaned === cleaned.toUpperCase()) score += 0.3;
    if (/[A-Z][a-z]/.test(cleaned)) score += 0.5;
    candidates.push({ score, value: cleaned });
  }
  candidates.sort((left, right) => right.score - left.score || right.value.length - left.value.length);
  return candidates[0]?.score >= 1.5 ? candidates[0].value : null;
}

function inferProduct(texts: string[]) {
  const combined = texts.join(" ").replace(/\s+/g, " ").trim();
  const patterns: Array<[RegExp, string]> = [
    [/\bpanini\s+prizm\s+wnba\b/i, "Panini Prizm WNBA"],
    [/\bpanini\s+select\s+wnba\b/i, "Select WNBA"],
    [/\bselect\s+panini\s+select\s+wnba\b/i, "Select WNBA"],
    [/\bselect\s+wnba\b/i, "Select WNBA"],
    [/\bpanini\s+prizm\b/i, "Panini Prizm"],
    [/\bpanini\s+select\b/i, "Panini Select"],
    [/\bdonruss\s+optic\b/i, "Donruss Optic"],
    [/\bdonruss\b/i, "Donruss"],
    [/\bbowman\s+chrome\b/i, "Bowman Chrome"],
    [/\btopps\s+chrome\b/i, "Topps Chrome"],
    [/\bupper\s+deck\b/i, "Upper Deck"],
  ];
  for (const [pattern, value] of patterns) if (pattern.test(combined)) return value;
  return null;
}

function inferBrandFromProduct(product: string | null) {
  if (!product) return null;
  if (/^Select(?:\s|$)/i.test(product)) return "Select";
  if (/Panini Prizm/i.test(product)) return "Prizm";
  if (/Donruss Optic/i.test(product)) return "Optic";
  if (/^Donruss(?:\s|$)/i.test(product)) return "Donruss";
  if (/Bowman Chrome/i.test(product)) return "Bowman";
  if (/Topps Chrome/i.test(product)) return "Topps";
  if (/Upper Deck/i.test(product)) return "Upper Deck";
  return null;
}

function releaseFamilyCore(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}(?:\s*-\s*\d{2,4})?\b/g, " ")
    .replace(/\b(?:panini|topps|upper\s+deck|wnba|nba|nfl|nhl|mlb|hockey|basketball|football|baseball|cards?|trading)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isProductFamilyOnlySetName(setName: unknown, product: unknown, brand: unknown) {
  const setCore = releaseFamilyCore(setName);
  if (!setCore) return false;
  return [product, brand].map(releaseFamilyCore).filter(Boolean).includes(setCore);
}

function inferExplicitParallel(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  const patterns: Array<[string, string]> = [
    ["blue cracked ice", "Blue Cracked Ice"],
    ["orange cracked ice", "Orange Cracked Ice Prizm"],
    ["silver flash prizm", "Silver Flash Prizm"],
    ["silver prizm", "Silver Prizm"],
    ["green prizm", "Green Prizm"],
    ["orange prizm", "Orange Prizm"],
    ["pink flash", "Pink Flash Prizm"],
    ["blue velocity", "Blue Velocity Prizm"],
    ["white seismic", "White Seismic Prizm"],
    ["orange ice", "Orange Ice Prizm"],
    ["pink ice", "Pink Ice"],
    ["red wave", "Red Wave"],
  ];
  for (const [needle, value] of patterns) if (combined.includes(needle)) return value;
  return null;
}

function inferParallel(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  if (combined.includes("silver flash prizm")) return "Silver Flash Prizm";
  if (combined.includes("silver prizm")) return "Silver Prizm";
  if (combined.includes("blue cracked ice")) return "Blue Cracked Ice";
  if (combined.includes("orange cracked ice")) return "Orange Cracked Ice Prizm";
  if (combined.includes("cracked ice")) return "Cracked Ice Prizm";
  if (combined.includes("holo")) return "Holo";
  if (combined.includes("green prizm")) return "Green Prizm";
  if (combined.includes("orange prizm")) return "Orange Prizm";
  if (combined.includes("pink flash")) return "Pink Flash Prizm";
  if (combined.includes("wave")) return "Wave";
  if (combined.includes("concourse")) return "Concourse";
  if (combined.includes("premier level")) return "Premier Level";
  if (combined.includes("courtside")) return "Courtside";
  return null;
}

function visualIdentity(metadata: JsonRecord, listingTitle?: unknown) {
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const collectible = recordValue(metadata.collectible_asset);
  const card = recordValue(metadata.card);
  const cardIdentity = recordValue(metadata.card_identity);
  const saleIdentity = recordValue(metadata.sale_identity);
  const verified = recordValue(metadata.verified_reference);

  const year = textValue(
    ai.year,
    ai.season,
    card.year,
    card.season,
    cardIdentity.year,
    saleIdentity.year,
    verified.year,
  );
  const manufacturer = textValue(
    ai.manufacturer,
    ai.manufacturerName,
    card.manufacturer,
    cardIdentity.manufacturer,
    verified.manufacturer,
  );
  const brand = textValue(ai.brand, card.brand, cardIdentity.brand, verified.brand);
  const product = textValue(ai.product, ai.productName, card.product, cardIdentity.product, verified.product);
  const setName = textValue(
    ai.setName,
    ai.set_name,
    ai.set,
    card.setName,
    card.set_name,
    cardIdentity.setName,
    cardIdentity.set_name,
    verified.setName,
  );
  const cardNumber = textValue(
    ai.cardNumber,
    ai.card_number,
    card.cardNumber,
    card.card_number,
    cardIdentity.cardNumber,
    cardIdentity.card_number,
    saleIdentity.cardNumber,
    saleIdentity.card_number,
    verified.cardNumber,
    verified.card_number,
  );
  const player = textValue(
    ai.player,
    ai.playerName,
    ai.subject,
    card.player,
    cardIdentity.player,
    cardIdentity.playerName,
    saleIdentity.player,
    saleIdentity.playerName,
    verified.player,
  );
  const team = textValue(ai.team, ai.teamName, card.team, cardIdentity.team, saleIdentity.team, verified.team);
  const sport = textValue(ai.sport, card.sport, cardIdentity.sport, verified.sport);
  const league = textValue(ai.league, card.league, cardIdentity.league, verified.league);
  const parallel = textValue(ai.checklistParallel, ai.parallelName, ai.parallel, card.parallel, cardIdentity.parallel, saleIdentity.parallel, verified.parallel);
  const variation = textValue(ai.variation, card.variation, cardIdentity.variation, saleIdentity.variation, verified.variation);
  const serialRun = positiveInteger(
    ai.serialRun,
    ai.printRun,
    collectible.serial_run,
    collectible.title_print_run,
    cardIdentity.serialRun,
    saleIdentity.serialRun,
    verified.serialRun,
  );
  const isAuto = booleanValue(
    ai.isAuto,
    ai.autograph,
    ai.autographStatus,
    card.isAuto,
    verified.isAuto,
  );
  const isRelic = booleanValue(
    ai.isRelic,
    ai.memorabilia,
    ai.memorabiliaStatus,
    card.isRelic,
    verified.isRelic,
  );
  const registryIdentityId = textValue(ai.checklistIdentityId, instaComp.cardUuid);
  const registryFingerprintSha256 = textValue(
    ai.checklistFingerprintSha256,
    ai.registryFingerprintSha256,
  );
  const evidenceTexts = [textValue(listingTitle), ...collectEvidenceTexts(metadata)].filter((value): value is string => Boolean(value));
  const visualYear = year || inferYear(evidenceTexts);
  const visualManufacturer = manufacturer || inferManufacturer(evidenceTexts);
  const visualCardNumber = validCardNumber(cardNumber) || validCardNumber(inferCardNumber(evidenceTexts));
  const visualPlayer = player || inferPlayer(evidenceTexts);
  const visualProduct = product || inferProduct(evidenceTexts);
  const visualSetName = setName || visualProduct;
  const visualSubset =
    subsetValue(ai) ||
    subsetValue(card) ||
    subsetValue(verified) ||
    inferSubsetFromEvidence(evidenceTexts);
  const visualParallel = parallel || inferParallel(evidenceTexts);
  const visualSerialRun = serialRun || inferSerialRunFromEvidence(evidenceTexts);
  const visualIsAuto = inferAutoFromEvidence(evidenceTexts) === true ? true : isAuto;
  const visualIsRelic = inferRelicFromEvidence(evidenceTexts) === true ? true : isRelic;
  const visualTitle =
    buildIdentityTitle({
      year: visualYear,
      manufacturer: visualManufacturer,
      brand,
      product: visualProduct,
      setName: visualSetName,
      subset: visualSubset,
      cardNumber: visualCardNumber,
      player: visualPlayer,
      team,
      parallel: visualParallel,
    }) ||
    textValue(instaComp.identitySummary) ||
    textValue(ai.notes) ||
    buildIdentitySummary({
      year: visualYear,
      manufacturer: visualManufacturer,
      brand,
      product: visualProduct,
      setName: visualSetName,
      subset: visualSubset,
      cardNumber: visualCardNumber,
      player: visualPlayer,
      team,
      variation,
      parallel: visualParallel,
    });
  const summary =
    textValue(ai.notes) ||
    textValue(instaComp.identitySummary) ||
    buildIdentitySummary({
      year: visualYear,
      manufacturer: visualManufacturer,
      brand,
      product: visualProduct,
      setName: visualSetName,
      cardNumber: visualCardNumber,
      player: visualPlayer,
      team,
      variation,
      parallel: visualParallel,
    });
  const identified = Boolean(
    visualTitle ||
      visualYear ||
      visualManufacturer ||
      visualSetName ||
      visualCardNumber ||
      visualPlayer ||
      team ||
      visualParallel,
  );

  return {
    status: identified ? ('identified' as const) : ('review_required' as const),
    source: 'visual_ai' as const,
    aiIdentificationRequired: !identified,
    registryIdentityId: registryIdentityId || null,
    registryFingerprintSha256: registryFingerprintSha256 || null,
    title: visualTitle || null,
    lockedFields: {
      year: visualYear || null,
      manufacturer: visualManufacturer || null,
      brand,
      product: visualProduct,
      setName: visualSetName,
      subset: visualSubset,
      cardNumber: visualCardNumber || null,
      player: visualPlayer || null,
      team,
      sport,
      league,
      parallel: visualParallel,
      variation: variation || null,
      serialRun: visualSerialRun ?? null,
      isAuto: visualIsAuto,
      isRelic: visualIsRelic,
    },
    reasons: identified
      ? ['pending_listing_identity_locked_to_visual_ai_read']
      : ['visual_ai_identity_missing_required_fields'],
    notes: summary,
  };
}

export function checklistInputFromMetadata(metadata: JsonRecord, listingTitle?: unknown): InstaCompChecklistLookupInput {
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const collectible = recordValue(metadata.collectible_asset);
  const visual = visualIdentity(metadata, listingTitle);
  const fields = visual.lockedFields;
  const titleEvidence = textValue(listingTitle);
  const titleParallel = titleEvidence ? inferExplicitParallel([titleEvidence]) : null;
  const storedParallel = textValue(ai.checklistParallel, ai.parallelName, ai.parallel, fields.parallel);
  const parallel = normalizeCardTypeParallel(titleParallel || storedParallel, fields.isAuto);
  const titleProduct = titleEvidence ? inferProduct([titleEvidence]) : null;
  const product = titleProduct || textValue(ai.product, ai.productName, fields.product);
  const storedSet = textValue(ai.setName, ai.set_name, ai.set);
  const fieldSet = textValue(fields.setName);
  const rawSubset = textValue(ai.subset, fields.subset);
  const subset = rawSubset && textValue(fields.player) && rawSubset.toLowerCase() === textValue(fields.player)!.toLowerCase()
    ? null
    : rawSubset;
  // fields.setName may itself be the inferred product-family fallback from visualIdentity.
  // Never feed product names (Select WNBA / Panini Prizm WNBA) back into Registry setName.
  const rawSetCandidate = storedSet || (fieldSet && fieldSet.toLowerCase() !== String(product || "").toLowerCase() ? fieldSet : null);
  const rawSet = rawSetCandidate && !/^variation$/i.test(rawSetCandidate) && !isProductFamilyOnlySetName(rawSetCandidate, product, inferBrandFromProduct(titleProduct || product) || fields.brand)
    ? rawSetCandidate
    : null;
  const setName = rawSet && rawSet.toLowerCase() !== String(parallel || "").toLowerCase() ? rawSet : null;
  const variation = textValue(fields.variation) || inferVariationFromEvidence(collectEvidenceTexts(metadata));
  const serialNumber = textValue(
    ai.serialNumber, ai.serial_number, instaComp.serialNumber, collectible.exact_serial_number,
    ai.printRun, collectible.print_run, fields.serialRun ? `/${fields.serialRun}` : null,
  );
  return {
    year: textValue(fields.year),
    manufacturer: textValue(fields.manufacturer) || (titleProduct?.startsWith("Panini ") ? "Panini" : null),
    brand: inferBrandFromProduct(titleProduct || product) || textValue(fields.brand),
    setName,
    subset,
    cardNumber: textValue(fields.cardNumber),
    player: textValue(fields.player),
    serialNumber,
    isAuto: typeof fields.isAuto === "boolean" ? fields.isAuto : null,
    isRelic: typeof fields.isRelic === "boolean" ? fields.isRelic : null,
    parallel,
    variation,
    ocrText: collectEvidenceTexts(metadata).join("\n").slice(0, 12_000) || null,
  };
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = (await request.json().catch(() => null)) as
      | { inventoryItemId?: unknown }
      | null;
    const inventoryItemId = textValue(body?.inventoryItemId);
    if (!inventoryItemId) {
      return Response.json({ error: "inventoryItemId is required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: row, error } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) throw error;
    if (!row) return Response.json({ error: "Pending listing not found." }, { status: 404 });

    const isStoreOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isStoreOwner && row.seller_account_id !== account.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    let metadata = recordValue(row.metadata);
    let instaComp = recordValue(metadata.instacomp);

    // Recovery must use the physical pixels again, not merely recycle stale
    // metadata from the original failed/legacy scan. Reuse the stored pair and
    // bind the recovered Mac-local draft to this same Master Listing ID.
    const { data: storedImageRows, error: storedImageError } = await supabase
      .from("inventory_images")
      .select("image_url,alt_text,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (storedImageError) throw storedImageError;
    const storedPair = storedPairUrls(storedImageRows || [], metadata);
    if (storedPair) {
      try {
        const [front, back] = await Promise.all([
          storedImageFile(storedPair.front, "front", request.url),
          storedImageFile(storedPair.back, "back", request.url),
        ]);
        const recovery = await runKingmakerMacScan({
          front,
          back,
          inventoryItemId,
          searchMarket: true,
        });
        const recoveredMetadata = recordValue(recovery.inventoryItem.metadata);
        const recoveredInstaComp = recordValue(recoveredMetadata.instacomp);
        const recoveredChecklistIdentity = recordValue(
          recoveredInstaComp.checklistIdentity,
        );
        const recoveryHasCanonicalExactProof = Boolean(
          recovery.identityComplete === true &&
            recoveredInstaComp.trustedForIdentity === true &&
            textValue(recoveredChecklistIdentity.status) === "exact_match" &&
            textValue(recoveredChecklistIdentity.identityId) &&
            textValue(recoveredChecklistIdentity.fingerprintSha256),
        );
        const priorOrientation = recordValue(instaComp.imageOrientation);
        const recoveredOrientation = recordValue(recoveredInstaComp.imageOrientation);
        const preservePriorOrientation =
          textValue(priorOrientation.status) === "completed" &&
          instaComp.imageOrientationPersisted === true;
        const recoveredAt = new Date().toISOString();
        const recoveredQueue = recoveryHasCanonicalExactProof
          ? "pending_listings"
          : "pending_verification";
        metadata = {
          ...metadata,
          ...recoveredMetadata,
          listingWorkflow: {
            ...recordValue(metadata.listingWorkflow),
            queue: recoveredQueue,
            source: "mac_physical_recovery",
            updatedAt: recoveredAt,
          },
          instacomp: {
            ...instaComp,
            ...recoveredInstaComp,
            imageOrientation: preservePriorOrientation
              ? priorOrientation
              : recoveredOrientation,
            imageOrientationPersisted:
              instaComp.imageOrientationPersisted === true ||
              recoveredInstaComp.imageOrientationPersisted === true,
            imagePersistenceVerified: true,
            identityComplete: recoveryHasCanonicalExactProof,
            trustedForIdentity: recoveryHasCanonicalExactProof,
            identityRefreshRequired: !recoveryHasCanonicalExactProof,
            lastStatus: recoveryHasCanonicalExactProof
              ? "identity_complete"
              : "review_required",
            lastStage: recoveryHasCanonicalExactProof
              ? "mac_physical_recovery"
              : "mac_physical_review",
            recoveredFromStoredPairAt: recoveredAt,
          },
        };
        instaComp = recordValue(metadata.instacomp);
        const recoveryUpdate: Record<string, unknown> = { metadata };
        if (recoveryHasCanonicalExactProof && recovery.inventoryItem.title) {
          recoveryUpdate.title = recovery.inventoryItem.title;
        }
        const { error: recoveryUpdateError } = await supabase
          .from("inventory_items")
          .update(recoveryUpdate)
          .eq("id", inventoryItemId)
          .eq("store_id", storeId);
        if (recoveryUpdateError) throw recoveryUpdateError;

        if (recoveryHasCanonicalExactProof) {
          return Response.json({
            success: true,
            identity: {
              status: "identified",
              lockedFields: recovery.ai,
              notes: `Card read: ${recovery.inventoryItem.title}.`,
              reasons: ["mac_physical_pair_recovered"],
            },
            identityComplete: true,
            title: recovery.inventoryItem.title,
            scanId: recovery.scan.scan_id,
            cardUuid: recovery.scan.card_uuid || null,
            sourceOfTruth: "mac_local",
            recoveredStoredImages: true,
          });
        }
      } catch (physicalRecoveryError) {
        const recoveryMessage =
          physicalRecoveryError instanceof Error
            ? physicalRecoveryError.message
            : "Stored physical-pair recovery failed.";
        metadata = {
          ...metadata,
          instacomp: {
            ...instaComp,
            lastStage: "physical_recovery_failed",
            lastError: recoveryMessage,
            lastErrorCode: "PHYSICAL_RECOVERY_FAILED",
          },
        };
        instaComp = recordValue(metadata.instacomp);
      }
    }

    const currentAi = recordValue(instaComp.ai);
    const input = checklistInputFromMetadata(metadata, row.title);
    const decision = await resolveInstaCompChecklistFirstFromRegistry(input);
    let identity = buildPendingListingIdentity({ input, decision });
    const hasPermanentReceipt = Boolean(
      identity.status === "identified" &&
      identity.registryIdentityId &&
      identity.registryFingerprintSha256,
    );
    if (!hasPermanentReceipt && identity.status === "identified") {
      identity = {
        ...identity,
        status: "review_required",
        aiIdentificationRequired: true,
        reasons: [...identity.reasons, "registry_exact_match_missing_permanent_receipt"],
      };
    }

    const operatorProtected =
      instaComp.manualIdentityLocked === true ||
      instaComp.humanVerified === true ||
      instaComp.operatorReviewProtected === true;
    const exact = identity.status === "identified" && hasPermanentReceipt;
    const nextAi = exact && !operatorProtected
      ? {
          ...currentAi,
          year: identity.lockedFields.year,
          manufacturer: identity.lockedFields.manufacturer,
          brand: identity.lockedFields.brand,
          product: identity.lockedFields.product,
          setName: identity.lockedFields.setName,
          subset: (decision.match as any)?.subset || currentAi.subset || null,
          cardNumber: identity.lockedFields.cardNumber,
          player: identity.lockedFields.player,
          team: identity.lockedFields.team,
          sport: identity.lockedFields.sport,
          league: identity.lockedFields.league,
          parallel: identity.lockedFields.parallel,
          checklistParallel: identity.lockedFields.parallel,
          variation: identity.lockedFields.variation,
          serialRun: identity.lockedFields.serialRun,
          isAuto: identity.lockedFields.isAuto,
          isRelic: identity.lockedFields.isRelic,
          checklistIdentityId: identity.registryIdentityId,
          checklistFingerprintSha256: identity.registryFingerprintSha256,
        }
      : {
          ...currentAi,
          ...(exact
            ? {
                checklistIdentityId: identity.registryIdentityId,
                checklistFingerprintSha256: identity.registryFingerprintSha256,
              }
            : {}),
        };

    const checkedAt = new Date().toISOString();
    const nextMetadata: Record<string, unknown> = {
      ...metadata,
      instacomp: {
        ...instaComp,
        ai: nextAi,
        trustedForIdentity: exact ? true : operatorProtected ? instaComp.trustedForIdentity === true : false,
        identityComplete: operatorProtected ? instaComp.identityComplete === true : exact,
        ...(operatorProtected
          ? {}
          : {
              lastStatus: exact ? "identity_complete" : "needs_review",
              lastStage: exact ? "checklist_registry_exact" : "checklist_registry_review",
            }),
        checklistDecision: {
          status: decision.status,
          source: "checklist_registry",
          aiRequired: decision.aiRequired,
          candidateCount: decision.candidates.length,
          reasons: decision.reasons,
          checkedAt,
        },
        checklistIdentity: {
          status: identity.status,
          source: "checklist_registry",
          aiIdentificationRequired: identity.aiIdentificationRequired,
          registryIdentityId: identity.registryIdentityId,
          registryFingerprintSha256: identity.registryFingerprintSha256,
          lockedFields: identity.lockedFields,
          reasons: identity.reasons,
          checkedAt,
          operatorProtected,
        },
      },
    };

    const canonicalTitle = exact
      ? buildInstaCompCanonicalTitle(nextAi, { metadata: nextMetadata, rawTitle: row.title })
      : null;
    const canonicalRookie = Boolean(canonicalTitle && /(?:^|\s)RC(?:\s|$)/.test(canonicalTitle));
    const nextInstaComp = recordValue(nextMetadata.instacomp);
    const normalizedMetadata = canonicalTitle
      ? {
          ...nextMetadata,
          ...(canonicalRookie
            ? {
                instacomp: {
                  ...nextInstaComp,
                  ai: { ...recordValue(nextInstaComp.ai), isRookie: true },
                },
                cardIdentity: { ...recordValue(nextMetadata.cardIdentity), isRookie: true },
                card_identity: { ...recordValue(nextMetadata.card_identity), isRookie: true },
              }
            : {}),
          titleNormalization: {
            rule: "instacomp_canonical_title_v2",
            format: "YEAR PRODUCT [LEVEL/INSERT] #CARD PLAYER [RC] [PARALLEL] [VARIATION] [/N]",
            teamExcluded: true,
            genericBaseExcluded: true,
            leagueSuffixExcluded: true,
            normalizedAt: checkedAt,
            previousTitle: row.title,
            normalizedTitle: canonicalTitle,
            rookiePersisted: canonicalRookie,
          },
        }
      : nextMetadata;
    const updatePayload: Record<string, unknown> = { metadata: normalizedMetadata };
    if (canonicalTitle) updatePayload.title = canonicalTitle;
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update(updatePayload)
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return Response.json({ success: true, identity, identityComplete: identity.status === 'identified' });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the pending-listing Registry identity.",
      },
      { status: 500 },
    );
  }
}
