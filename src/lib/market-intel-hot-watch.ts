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

type QuerySpec = {
  query: string;
  mode: "exact" | "loose";
};

type TokenCache = { token: string; expiresAt: number };

export type HotWatchOptions = {
  maxSubjects?: number;
  maxIdentities?: number;
  resultsPerQuery?: number;
  minimumConfidence?: number;
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
  return [
    item.itemLocation?.city,
    item.itemLocation?.stateOrProvince,
    item.itemLocation?.postalCode,
    item.itemLocation?.country,
  ]
    .filter(Boolean)
    .join(", ") || null;
}

function looseQuery(identity: HotIdentity) {
  return [
    identity.subject_name,
    identity.season_year,
    identity.manufacturer,
    identity.condition_type === "graded" ? identity.grading_company : null,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter((value, index, rows) => rows.indexOf(value) === index)
    .join(" ")
    .slice(0, 350);
}

function missingExpectedLabels(identity: HotIdentity, title: string) {
  const text = normalized(title);
  const expected = [
    ["card number", identity.card_number],
    ["product line", identity.product_line],
    [
      "parallel",
      normalized(identity.parallel_name) === "base"
        ? null
        : identity.parallel_name,
    ],
    ["insert", identity.insert_name],
    ["variation", identity.variation_name],
  ] as const;
  return expected
    .filter(([, value]) => value && !text.includes(normalized(value)))
    .map(([label]) => label);
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
        `eBay Hot Watch search failed (${response.status}).`,
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
  const minimumConfidence = clamp(num(options.minimumConfidence, 55), 45, 90);
  const targets = await hotTargets(maxSubjects, maxIdentities);
  if (!targets.identities.length) {
    return {
      scannedAt: new Date().toISOString(),
      skipped: true,
      reason: "No active exact-card identities exist for the current top watchlist players.",
      subjects: targets.subjects.map((subject) => subject.name),
      identities: [],
    };
  }

  const token = await ebayToken();
  const bestByItem = new Map<
    string,
    {
      identity: HotIdentity;
      item: EbayItem;
      confidence: number;
      reasons: string[];
      query: string;
      mode: "exact" | "loose";
      gaps: string[];
    }
  >();
  const results: Array<{
    identityId: string;
    displayName: string;
    query: string;
    mode: "exact" | "loose";
    returned: number;
    accepted: number;
    error?: string;
  }> = [];

  for (const identity of targets.identities) {
    const querySpecs: QuerySpec[] = [
      { query: buildEbaySearchQuery(identity), mode: "exact" },
      { query: looseQuery(identity), mode: "loose" },
    ];
    const queries = querySpecs.filter(
      (entry, index, rows) =>
        Boolean(entry.query) &&
        rows.findIndex((other) => other.query === entry.query) === index,
    );

    for (const spec of queries) {
      try {
        const items = await ebaySearch(token, spec.query, resultsPerQuery);
        let accepted = 0;
        for (const item of items) {
          const itemId = item.legacyItemId || item.itemId;
          const directUrl = item.itemWebUrl || item.itemAffiliateWebUrl;
          const price = itemPrice(item);
          if (!itemId || !directUrl || !item.title || !Number.isFinite(price)) {
            continue;
          }
          const match = scoreEbayIdentityMatch(identity, item);
          const threshold =
            spec.mode === "loose"
              ? minimumConfidence
              : Math.max(65, minimumConfidence);
          if (match.score < threshold) continue;
          accepted += 1;
          const gaps = missingExpectedLabels(identity, item.title);
          const current = bestByItem.get(itemId);
          if (!current || match.score > current.confidence) {
            bestByItem.set(itemId, {
              identity,
              item,
              confidence: match.score,
              reasons: match.reasons,
              query: spec.query,
              mode: spec.mode,
              gaps,
            });
          }
        }
        results.push({
          identityId: identity.id,
          displayName: identity.display_name,
          query: spec.query,
          mode: spec.mode,
          returned: items.length,
          accepted,
        });
      } catch (error) {
        results.push({
          identityId: identity.id,
          displayName: identity.display_name,
          query: spec.query,
          mode: spec.mode,
          returned: 0,
          accepted: 0,
          error:
            error instanceof Error ? error.message : "Unknown Hot Watch error.",
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
  const ingestItems: MarketIntelIngestItem[] = candidates.map((candidate) => {
    const { identity, item, confidence, reasons, query, mode, gaps } = candidate;
    const suspectedMislisting = mode === "loose" && gaps.length > 0;
    return {
      marketplaceSlug: "ebay",
      collectibleIdentityId: identity.id,
      collectibleIdentityKey: identity.identity_key,
      externalListingId: item.legacyItemId || item.itemId || null,
      directUrl: item.itemWebUrl || item.itemAffiliateWebUrl || "",
      originalTitle: item.title || "",
      description: item.shortDescription || null,
      imageUrls: images(item),
      listingFormat: listingFormat(item),
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
      identityMatchMethod:
        mode === "loose"
          ? "hot_watch_loose_title_match"
          : "hot_watch_exact_title_match",
      suspectedMislisting,
      mislistingReason: suspectedMislisting
        ? `Hot Watch found weak or missing seller labels: ${gaps.join(", ")}.`
        : null,
      metadata: {
        source_adapter: "ebay_hot_watch",
        hot_watch: true,
        hot_watch_query_mode: mode,
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

  const delivery: {
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
        error instanceof Error ? error.message : "Unable to deliver Hot Watch alerts.";
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
      affiliation: subject.team_or_affiliation || subject.league_or_brand || null,
    })),
    identities: targets.identities.map((identity) => ({
      id: identity.id,
      player: identity.subject_name,
      displayName: identity.display_name,
      score: Number(identity.hot_score.toFixed(2)),
    })),
    queryCount: results.length,
    returned: results.reduce((sum, result) => sum + result.returned, 0),
    accepted: candidates.length,
    suspectedMislistings: candidates.filter(
      (candidate) => candidate.mode === "loose" && candidate.gaps.length > 0,
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
