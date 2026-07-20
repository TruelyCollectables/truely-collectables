import "server-only";

import { revalidatePath } from "next/cache";
import { syncAllMarketIntelAlerts } from "./market-intel-alert-sync";
import {
  deliverPendingMarketIntelAlerts,
  getMarketIntelDeliveryConfig,
} from "./market-intel-delivery";
import {
  buildEbaySearchQuery,
  scoreEbayIdentityMatch,
} from "./market-intel-ebay";
import {
  buildEbayProfitHunterQueries,
  minimumConfidenceForEbayQuery,
  type EbayProfitHunterQueryMode,
  type EbayProfitHunterQuerySpec,
} from "./market-intel-ebay-queries";
import {
  ingestMarketIntelListings,
  type MarketIntelIngestItem,
} from "./market-intel-ingestion";
import { getMarketIntelSource } from "./market-intel-sources";
import { createSupabaseServerClient } from "./supabase-server";

type Money = { value?: string; currency?: string };

type EbayItem = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  shortDescription?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  price?: Money;
  currentBidPrice?: Money;
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
  shippingOptions?: Array<{ shippingCost?: Money }>;
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

type WatchRow = {
  subject_id: string;
  priority: number | null;
  minimum_discount_pct: number | null;
  minimum_estimated_net_profit: number | null;
  notes: string | null;
};

type SubjectRow = {
  id: string;
  name: string;
  priority: number | null;
  league_or_brand: string | null;
  team_or_affiliation: string | null;
  notes: string | null;
};

type IdentityRow = {
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
  serial_numbered_to: number | null;
};

type ValueRow = {
  collectible_identity_id: string;
  conservative_value: number | null;
  sample_size: number | null;
  confidence_score: number | null;
  liquidity_score: number | null;
};

type HotIdentity = IdentityRow & {
  subject_name: string;
  subject_score: number;
  hot_score: number;
};

type TokenCache = { token: string; expiresAt: number };

export type ProfitHunterHotWatchOptions = {
  maxSubjects?: number;
  maxIdentities?: number;
  resultsPerQuery?: number;
  minimumConfidence?: number;
  maxQueriesPerIdentity?: number;
};

type Candidate = {
  identity: HotIdentity;
  item: EbayItem;
  confidence: number;
  reasons: string[];
  spec: EbayProfitHunterQuerySpec;
  gaps: string[];
  categoryWarning: string | null;
  priorityScore: number;
  listingAgeHours: number | null;
  auctionHoursRemaining: number | null;
  imageReviewRecommended: boolean;
};

