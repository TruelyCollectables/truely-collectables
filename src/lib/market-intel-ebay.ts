import "server-only";

import {
  ingestMarketIntelListings,
  type MarketIntelIngestItem,
} from "./market-intel-ingestion";
import { createSupabaseServerClient } from "./supabase-server";

type EbayTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type EbayMoney = {
  value?: string;
  currency?: string;
};

type EbayItemSummary = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  shortDescription?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  price?: EbayMoney;
  currentBidPrice?: EbayMoney;
  buyingOptions?: string[];
  itemCreationDate?: string;
  itemEndDate?: string;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  seller?: {
    username?: string;
    feedbackPercentage?: string;
    feedbackScore?: number;
  };
  shippingOptions?: Array<{
    shippingCost?: EbayMoney;
    type?: string;
  }>;
  itemLocation?: {
    city?: string;
    stateOrProvince?: string;
    postalCode?: string;
    country?: string;
  };
  condition?: string;
  conditionId?: string;
  categories?: Array<{ categoryId?: string; categoryName?: string }>;
};

type EbayBrowseSearchResponse = {
  href?: string;
  total?: number;
  limit?: number;
  offset?: number;
  next?: string;
  itemSummaries?: EbayItemSummary[];
  warnings?: Array<{ errorId?: number; message?: string }>;
};

type EbayScanTarget = {
  id: string;
  identity_key: string;
  subject_id: string | null;
  display_name: string;
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
  subject_name: string;
};

export type EbayMarketIntelScanOptions = {
  identityIds?: string[];
  maxTargets?: number;
  resultsPerTarget?: number;
  minimumConfidence?: number;
};

let tokenCache: EbayTokenCache | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return Array.from(
    new Set(
      normalize(value)
        .split(" ")
        .filter((token) => token.length >= 2),
    ),
  );
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function locationText(item: EbayItemSummary) {
  return [
    item.itemLocation?.city,
    item.itemLocation?.stateOrProvince,
    item.itemLocation?.postalCode,
    item.itemLocation?.country,
  ]
    .filter(Boolean)
    .join(", ") || null;
}

function yearVariants(value: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const variants = new Set([normalize(raw)]);
  const match = raw.match(/(20\d{2})\D+(\d{2,4})/);
  if (match) {
    const first = match[1];
    const second = match[2].length === 2 ? `20${match[2]}` : match[2];
    variants.add(normalize(`${first}-${match[2]}`));
    variants.add(normalize(`${first} ${match[2]}`));
    variants.add(normalize(`${first}-${second}`));
    variants.add(normalize(`${first} ${second}`));
  }
  return Array.from(variants).filter(Boolean);
}

function hasAllTokens(title: string, value: string | null | undefined) {
  const required = tokens(value);
  return required.length > 0 && required.every((token) => title.includes(token));
}

function hasAnyToken(title: string, value: string | null | undefined) {
  return tokens(value).some((token) => title.includes(token));
}

function cardNumberEvidence(title: string, cardNumber: string | null) {
  const raw = String(cardNumber || "").trim();
  if (!raw) return false;
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:#|no\\.?\\s*|card\\s*)${escaped}(?:\\b|$)`, "i"),
    new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(title));
}

const blockedListingTerms = [
  "custom",
  "reprint",
  "proxy",
  "digital card",
  "mystery pack",
  "mystery box",
  "you pick",
  "break spot",
  "case break",
];

const gradedPattern = /\b(psa|bgs|sgc|cgc|csg|tag|hga)\s*(10|9\.5|9|8\.5|8|7\.5|7)?\b|\bgraded\b/i;

