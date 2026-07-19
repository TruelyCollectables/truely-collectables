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
  ingestMarketIntelListings,
  type MarketIntelIngestItem,
} from "./market-intel-ingestion";
import { createSupabaseServerClient } from "./supabase-server";

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
  itemSummaries?: EbayItemSummary[];
  errors?: Array<{ message?: string; longMessage?: string }>;
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
  sport_or_category: string | null;
  league_or_brand: string | null;
  team_or_affiliation: string | null;
  notes: string | null;
};

type HotWatchIdentity = {
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
  subject_name: string;
  subject_score: number;
  hot_score: number;
};

type ValueRow = {
  collectible_identity_id: string;
  conservative_value: number | null;
  sample_size: number | null;
  confidence_score: number | null;
  liquidity_score: number | null;
  calculated_at: string;
};

type ExistingListingRow = {
  collectible_identity_id: string | null;
  suspected_mislisting: boolean | null;
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

export type HotWatchOptions = {
  maxSubjects?: number;
  maxIdentities?: number;
  resultsPerQuery?: number;
  minimumConfidence?: number;
};

let tokenCache: TokenCache | null = null;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function imageUrls(item: EbayItemSummary) {
  return Array.from(
    new Set(
      [
        item.image?.imageUrl,
        ...(item.additionalImages || []).map((image) => image.imageUrl),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
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

function listingFormat(item: EbayItemSummary) {
  const options = item.buyingOptions || [];
  if (options.includes("AUCTION")) return "auction";
  if (options.includes("BEST_OFFER")) return "best_offer";
  if (options.includes("FIXED_PRICE")) return "fixed_price";
  return "unknown";
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

function expectedMarkerGaps(identity: HotWatchIdentity, title: string) {
  const normalizedTitle = normalize(title);
  const gaps: string[] = [];
  const cardNumber = normalize(identity.card_number);
  const productLine = normalize(identity.product_line);
  const parallel = normalize(identity.parallel_name);
  const variation = normalize(identity.variation_name);
  const insert = normalize(identity.insert_name);

  if (cardNumber && !normalizedTitle.includes(cardNumber)) gaps.push("card number");
  if (productLine && !normalizedTitle.includes(productLine)) gaps.push("product line");
  if (parallel && parallel !== "base" && !normalizedTitle.includes(parallel)) {
    gaps.push("parallel");
  }
  if (variation && !normalizedTitle.includes(variation)) gaps.push("variation");
  if (insert && !normalizedTitle.includes(insert)) gaps.push("insert");
  return gaps;
}

function looseSearchQuery(identity: HotWatchIdentity) {
  return Array.from(
    new Set(
      [
        identity.subject_name,
        identity.season_year,
        identity.manufacturer,
        identity.condition_type === "graded" ? identity.grading_company : null,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim()),
    ),
  )
    .join(" ")
    .slice(0, 350);
}

async function getEbayToken() {
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
    expiresAt: Date.now() + numberValue(payload.expires_in, 7200) * 1000,
  };
  return tokenCache.token;
}

async function searchEbay(token: string, query: string, limit: number) {
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
  const payload = (await response.json()) as EbayBrowseSearchResponse;
  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage ||
        error?.message ||
        `eBay Hot Watch search failed (${response.status}).`,
    );
  }
  return payload.itemSummaries || [];
}

function latestValueMap(rows: ValueRow[]) {
  const latest = new Map<string, ValueRow>();
  for (const row of rows) {
    if (!latest.has(row.collectible_identity_id)) {
      latest.set(row.collectible_identity_id, row);
    }
  }
  return latest;
}

function identityPremiumScore(identity: Omit<HotWatchIdentity, "subject_name" | "subject_score" | "hot_score">) {
  let score = 0;
  if (identity.card_number) score += 15;
  if (normalize(identity.parallel_name) !== "base") score += 10;
  if (identity.insert_name) score += 6;
  if (identity.variation_name) score += 6;
  if (identity.serial_numbered_to) score += 8;
  if (identity.autograph) score += 8;
  if (identity.memorabilia) score += 5;
  if (identity.condition_type === "raw") score += 4;
  return score;
}

async function loadHotWatchTargets(maxSubjects: number, maxIdentities: number) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: watchData, error: watchError } = await supabase
    .from("tcos_mi_watchlist")
    .select(
      "subject_id,priority,minimum_discount_pct,minimum_estimated_net_profit,notes",
    )
    .eq("active", true)
    .not("subject_id", "is", null);
  if (watchError) throw new Error(watchError.message);

  const watchRows = (watchData || []) as WatchRow[];
  const subjectIds = Array.from(
    new Set(watchRows.map((row) => String(row.subject_id)).filter(Boolean)),
  );
  if (subjectIds.length === 0) {
    return { subjects: [] as SubjectRow[], identities: [] as HotWatchIdentity[] };
  }

  const [subjectResult, identityResult] = await Promise.all([
    supabase
      .from("tcos_mi_subjects")
      .select(
        "id,name,priority,sport_or_category,league_or_brand,team_or_affiliation,notes",
      )
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

  const rawIdentities = (identityResult.data || []) as Array<
    Omit<HotWatchIdentity, "subject_name" | "subject_score" | "hot_score">
  >;
  const identityIds = rawIdentities.map((identity) => identity.id);
  const [valueResult, listingResult] = identityIds.length
    ? await Promise.all([
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
          .in("collectible_identity_id", identityIds),
      ])
    : [
        { data: [] as ValueRow[], error: null },
        { data: [] as ExistingListingRow[], error: null },
      ];
  if (valueResult.error) throw new Error(valueResult.error.message);
  if (listingResult.error) throw new Error(listingResult.error.message);

  const values = latestValueMap((valueResult.data || []) as ValueRow[]);
  const priorMislistings = new Set(
    ((listingResult.data || []) as ExistingListingRow[])
      .filter((row) => row.suspected_mislisting && row.collectible_identity_id)
      .map((row) => String(row.collectible_identity_id)),
  );
  const watchBySubject = new Map(
    watchRows.map((row) => [String(row.subject_id), row]),
  );
  const identitiesBySubject = new Map<string, typeof rawIdentities>();
  for (const identity of rawIdentities) {
    if (!identity.subject_id) continue;
    const rows = identitiesBySubject.get(identity.subject_id) || [];
    rows.push(identity);
    identitiesBySubject.set(identity.subject_id, rows);
  }

  const rankedSubjects = ((subjectResult.data || []) as SubjectRow[])
    .map((subject) => {
      const watch = watchBySubject.get(subject.id);
      const identities = identitiesBySubject.get(subject.id) || [];
      const notes = `${watch?.notes || ""} ${subject.notes || ""}`;
      let score = Math.max(
        numberValue(watch?.priority),
        numberValue(subject.priority),
      );
      if (notes.includes("[GROWTH_PROSPECT]")) score += 14;
      if (notes.includes("[FIRST_BOWMAN_CHROME_ONLY]")) score += 10;
      score += Math.min(18, identities.length * 3);
      if (identities.some((identity) => identity.card_number)) score += 6;
      if (
        identities.some((identity) => {
          const value = values.get(identity.id);
          return numberValue(value?.confidence_score) >= 50;
        })
      ) {
        score += 6;
      }
      if (identities.some((identity) => priorMislistings.has(identity.id))) {
        score += 12;
      }
      if (numberValue(watch?.minimum_discount_pct) >= 20) score += 3;
      if (numberValue(watch?.minimum_estimated_net_profit) >= 15) score += 3;
      return { subject, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.subject.name.localeCompare(right.subject.name),
    )
    .slice(0, maxSubjects);

  const selectedSubjectIds = new Set(
    rankedSubjects.map(({ subject }) => subject.id),
  );
  const subjectScoreById = new Map(
    rankedSubjects.map(({ subject, score }) => [subject.id, score]),
  );
  const subjectNameById = new Map(
    rankedSubjects.map(({ subject }) => [subject.id, subject.name]),
  );

  const rankedIdentities = rawIdentities
    .filter(
      (identity) =>
        identity.subject_id && selectedSubjectIds.has(identity.subject_id),
    )
    .map((identity): HotWatchIdentity => {
      const latest = values.get(identity.id);
      const market = numberValue(latest?.conservative_value);
      let hotScore =
        numberValue(subjectScoreById.get(String(identity.subject_id))) +
        identityPremiumScore(identity) +
        Math.min(10, numberValue(latest?.sample_size)) +
        numberValue(latest?.confidence_score) / 10 +
        numberValue(latest?.liquidity_score) / 20;
      if (market >= 5 && market <= 250) hotScore += 6;
      if (market >= 10 && market <= 75) hotScore += 4;
      if (priorMislistings.has(identity.id)) hotScore += 12;
      return {
        ...identity,
        subject_name:
          subjectNameById.get(String(identity.subject_id)) || "Tracked player",
        subject_score: numberValue(
          subjectScoreById.get(String(identity.subject_id)),
        ),
        hot_score: hotScore,
      };
    })
    .sort(
      (left, right) =>
        right.hot_score - left.hot_score ||
        left.display_name.localeCompare(right.display_name),
    );

  const selected: HotWatchIdentity[] = [];
  for (const { subject } of rankedSubjects) {
    const best = rankedIdentities.find(
      (identity) => identity.subject_id === subject.id,
    );
    if (best && !selected.some((identity) => identity.id === best.id)) {
      selected.push(best);
    }
  }
  for (const identity of rankedIdentities) {
    if (selected.length >= maxIdentities) break;
    if (selected.some((row) => row.id === identity.id)) continue;
    const sameSubject = selected.filter(
      (row) => row.subject_id === identity.subject_id,
    ).length;
    if (sameSubject >= 2) continue;
    selected.push(identity);
  }

  return {
    subjects: rankedSubjects.map(({ subject }) => subject),
    identities: selected.slice(0, maxIdentities),
  };
}

export async function runMarketIntelHotWatch(
  options: HotWatchOptions = {},
) {
  const maxSubjects = clamp(Math.round(options.maxSubjects || 3), 1, 3);
  const maxIdentities = clamp(Math.round(options.maxIdentities || 4), 1, 6);
  const resultsPerQuery = clamp(
    Math.round(options.resultsPerQuery || 6),
    3,
    10,
  );
  const minimumConfidence = clamp(
    numberValue(options.minimumConfidence, 55),
    45,
    90,
  );
  const targets = await loadHotWatchTargets(maxSubjects, maxIdentities);
  if (targets.identities.length === 0) {
    return {
      scannedAt: new Date().toISOString(),
      skipped: true,
      reason: "No active exact-card identities exist for the current top watchlist players.",
      subjects: targets.subjects.map((subject) => subject.name),
      identities: [],
    };
  }

  const token = await getEbayToken();
  const bestByItem = new Map<
    string,
    {
      identity: HotWatchIdentity;
      item: EbayItemSummary;
      confidence: number;
      reasons: string[];
      query: string;
      queryMode: "exact" | "loose";
      gaps: string[];
    }
  >();
  const targetResults: Array<{
    identityId: string;
    displayName: string;
    query: string;
    queryMode: "exact" | "loose";
    returned: number;
    accepted: number;
    error?: string;
  }> = [];

  for (const identity of targets.identities) {
    const queries: Array<{ query: string; mode: "exact" | "loose" }> = [
      { query: buildEbaySearchQuery(identity), mode: "exact" },
      { query: looseSearchQuery(identity), mode: "loose" },
    ].filter(
      (entry, index, rows) =>
        entry.query &&
        rows.findIndex((other) => other.query === entry.query) === index,
    );

    for (const { query, mode } of queries) {
      try {
        const items = await searchEbay(token, query, resultsPerQuery);
        let accepted = 0;
        for (const item of items) {
          const itemId = item.legacyItemId || item.itemId;
          const directUrl = item.itemWebUrl || item.itemAffiliateWebUrl;
          const price = itemPrice(item);
          if (!itemId || !directUrl || !item.title || !Number.isFinite(price)) {
            continue;
          }
          const match = scoreEbayIdentityMatch(identity, item);
          const threshold = mode === "loose" ? minimumConfidence : Math.max(65, minimumConfidence);
          if (match.score < threshold) continue;
          accepted += 1;
          const gaps = expectedMarkerGaps(identity, item.title);
          const current = bestByItem.get(itemId);
          if (!current || match.score > current.confidence) {
            bestByItem.set(itemId, {
              identity,
              item,
              confidence: match.score,
              reasons: match.reasons,
              query,
              queryMode: mode,
              gaps,
            });
          }
        }
        targetResults.push({
          identityId: identity.id,
          displayName: identity.display_name,
          query,
          queryMode: mode,
          returned: items.length,
          accepted,
        });
      } catch (error) {
        targetResults.push({
          identityId: identity.id,
          displayName: identity.display_name,
          query,
          queryMode: mode,
          returned: 0,
          accepted: 0,
          error:
            error instanceof Error ? error.message : "Unknown Hot Watch search error.",
        });
      }
    }
  }

  const candidates = Array.from(bestByItem.values())
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        itemPrice(left.item) - itemPrice(right.item),
    )
    .slice(0, 60);
  const ingestItems: MarketIntelIngestItem[] = candidates.map(
    ({ identity, item, confidence, reasons, query, queryMode, gaps }) => {
      const suspectedMislisting = queryMode === "loose" && gaps.length > 0;
      return {
        marketplaceSlug: "ebay",
        collectibleIdentityId: identity.id,
        collectibleIdentityKey: identity.identity_key,
        externalListingId: item.legacyItemId || item.itemId || null,
        directUrl: item.itemWebUrl || item.itemAffiliateWebUrl || "",
        originalTitle: item.title || "",
        description: item.shortDescription || null,
        imageUrls: imageUrls(item),
        listingFormat: listingFormat(item),
        askingPrice: itemPrice(item),
        shippingPrice: shippingPrice(item),
        buyerFee: 0,
        currency:
          item.price?.currency || item.currentBidPrice?.currency || "USD",
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
        identityMatchMethod:
          queryMode === "loose"
            ? "hot_watch_loose_title_match"
            : "hot_watch_exact_title_match",
        suspectedMislisting,
        mislistingReason: suspectedMislisting
          ? `Hot Watch found the exact-card evidence with weak or missing seller labels: ${gaps.join(", ")}.`
          : null,
        metadata: {
          source_adapter: "ebay_hot_watch",
          hot_watch: true,
          hot_watch_query_mode: queryMode,
          hot_watch_subject_score: identity.subject_score,
          hot_watch_identity_score: identity.hot_score,
          ebay_rest_item_id: item.itemId || null,
          ebay_legacy_item_id: item.legacyItemId || null,
          ebay_condition: item.condition || null,
          ebay_condition_id: item.conditionId || null,
          ebay_categories: item.categories || [],
          ebay_search_query: query,
          identity_match_reasons: reasons,
          expected_marker_gaps: gaps,
          resale_fee_pct: 13.5,
          sell_through_pct: 100,
          expected_outbound_shipping: 0,
          expected_supplies: 0,
        },
      };
    },
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
  const alerts = await syncAllMarketIntelAlerts();

  let delivery:
    | { attempted: false; reason: string }
    | {
        attempted: true;
        delivered: number;
        emailId: string | null;
        error: string | null;
      } = {
    attempted: false,
    reason: "No new actionable alert required immediate delivery.",
  };
  const deliveryConfig = getMarketIntelDeliveryConfig();
  if (alerts.created > 0 && deliveryConfig.enabled && deliveryConfig.configured) {
    try {
      const delivered = await deliverPendingMarketIntelAlerts(3);
      delivery = {
        attempted: true,
        delivered: delivered.delivered,
        emailId: delivered.emailId,
        error: null,
      };
    } catch (error) {
      delivery = {
        attempted: true,
        delivered: 0,
        emailId: null,
        error:
          error instanceof Error
            ? error.message
            : "Unable to deliver Hot Watch alerts.",
      };
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

  return {
    scannedAt: new Date().toISOString(),
    skipped: false,
    subjects: targets.subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      affiliation:
        subject.team_or_affiliation || subject.league_or_brand || null,
    })),
    identities: targets.identities.map((identity) => ({
      id: identity.id,
      displayName: identity.display_name,
      player: identity.subject_name,
      score: Number(identity.hot_score.toFixed(2)),
    })),
    queryCount: targetResults.length,
    returned: targetResults.reduce((sum, row) => sum + row.returned, 0),
    accepted: candidates.length,
    suspectedMislistings: candidates.filter(
      (candidate) =>
        candidate.queryMode === "loose" && candidate.gaps.length > 0,
    ).length,
    ingest,
    alerts: {
      qualified: alerts.qualified,
      created: alerts.created,
      refreshed: alerts.refreshed,
      pending: alerts.pending.length,
    },
    delivery,
    targetResults,
  };
}