let tokenCache: TokenCache | null = null;

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalized(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return normalized(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function hasAllTokens(title: string, value: string | null | undefined) {
  const expected = tokens(value);
  return expected.length > 0 && expected.every((token) => title.includes(token));
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function itemPrice(item: EbayItem) {
  return num(item.currentBidPrice?.value ?? item.price?.value, Number.NaN);
}

function shippingPrice(item: EbayItem) {
  const prices = (item.shippingOptions || [])
    .map((option) => num(option.shippingCost?.value, Number.NaN))
    .filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : 0;
}

function listingFormat(
  item: EbayItem,
): "auction" | "best_offer" | "fixed_price" | "unknown" {
  const options = item.buyingOptions || [];
  if (options.includes("AUCTION")) return "auction";
  if (options.includes("BEST_OFFER")) return "best_offer";
  if (options.includes("FIXED_PRICE")) return "fixed_price";
  return "unknown";
}

function images(item: EbayItem) {
  return Array.from(
    new Set(
      [
        item.image?.imageUrl,
        ...(item.additionalImages || []).map((image) => image.imageUrl),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function location(item: EbayItem) {
  return (
    [
      item.itemLocation?.city,
      item.itemLocation?.stateOrProvince,
      item.itemLocation?.postalCode,
      item.itemLocation?.country,
    ]
      .filter(Boolean)
      .join(", ") || null
  );
}

function hoursFromNow(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return (timestamp - Date.now()) / 3_600_000;
}

function listingAgeHours(value: string | null | undefined) {
  const remaining = hoursFromNow(value);
  return remaining === null ? null : Math.max(0, -remaining);
}

function freshnessPoints(ageHours: number | null) {
  if (ageHours === null) return 0;
  if (ageHours <= 6) return 9;
  if (ageHours <= 24) return 6;
  if (ageHours <= 72) return 3;
  return 0;
}

function auctionUrgencyPoints(item: EbayItem, hoursRemaining: number | null) {
  if (listingFormat(item) !== "auction" || hoursRemaining === null) return 0;
  if (hoursRemaining > 0 && hoursRemaining <= 6) return 14;
  if (hoursRemaining <= 24) return 10;
  if (hoursRemaining <= 72) return 6;
  return 0;
}

function queryModePoints(mode: EbayProfitHunterQueryMode) {
  if (mode === "exact") return 12;
  if (mode === "wrong_category" || mode === "typo") return 10;
  if (mode === "card_number" || mode === "set_parallel") return 8;
  if (mode === "loose" || mode === "player_variant") return 6;
  return 2;
}

function categoryWarning(item: EbayItem) {
  const names = (item.categories || [])
    .map((category) => String(category.categoryName || "").trim())
    .filter(Boolean);
  if (!names.length) return null;
  const text = normalized(names.join(" "));
  const expectedCardCategory =
    text.includes("trading card") ||
    text.includes("sports card") ||
    text.includes("card single") ||
    text.includes("collectible card");
  return expectedCardCategory
    ? null
    : `unexpected eBay category: ${names.slice(0, 2).join(" / ")}`;
}

function titleGaps(identity: HotIdentity, rawTitle: string) {
  const title = normalized(rawTitle);
  const gaps: string[] = [];
  if (!hasAllTokens(title, identity.subject_name)) gaps.push("player name");
  if (identity.season_year && !title.includes(normalized(identity.season_year))) {
    gaps.push("year or season");
  }
  if (identity.card_number) {
    const cardNumber = normalized(identity.card_number);
    if (!title.includes(cardNumber)) gaps.push("card number");
  }
  for (const [label, value] of [
    ["product line", identity.product_line],
    ["set", identity.set_name],
    ["insert", identity.insert_name],
    ["variation", identity.variation_name],
  ] as const) {
    if (value && !hasAllTokens(title, value)) gaps.push(label);
  }
  if (
    normalized(identity.parallel_name) !== "base" &&
    !hasAllTokens(title, identity.parallel_name)
  ) {
    gaps.push("parallel");
  }
  if (identity.autograph && !/\b(auto|autograph|signed)\b/i.test(rawTitle)) {
    gaps.push("autograph");
  }
  if (
    identity.memorabilia &&
    !/\b(relic|patch|jersey|memorabilia|game used)\b/i.test(rawTitle)
  ) {
    gaps.push("memorabilia");
  }
  if (
    identity.condition_type === "graded" &&
    identity.grading_company &&
    !title.includes(normalized(identity.grading_company))
  ) {
    gaps.push("grading company");
  }
  return Array.from(new Set(gaps));
}

function shouldSkipStaleItem(item: EbayItem) {
  const age = listingAgeHours(item.itemCreationDate);
  const ending = hoursFromNow(item.itemEndDate);
  if (age === null || age <= 24 * 30) return false;
  return !(listingFormat(item) === "auction" && ending !== null && ending > 0 && ending <= 72);
}

async function ebayToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const credentials = Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
  ).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
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
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `eBay OAuth failed (${response.status}).`,
    );
  }
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + num(payload.expires_in, 7200) * 1000,
  };
  return tokenCache.token;
}

async function ebaySearch(token: string, query: string, limit: number) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
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
  const payload = (await response.json()) as {
    itemSummaries?: EbayItem[];
    errors?: Array<{ message?: string; longMessage?: string }>;
  };
  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage ||
        error?.message ||
        `eBay Profit Hunter search failed (${response.status}).`,
    );
  }
  return payload.itemSummaries || [];
}

function premiumPoints(identity: IdentityRow) {
  let score = 0;
  if (identity.card_number) score += 15;
  if (normalized(identity.parallel_name) !== "base") score += 10;
  if (identity.insert_name) score += 6;
  if (identity.variation_name) score += 6;
  if (identity.serial_numbered_to) score += 8;
  if (identity.autograph) score += 8;
  if (identity.memorabilia) score += 5;
  if (identity.condition_type === "raw") score += 4;
  return score;
}