export function scoreEbayIdentityMatch(
  target: EbayScanTarget,
  item: EbayItemSummary,
) {
  const rawTitle = String(item.title || "");
  const title = normalize(rawTitle);
  const reasons: string[] = [];
  let score = 0;

  if (blockedListingTerms.some((term) => title.includes(normalize(term)))) {
    return { score: 0, reasons: ["Blocked custom, reprint, digital, mystery, or break listing term."] };
  }

  if (hasAllTokens(title, target.subject_name)) {
    score += 35;
    reasons.push("Player name matched.");
  } else {
    reasons.push("Player name did not fully match.");
  }

  if (cardNumberEvidence(rawTitle, target.card_number)) {
    score += 20;
    reasons.push("Card number matched.");
  } else {
    score -= 20;
    reasons.push("Card number evidence missing.");
  }

  const years = yearVariants(target.season_year);
  if (years.length === 0 || years.some((year) => title.includes(year))) {
    score += years.length > 0 ? 10 : 0;
    if (years.length > 0) reasons.push("Year or season matched.");
  } else {
    score -= 10;
    reasons.push("Year or season did not match.");
  }

  const productEvidence = [
    target.manufacturer,
    target.product_line,
    target.set_name,
    target.insert_name,
  ]
    .filter(Boolean)
    .map((value) => ({
      value: String(value),
      matched: hasAnyToken(title, String(value)),
    }));
  const matchedProductFields = productEvidence.filter((field) => field.matched).length;
  score += Math.min(20, matchedProductFields * 5);
  if (matchedProductFields > 0) {
    reasons.push(`${matchedProductFields} product or set field${matchedProductFields === 1 ? "" : "s"} matched.`);
  }

  const parallel = normalize(target.parallel_name);
  if (parallel && parallel !== "base") {
    if (hasAllTokens(title, target.parallel_name)) {
      score += 20;
      reasons.push("Parallel matched.");
    } else {
      score -= 25;
      reasons.push("Required parallel was not found.");
    }
  }

  if (target.variation_name) {
    if (hasAllTokens(title, target.variation_name)) {
      score += 10;
      reasons.push("Variation matched.");
    } else {
      score -= 15;
      reasons.push("Required variation was not found.");
    }
  }

  const titleLooksGraded = gradedPattern.test(rawTitle);
  if (target.condition_type === "raw") {
    if (titleLooksGraded) {
      score -= 50;
      reasons.push("Raw identity conflicts with graded listing title.");
    } else {
      score += 10;
      reasons.push("No graded-card conflict detected.");
    }
  } else if (target.condition_type === "graded") {
    const companyMatched = target.grading_company
      ? title.includes(normalize(target.grading_company))
      : false;
    const gradeMatched = target.grade
      ? new RegExp(`(?:^|\\s)${String(target.grade).replace(".", "\\.")}(?:\\s|$)`, "i").test(rawTitle)
      : false;
    if (companyMatched) score += 10;
    else score -= 20;
    if (gradeMatched) score += 10;
    else score -= 20;
    reasons.push(
      `Graded identity: company ${companyMatched ? "matched" : "missing"}; grade ${gradeMatched ? "matched" : "missing"}.`,
    );
  }

  if (target.autograph) {
    if (/\b(auto|autograph|signed)\b/i.test(rawTitle)) score += 10;
    else score -= 25;
  } else if (/\b(auto|autograph|signed)\b/i.test(rawTitle)) {
    score -= 15;
  }

  if (target.memorabilia) {
    if (/\b(relic|patch|jersey|memorabilia|game used)\b/i.test(rawTitle)) score += 10;
    else score -= 20;
  }

  return { score: clamp(score), reasons };
}

async function getEbayApplicationToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = requiredEnv("EBAY_CLIENT_ID");
  const clientSecret = requiredEnv("EBAY_CLIENT_SECRET");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || `eBay OAuth failed (${response.status}).`,
    );
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + numberValue(payload.expires_in, 7200) * 1000,
  };
  return tokenCache.accessToken;
}

async function getEbayScanTargets(
  identityIds: string[] | undefined,
  maxTargets: number,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  let identityQuery = supabase
    .from("tcos_mi_collectible_identities")
    .select(
      "id,identity_key,subject_id,display_name,season_year,manufacturer,product_line,set_name,insert_name,card_number,parallel_name,variation_name,condition_type,grading_company,grade,autograph,memorabilia",
    )
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(maxTargets);

  if (identityIds?.length) {
    identityQuery = identityQuery.in("id", identityIds.slice(0, maxTargets));
  }

  const { data: identities, error: identityError } = await identityQuery;
  if (identityError) throw new Error(identityError.message);

  const subjectIds = Array.from(
    new Set(
      (identities || [])
        .map((identity) => identity.subject_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const { data: subjects, error: subjectError } = subjectIds.length
    ? await supabase
        .from("tcos_mi_subjects")
        .select("id,name")
        .in("id", subjectIds)
    : { data: [], error: null };
  if (subjectError) throw new Error(subjectError.message);

  const subjectById = new Map(
    (subjects || []).map((subject) => [String(subject.id), String(subject.name)]),
  );

  return (identities || [])
    .filter((identity) => identity.subject_id && subjectById.has(identity.subject_id))
    .map((identity) => ({
      ...identity,
      subject_name: subjectById.get(identity.subject_id)!,
    })) as EbayScanTarget[];
}

export function buildEbaySearchQuery(target: EbayScanTarget) {
  const parts = [
    target.subject_name,
    target.season_year,
    target.manufacturer,
    target.product_line,
    target.set_name,
    target.insert_name,
    target.card_number ? `#${target.card_number}` : null,
    normalize(target.parallel_name) !== "base" ? target.parallel_name : null,
    target.variation_name,
    target.condition_type === "graded" ? target.grading_company : null,
    target.condition_type === "graded" ? target.grade : null,
    target.autograph ? "autograph" : null,
  ];
  return Array.from(new Set(parts.filter(Boolean).map((part) => String(part).trim())))
    .join(" ")
    .slice(0, 350);
}

async function searchEbayItems(
  token: string,
  query: string,
  limit: number,
) {
  const url = new URL(
    "https://api.ebay.com/buy/browse/v1/item_summary/search",
  );
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "newlyListed");
  url.searchParams.set("fieldgroups", "EXTENDED");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as EbayBrowseSearchResponse & {
    errors?: Array<{ errorId?: number; message?: string; longMessage?: string }>;
  };
  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage || error?.message || `eBay Browse search failed (${response.status}).`,
    );
  }
  return payload;
}

function listingFormat(item: EbayItemSummary) {
  const options = item.buyingOptions || [];
  if (options.includes("AUCTION")) return "auction";
  if (options.includes("BEST_OFFER")) return "best_offer";
  if (options.includes("FIXED_PRICE")) return "fixed_price";
  return "unknown";
}

function shippingPrice(item: EbayItemSummary) {
  const costs = (item.shippingOptions || [])
    .map((option) => numberValue(option.shippingCost?.value, Number.NaN))
    .filter(Number.isFinite);
  return costs.length ? Math.min(...costs) : 0;
}

function itemPrice(item: EbayItemSummary) {
  return numberValue(
    item.currentBidPrice?.value ?? item.price?.value,
    Number.NaN,
  );
}