async function hotTargets(maxSubjects: number, maxIdentities: number) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: watchData, error: watchError } = await supabase
    .from("tcos_mi_watchlist")
    .select(
      "subject_id,priority,minimum_discount_pct,minimum_estimated_net_profit,notes",
    )
    .eq("active", true)
    .not("subject_id", "is", null);
  if (watchError) throw new Error(watchError.message);

  const watches = (watchData || []) as WatchRow[];
  const subjectIds = Array.from(
    new Set(watches.map((row) => String(row.subject_id)).filter(Boolean)),
  );
  if (!subjectIds.length) {
    return { subjects: [] as SubjectRow[], identities: [] as HotIdentity[] };
  }

  const [subjectResult, identityResult] = await Promise.all([
    supabase
      .from("tcos_mi_subjects")
      .select("id,name,priority,league_or_brand,team_or_affiliation,notes")
      .eq("active", true)
      .in("id", subjectIds),
    supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,identity_key,subject_id,display_name,season_year,manufacturer,product_line,set_name,insert_name,card_number,parallel_name,variation_name,condition_type,grading_company,grade,autograph,memorabilia,serial_numbered_to",
      )
      .eq("active", true)
      .in("subject_id", subjectIds),
  ]);
  if (subjectResult.error) throw new Error(subjectResult.error.message);
  if (identityResult.error) throw new Error(identityResult.error.message);

  const identities = (identityResult.data || []) as IdentityRow[];
  const identityIds = identities.map((identity) => identity.id);
  let values: ValueRow[] = [];
  let mislistedIdentityIds = new Set<string>();
  if (identityIds.length) {
    const [valueResult, listingResult] = await Promise.all([
      supabase
        .from("tcos_mi_market_values")
        .select(
          "collectible_identity_id,conservative_value,sample_size,confidence_score,liquidity_score,calculated_at",
        )
        .in("collectible_identity_id", identityIds)
        .order("calculated_at", { ascending: false }),
      supabase
        .from("tcos_mi_listings")
        .select("collectible_identity_id,suspected_mislisting")
        .eq("status", "active")
        .eq("suspected_mislisting", true)
        .in("collectible_identity_id", identityIds),
    ]);
    if (valueResult.error) throw new Error(valueResult.error.message);
    if (listingResult.error) throw new Error(listingResult.error.message);
    values = (valueResult.data || []) as ValueRow[];
    mislistedIdentityIds = new Set(
      (listingResult.data || [])
        .map((row) => row.collectible_identity_id)
        .filter((value): value is string => Boolean(value)),
    );
  }

  const latestValue = new Map<string, ValueRow>();
  for (const value of values) {
    if (!latestValue.has(value.collectible_identity_id)) {
      latestValue.set(value.collectible_identity_id, value);
    }
  }
  const watchBySubject = new Map(
    watches.map((watch) => [String(watch.subject_id), watch]),
  );
  const identitiesBySubject = new Map<string, IdentityRow[]>();
  for (const identity of identities) {
    if (!identity.subject_id) continue;
    const rows = identitiesBySubject.get(identity.subject_id) || [];
    rows.push(identity);
    identitiesBySubject.set(identity.subject_id, rows);
  }

  const rankedSubjects = ((subjectResult.data || []) as SubjectRow[])
    .map((subject) => {
      const watch = watchBySubject.get(subject.id);
      const subjectIdentities = identitiesBySubject.get(subject.id) || [];
      const notes = `${watch?.notes || ""} ${subject.notes || ""}`;
      let score = Math.max(num(watch?.priority), num(subject.priority));
      if (notes.includes("[GROWTH_PROSPECT]")) score += 14;
      if (notes.includes("[FIRST_BOWMAN_CHROME_ONLY]")) score += 10;
      score += Math.min(18, subjectIdentities.length * 3);
      if (subjectIdentities.some((identity) => identity.card_number)) score += 6;
      if (
        subjectIdentities.some(
          (identity) => num(latestValue.get(identity.id)?.confidence_score) >= 50,
        )
      ) {
        score += 6;
      }
      if (
        subjectIdentities.some((identity) =>
          mislistedIdentityIds.has(identity.id),
        )
      ) {
        score += 12;
      }
      if (num(watch?.minimum_discount_pct) >= 20) score += 3;
      if (num(watch?.minimum_estimated_net_profit) >= 15) score += 3;
      return { subject, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.subject.name.localeCompare(right.subject.name),
    )
    .slice(0, maxSubjects);

  const selectedSubjectIds = new Set(
    rankedSubjects.map((row) => row.subject.id),
  );
  const subjectNames = new Map(
    rankedSubjects.map((row) => [row.subject.id, row.subject.name]),
  );
  const subjectScores = new Map(
    rankedSubjects.map((row) => [row.subject.id, row.score]),
  );

  const rankedIdentities = identities
    .filter(
      (identity) =>
        identity.subject_id && selectedSubjectIds.has(identity.subject_id),
    )
    .map((identity): HotIdentity => {
      const market = latestValue.get(identity.id);
      const value = num(market?.conservative_value);
      let score =
        num(subjectScores.get(String(identity.subject_id))) +
        premiumPoints(identity) +
        Math.min(10, num(market?.sample_size)) +
        num(market?.confidence_score) / 10 +
        num(market?.liquidity_score) / 20;
      if (value >= 5 && value <= 250) score += 6;
      if (value >= 10 && value <= 75) score += 4;
      if (mislistedIdentityIds.has(identity.id)) score += 12;
      return {
        ...identity,
        subject_name:
          subjectNames.get(String(identity.subject_id)) || "Tracked player",
        subject_score: num(subjectScores.get(String(identity.subject_id))),
        hot_score: score,
      };
    })
    .sort(
      (left, right) =>
        right.hot_score - left.hot_score ||
        left.display_name.localeCompare(right.display_name),
    );

  const selected: HotIdentity[] = [];
  for (const ranked of rankedSubjects) {
    const best = rankedIdentities.find(
      (identity) => identity.subject_id === ranked.subject.id,
    );
    if (best) selected.push(best);
  }
  for (const identity of rankedIdentities) {
    if (selected.length >= maxIdentities) break;
    if (selected.some((row) => row.id === identity.id)) continue;
    const samePlayer = selected.filter(
      (row) => row.subject_id === identity.subject_id,
    ).length;
    if (samePlayer >= 2) continue;
    selected.push(identity);
  }

  return {
    subjects: rankedSubjects.map((row) => row.subject),
    identities: selected.slice(0, maxIdentities),
  };
}

function mislistingReason(candidate: Candidate) {
  const signals = [...candidate.gaps];
  if (candidate.categoryWarning) signals.push(candidate.categoryWarning);
  if (!signals.length) return null;
  return `Profit Hunter ${candidate.spec.mode.replaceAll("_", " ")} search found: ${signals.join(", ")}.`;
}

export async function runMarketIntelProfitHunterHotWatch(
  options: ProfitHunterHotWatchOptions = {},
) {
  const maxSubjects = clamp(Math.round(options.maxSubjects || 3), 1, 3);
  const maxIdentities = clamp(Math.round(options.maxIdentities || 4), 1, 6);
  const resultsPerQuery = clamp(
    Math.round(options.resultsPerQuery || 5),
    3,
    8,
  );
  const minimumConfidence = clamp(num(options.minimumConfidence, 55), 45, 90);
  const maxQueriesPerIdentity = clamp(
    Math.round(options.maxQueriesPerIdentity || 8),
    2,
    10,
  );
  const targets = await hotTargets(maxSubjects, maxIdentities);
  if (!targets.identities.length) {
    return {
      scannedAt: new Date().toISOString(),
      skipped: true,
      reason: "No active exact-card identities exist for the current top search targets.",
      source: getMarketIntelSource("ebay"),
      subjects: targets.subjects.map((subject) => subject.name),
      identities: [],
    };
  }

  const token = await ebayToken();
  const bestByItem = new Map<string, Candidate>();
  const results: Array<{
    identityId: string;
    displayName: string;
    query: string;
    mode: EbayProfitHunterQueryMode;
    intent: string;
    returned: number;
    accepted: number;
    staleSkipped: number;
    error?: string;
  }> = [];

  for (const identity of targets.identities) {
    const queries = buildEbayProfitHunterQueries(
      identity,
      buildEbaySearchQuery(identity),
      maxQueriesPerIdentity,
    );

    for (const spec of queries) {
      try {
        const items = await ebaySearch(token, spec.query, resultsPerQuery);
        let accepted = 0;
        let staleSkipped = 0;
        for (const item of items) {
          const itemId = item.legacyItemId || item.itemId;
          const directUrl = item.itemWebUrl || item.itemAffiliateWebUrl;
          const price = itemPrice(item);
          if (!itemId || !directUrl || !item.title || !Number.isFinite(price)) {
            continue;
          }
          if (shouldSkipStaleItem(item)) {
            staleSkipped += 1;
            continue;
          }

          const match = scoreEbayIdentityMatch(identity, item);
          const threshold = minimumConfidenceForEbayQuery(
            spec.mode,
            minimumConfidence,
          );
          if (match.score < threshold) continue;

          const gaps = titleGaps(identity, item.title);
          const category = categoryWarning(item);
          const age = listingAgeHours(item.itemCreationDate);
          const auctionRemaining = hoursFromNow(item.itemEndDate);
          const imageReviewRecommended =
            spec.requiresImageReview ||
            Boolean(category) ||
            gaps.some((gap) =>
              ["player name", "card number", "parallel", "variation"].includes(gap),
            );
          const priorityScore =
            match.score +
            queryModePoints(spec.mode) +
            freshnessPoints(age) +
            auctionUrgencyPoints(item, auctionRemaining);
          const candidate: Candidate = {
            identity,
            item,
            confidence: match.score,
            reasons: match.reasons,
            spec,
            gaps,
            categoryWarning: category,
            priorityScore,
            listingAgeHours: age,
            auctionHoursRemaining: auctionRemaining,
            imageReviewRecommended,
          };
          accepted += 1;
          const current = bestByItem.get(itemId);
          if (
            !current ||
            candidate.priorityScore > current.priorityScore ||
            (candidate.priorityScore === current.priorityScore &&
              candidate.confidence > current.confidence)
          ) {
            bestByItem.set(itemId, candidate);
          }
        }
        results.push({
          identityId: identity.id,
          displayName: identity.display_name,
          query: spec.query,
          mode: spec.mode,
          intent: spec.intent,
          returned: items.length,
          accepted,
          staleSkipped,
        });
      } catch (error) {
        results.push({
          identityId: identity.id,
          displayName: identity.display_name,
          query: spec.query,
          mode: spec.mode,
          intent: spec.intent,
          returned: 0,
          accepted: 0,
          staleSkipped: 0,
          error:
            error instanceof Error ? error.message : "Unknown Profit Hunter error.",
        });
      }
    }
  }

  const candidates = Array.from(bestByItem.values())
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        right.confidence - left.confidence ||
        itemPrice(left.item) - itemPrice(right.item),
    )
    .slice(0, 60);

  const ingestItems: MarketIntelIngestItem[] = candidates.map((candidate) => {
    const { identity, item, confidence, reasons, spec, gaps } = candidate;
    const suspectedMislisting =
      Boolean(candidate.categoryWarning) ||
      (spec.mode !== "exact" && gaps.length > 0);
    return {
      marketplaceSlug: "ebay",
      collectibleIdentityId: identity.id,
      collectibleIdentityKey: identity.identity_key,
      externalListingId: item.legacyItemId || item.itemId || null,
      directUrl: item.itemWebUrl || item.itemAffiliateWebUrl || "",
      originalTitle: item.title || "",
      description: item.shortDescription || null,
      imageUrls: images(item),
      listingFormat: spec.mode === "lot" ? "lot" : listingFormat(item),
      askingPrice: itemPrice(item),
      shippingPrice: shippingPrice(item),
      buyerFee: 0,
      currency: item.price?.currency || item.currentBidPrice?.currency || "USD",
      quantity: 1,
      sellerName: item.seller?.username || null,
      sellerRating: item.seller?.feedbackPercentage
        ? num(item.seller.feedbackPercentage)
        : null,
      sellerFeedbackCount: item.seller?.feedbackScore || null,
      locationText: location(item),
      listedAt: item.itemCreationDate || null,
      lastSeenAt: new Date().toISOString(),
      auctionEndAt: item.itemEndDate || null,
      identityMatchConfidence: confidence,
      identityMatchMethod: `profit_hunter_${spec.mode}_title_match`,
      suspectedMislisting,
      mislistingReason: suspectedMislisting ? mislistingReason(candidate) : null,
      metadata: {
        source_adapter: "ebay_profit_hunter_hot_watch",
        profit_hunter: true,
        hot_watch: true,
        query_mode: spec.mode,
        query_intent: spec.intent,
        query_priority: spec.priority,
        candidate_priority_score: candidate.priorityScore,
        listing_age_hours: candidate.listingAgeHours,
        auction_hours_remaining: candidate.auctionHoursRemaining,
        image_review_recommended: candidate.imageReviewRecommended,
        image_review_reason: candidate.imageReviewRecommended
          ? "Broad, incomplete, typo, lot, or category evidence requires photo confirmation before a strong decision."
          : null,
        hot_watch_subject_score: identity.subject_score,
        hot_watch_identity_score: identity.hot_score,
        ebay_rest_item_id: item.itemId || null,
        ebay_legacy_item_id: item.legacyItemId || null,
        ebay_condition: item.condition || null,
        ebay_condition_id: item.conditionId || null,
        ebay_categories: item.categories || [],
        ebay_search_query: spec.query,
        identity_match_reasons: reasons,
        expected_marker_gaps: gaps,
        category_warning: candidate.categoryWarning,
        resale_fee_pct: 13.5,
        sell_through_pct: 100,
        expected_outbound_shipping: 0,
        expected_supplies: 0,
      },
    };
  });

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
  const alerts = await syncAllMarketIntelAlerts();

  let delivery: {
    attempted: boolean;
    delivered: number;
    emailId: string | null;
    error: string | null;
  } = {
    attempted: false,
    delivered: 0,
    emailId: null,
    error: null,
  };
  const deliveryConfig = getMarketIntelDeliveryConfig();
  if (alerts.created > 0 && deliveryConfig.enabled && deliveryConfig.configured) {
    delivery.attempted = true;
    try {
      const sent = await deliverPendingMarketIntelAlerts(3);
      delivery.delivered = sent.delivered;
      delivery.emailId = sent.emailId;
    } catch (error) {
      delivery.error =
        error instanceof Error
          ? error.message
          : "Unable to deliver Profit Hunter alerts.";
    }
  }

  for (const path of [
    "/admin/market-intel",
    "/admin/market-intel/watch-center",
    "/admin/market-intel/deals",
    "/admin/market-intel/reports",
    "/admin/market-intel/delivery",
  ]) {
    revalidatePath(path);
  }

  const source = getMarketIntelSource("ebay");
  return {
    scannedAt: new Date().toISOString(),
    skipped: false,
    source,
    subjects: targets.subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      affiliation:
        subject.team_or_affiliation || subject.league_or_brand || null,
    })),
    identities: targets.identities.map((identity) => ({
      id: identity.id,
      player: identity.subject_name,
      displayName: identity.display_name,
      score: Number(identity.hot_score.toFixed(2)),
    })),
    queryCount: results.length,
    queryFamilies: Array.from(new Set(results.map((result) => result.mode))),
    returned: results.reduce((sum, result) => sum + result.returned, 0),
    accepted: candidates.length,
    staleSkipped: results.reduce(
      (sum, result) => sum + result.staleSkipped,
      0,
    ),
    suspectedMislistings: candidates.filter((candidate) =>
      Boolean(candidate.categoryWarning) ||
      (candidate.spec.mode !== "exact" && candidate.gaps.length > 0),
    ).length,
    imageReviewRecommended: candidates.filter(
      (candidate) => candidate.imageReviewRecommended,
    ).length,
    ingest,
    alerts: {
      qualified: alerts.qualified,
      created: alerts.created,
      refreshed: alerts.refreshed,
      pending: alerts.pending.length,
    },
    delivery,
    targetResults: results,
  };
}