function imageUrls(item: EbayItemSummary) {
  return Array.from(
    new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((image) => image.imageUrl)]
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export async function scanEbayForMarketIntel(
  options: EbayMarketIntelScanOptions = {},
) {
  const maxTargets = clamp(Math.round(options.maxTargets || 10), 1, 25);
  const resultsPerTarget = clamp(
    Math.round(options.resultsPerTarget || 10),
    1,
    25,
  );
  const minimumConfidence = clamp(options.minimumConfidence || 70, 0, 100);
  const token = await getEbayApplicationToken();
  const targets = await getEbayScanTargets(options.identityIds, maxTargets);

  const bestCandidateByItem = new Map<
    string,
    {
      target: EbayScanTarget;
      item: EbayItemSummary;
      confidence: number;
      reasons: string[];
      query: string;
    }
  >();
  const targetResults: Array<{
    identityId: string;
    displayName: string;
    query: string;
    returned: number;
    accepted: number;
    error?: string;
  }> = [];

  for (const target of targets) {
    const query = buildEbaySearchQuery(target);
    try {
      const response = await searchEbayItems(token, query, resultsPerTarget);
      let accepted = 0;
      for (const item of response.itemSummaries || []) {
        const itemId = item.legacyItemId || item.itemId;
        const directUrl = item.itemWebUrl || item.itemAffiliateWebUrl;
        const price = itemPrice(item);
        if (!itemId || !directUrl || !item.title || !Number.isFinite(price)) continue;

        const match = scoreEbayIdentityMatch(target, item);
        if (match.score < minimumConfidence) continue;
        accepted += 1;
        const current = bestCandidateByItem.get(itemId);
        if (!current || match.score > current.confidence) {
          bestCandidateByItem.set(itemId, {
            target,
            item,
            confidence: match.score,
            reasons: match.reasons,
            query,
          });
        }
      }
      targetResults.push({
        identityId: target.id,
        displayName: target.display_name,
        query,
        returned: response.itemSummaries?.length || 0,
        accepted,
      });
    } catch (error) {
      targetResults.push({
        identityId: target.id,
        displayName: target.display_name,
        query,
        returned: 0,
        accepted: 0,
        error: error instanceof Error ? error.message : "Unknown eBay search error.",
      });
    }
  }

  const candidates = Array.from(bestCandidateByItem.values())
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 100);
  const ingestItems: MarketIntelIngestItem[] = candidates.map(
    ({ target, item, confidence, reasons, query }) => ({
      marketplaceSlug: "ebay",
      collectibleIdentityId: target.id,
      collectibleIdentityKey: target.identity_key,
      externalListingId: item.legacyItemId || item.itemId || null,
      directUrl: item.itemWebUrl || item.itemAffiliateWebUrl || "",
      originalTitle: item.title || "",
      description: item.shortDescription || null,
      imageUrls: imageUrls(item),
      listingFormat: listingFormat(item),
      askingPrice: itemPrice(item),
      shippingPrice: shippingPrice(item),
      buyerFee: 0,
      currency: item.price?.currency || item.currentBidPrice?.currency || "USD",
      quantity: 1,
      sellerName: item.seller?.username || null,
      sellerRating: item.seller?.feedbackPercentage
        ? numberValue(item.seller.feedbackPercentage)
        : null,
      sellerFeedbackCount: item.seller?.feedbackScore || null,
      locationText: locationText(item),
      listedAt: item.itemCreationDate || null,
      lastSeenAt: new Date().toISOString(),
      auctionEndAt: item.itemEndDate || null,
      identityMatchConfidence: confidence,
      identityMatchMethod: "ebay_deterministic_title_match",
      suspectedMislisting: confidence >= 90 && normalize(item.title).includes("rookie") === false && Boolean(target.card_number),
      mislistingReason: null,
      metadata: {
        source_adapter: "ebay_browse_api",
        ebay_rest_item_id: item.itemId || null,
        ebay_legacy_item_id: item.legacyItemId || null,
        ebay_condition: item.condition || null,
        ebay_condition_id: item.conditionId || null,
        ebay_categories: item.categories || [],
        ebay_search_query: query,
        identity_match_reasons: reasons,
        resale_fee_pct: 13.5,
        sell_through_pct: 100,
        expected_outbound_shipping: 0,
        expected_supplies: 0,
      },
    }),
  );

  const ingest = ingestItems.length
    ? await ingestMarketIntelListings(ingestItems)
    : {
        received: 0,
        created: 0,
        updated: 0,
        rejected: 0,
        errors: 0,
        priceChanges: 0,
        scored: 0,
        results: [],
      };

  return {
    scannedAt: new Date().toISOString(),
    targetCount: targets.length,
    minimumConfidence,
    resultsPerTarget,
    candidatesAccepted: candidates.length,
    targetResults,
    ingest,
  };
}
