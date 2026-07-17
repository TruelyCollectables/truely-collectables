import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelDealIdentity = {
  id: string;
  subject_id: string | null;
  display_name: string;
  condition_type: string;
  subject_name: string | null;
  latest_value: {
    id: string;
    conservative_value: number | null;
    sample_size: number;
    confidence_score: number;
    liquidity_score: number;
    calculated_at: string;
  } | null;
};

export type MarketIntelDealListing = {
  id: string;
  marketplace_id: string;
  collectible_identity_id: string | null;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  listing_status: string;
  listing_format: string;
  asking_price: number;
  shipping_price: number;
  buyer_fee: number;
  delivered_price: number;
  quantity: number;
  seller_name: string | null;
  seller_rating: number | null;
  auction_end_at: string | null;
  first_seen_at: string;
  identity_match_confidence: number | null;
  suspected_mislisting: boolean;
  mislisting_reason: string | null;
  metadata: Record<string, unknown>;
  marketplace: { id: string; name: string; slug: string } | null;
  identity: MarketIntelDealIdentity | null;
  score: MarketIntelDealScore | null;
};

export type MarketIntelDealScore = {
  id: string;
  listing_id: string;
  market_value_id: string | null;
  deal_label: string;
  delivered_cost: number;
  conservative_resale_value: number | null;
  discount_pct: number | null;
  expected_seller_fees: number;
  expected_outbound_shipping: number;
  expected_supplies: number;
  expected_net_profit: number | null;
  buy_score: number;
  confidence_score: number;
  liquidity_score: number;
  risk_score: number;
  actionable: boolean;
  reason: string | null;
  risk_notes: string | null;
  calculated_at: string;
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
) {
  return numberValue(metadata?.[key] ?? fallback);
}

function normalizeScore(row: Record<string, unknown>): MarketIntelDealScore {
  return {
    id: String(row.id),
    listing_id: String(row.listing_id),
    market_value_id: row.market_value_id ? String(row.market_value_id) : null,
    deal_label: String(row.deal_label || "none"),
    delivered_cost: numberValue(row.delivered_cost),
    conservative_resale_value: nullableNumber(row.conservative_resale_value),
    discount_pct: nullableNumber(row.discount_pct),
    expected_seller_fees: numberValue(row.expected_seller_fees),
    expected_outbound_shipping: numberValue(row.expected_outbound_shipping),
    expected_supplies: numberValue(row.expected_supplies),
    expected_net_profit: nullableNumber(row.expected_net_profit),
    buy_score: numberValue(row.buy_score),
    confidence_score: numberValue(row.confidence_score),
    liquidity_score: numberValue(row.liquidity_score),
    risk_score: numberValue(row.risk_score),
    actionable: Boolean(row.actionable),
    reason: row.reason ? String(row.reason) : null,
    risk_notes: row.risk_notes ? String(row.risk_notes) : null,
    calculated_at: String(row.calculated_at),
  };
}

export async function getMarketIntelDealWorkbench() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [
    identityResult,
    subjectResult,
    valueResult,
    marketplaceResult,
    listingResult,
    scoreResult,
  ] = await Promise.all([
    supabase
      .from("tcos_mi_collectible_identities")
      .select("id,subject_id,display_name,condition_type")
      .eq("active", true)
      .order("display_name"),
    supabase.from("tcos_mi_subjects").select("id,name"),
    supabase
      .from("tcos_mi_market_values")
      .select(
        "id,collectible_identity_id,conservative_value,sample_size,confidence_score,liquidity_score,calculated_at",
      )
      .order("calculated_at", { ascending: false }),
    supabase
      .from("tcos_mi_marketplaces")
      .select("id,name,slug")
      .eq("active", true)
      .order("name"),
    supabase
      .from("tcos_mi_listings")
      .select(
        "id,marketplace_id,collectible_identity_id,external_listing_id,direct_url,original_title,listing_status,listing_format,asking_price,shipping_price,buyer_fee,delivered_price,quantity,seller_name,seller_rating,auction_end_at,first_seen_at,identity_match_confidence,suspected_mislisting,mislisting_reason,metadata",
      )
      .eq("listing_status", "active")
      .order("first_seen_at", { ascending: false }),
    supabase
      .from("tcos_mi_deal_scores")
      .select("*")
      .order("calculated_at", { ascending: false }),
  ]);

  for (const result of [
    identityResult,
    subjectResult,
    valueResult,
    marketplaceResult,
    listingResult,
    scoreResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const subjectById = new Map(
    (subjectResult.data || []).map((subject) => [subject.id, String(subject.name)]),
  );
  const latestValueByIdentity = new Map<string, MarketIntelDealIdentity["latest_value"]>();
  for (const row of valueResult.data || []) {
    if (!latestValueByIdentity.has(row.collectible_identity_id)) {
      latestValueByIdentity.set(row.collectible_identity_id, {
        id: row.id,
        conservative_value: nullableNumber(row.conservative_value),
        sample_size: numberValue(row.sample_size),
        confidence_score: numberValue(row.confidence_score),
        liquidity_score: numberValue(row.liquidity_score),
        calculated_at: String(row.calculated_at),
      });
    }
  }

  const identities = (identityResult.data || []).map((identity) => ({
    id: identity.id,
    subject_id: identity.subject_id,
    display_name: String(identity.display_name),
    condition_type: String(identity.condition_type),
    subject_name: identity.subject_id ? subjectById.get(identity.subject_id) || null : null,
    latest_value: latestValueByIdentity.get(identity.id) || null,
  })) satisfies MarketIntelDealIdentity[];
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  const marketplaces = (marketplaceResult.data || []).map((marketplace) => ({
    id: marketplace.id,
    name: String(marketplace.name),
    slug: String(marketplace.slug),
  }));
  const marketplaceById = new Map(
    marketplaces.map((marketplace) => [marketplace.id, marketplace]),
  );
  const latestScoreByListing = new Map<string, MarketIntelDealScore>();
  for (const raw of scoreResult.data || []) {
    const score = normalizeScore(raw as Record<string, unknown>);
    if (!latestScoreByListing.has(score.listing_id)) {
      latestScoreByListing.set(score.listing_id, score);
    }
  }

  const listings = (listingResult.data || [])
    .map((row) => ({
      id: row.id,
      marketplace_id: row.marketplace_id,
      collectible_identity_id: row.collectible_identity_id,
      external_listing_id: row.external_listing_id,
      direct_url: String(row.direct_url),
      original_title: String(row.original_title),
      listing_status: String(row.listing_status),
      listing_format: String(row.listing_format),
      asking_price: numberValue(row.asking_price),
      shipping_price: numberValue(row.shipping_price),
      buyer_fee: numberValue(row.buyer_fee),
      delivered_price: numberValue(row.delivered_price),
      quantity: numberValue(row.quantity),
      seller_name: row.seller_name ? String(row.seller_name) : null,
      seller_rating: nullableNumber(row.seller_rating),
      auction_end_at: row.auction_end_at ? String(row.auction_end_at) : null,
      first_seen_at: String(row.first_seen_at),
      identity_match_confidence: nullableNumber(row.identity_match_confidence),
      suspected_mislisting: Boolean(row.suspected_mislisting),
      mislisting_reason: row.mislisting_reason ? String(row.mislisting_reason) : null,
      metadata: (row.metadata || {}) as Record<string, unknown>,
      marketplace: marketplaceById.get(row.marketplace_id) || null,
      identity: row.collectible_identity_id
        ? identityById.get(row.collectible_identity_id) || null
        : null,
      score: latestScoreByListing.get(row.id) || null,
    }))
    .sort((left, right) =>
      (right.score?.buy_score || 0) - (left.score?.buy_score || 0),
    ) satisfies MarketIntelDealListing[];

  return { identities, marketplaces, listings };
}

export async function scoreMarketIntelListing(listingId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: listing, error: listingError } = await supabase
    .from("tcos_mi_listings")
    .select("*")
    .eq("id", listingId)
    .single();
  if (listingError) throw new Error(listingError.message);

  const identityResult = listing.collectible_identity_id
    ? await supabase
        .from("tcos_mi_collectible_identities")
        .select("id,subject_id,display_name")
        .eq("id", listing.collectible_identity_id)
        .single()
    : { data: null, error: null };
  if (identityResult.error) throw new Error(identityResult.error.message);

  const valueResult = listing.collectible_identity_id
    ? await supabase
        .from("tcos_mi_market_values")
        .select("*")
        .eq("collectible_identity_id", listing.collectible_identity_id)
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (valueResult.error) throw new Error(valueResult.error.message);

  const watchResult = identityResult.data?.subject_id
    ? await supabase
        .from("tcos_mi_watchlist")
        .select("minimum_discount_pct,minimum_estimated_net_profit")
        .eq("subject_id", identityResult.data.subject_id)
        .eq("active", true)
        .is("collectible_identity_id", null)
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (watchResult.error) throw new Error(watchResult.error.message);

  const deliveredCost = numberValue(listing.delivered_price);
  const quantity = Math.max(1, numberValue(listing.quantity));
  const unitCost = deliveredCost / quantity;
  const marketUnit = nullableNumber(valueResult.data?.conservative_value);
  const sampleSize = numberValue(valueResult.data?.sample_size);
  const confidence = numberValue(valueResult.data?.confidence_score);
  const liquidity = numberValue(valueResult.data?.liquidity_score);
  const identityMatch = nullableNumber(listing.identity_match_confidence) ?? 0;
  const metadata = (listing.metadata || {}) as Record<string, unknown>;
  const resaleFeePct = clamp(metadataNumber(metadata, "resale_fee_pct", 13.5), 0, 100);
  const sellThroughPct = clamp(metadataNumber(metadata, "sell_through_pct", 100), 0, 100);
  const outboundShipping = Math.max(
    0,
    metadataNumber(metadata, "expected_outbound_shipping", 0),
  );
  const supplies = Math.max(0, metadataNumber(metadata, "expected_supplies", 0));
  const minimumDiscount = numberValue(
    watchResult.data?.minimum_discount_pct ?? 20,
  );
  const minimumNetProfit = numberValue(
    watchResult.data?.minimum_estimated_net_profit ?? 0,
  );

  const reliable = Boolean(
    marketUnit && marketUnit > 0 && sampleSize >= 2 && confidence >= 35 && identityMatch >= 90,
  );
  const discountPct = marketUnit
    ? ((marketUnit - unitCost) / marketUnit) * 100
    : null;
  const expectedGrossResale = marketUnit
    ? marketUnit * quantity * (sellThroughPct / 100)
    : null;
  const expectedSellerFees = expectedGrossResale
    ? expectedGrossResale * (resaleFeePct / 100)
    : 0;
  const expectedNetProfit = expectedGrossResale === null
    ? null
    : expectedGrossResale - expectedSellerFees - outboundShipping - supplies - deliveredCost;

  let dealLabel = "none";
  if (!reliable) {
    dealLabel = listing.suspected_mislisting ? "mislisted" : "watch";
  } else if ((discountPct || 0) >= 50) {
    dealLabel = "too_good_to_be_true";
  } else if ((discountPct || 0) >= 40) {
    dealLabel = "steal";
  } else if ((discountPct || 0) >= 30) {
    dealLabel = "great_buy";
  } else if ((discountPct || 0) >= 20) {
    dealLabel = "good_buy";
  } else if (
    quantity > 1 &&
    (discountPct || 0) >= 10 &&
    (expectedNetProfit || 0) >= minimumNetProfit
  ) {
    dealLabel = "wholesale_opportunity";
  } else if (listing.suspected_mislisting && (expectedNetProfit || 0) > 0) {
    dealLabel = "mislisted";
  } else {
    dealLabel = "watch";
  }

  const auctionRisk = listing.listing_format === "auction" ? 10 : 0;
  const sellerRisk =
    listing.seller_rating !== null && numberValue(listing.seller_rating) < 98 ? 10 : 0;
  const riskScore = clamp(
    100 - confidence * 0.5 - liquidity * 0.2 - identityMatch * 0.2 + auctionRisk + sellerRisk,
  );
  const profitComponent = clamp((expectedNetProfit || 0) / 100, 0, 1) * 20;
  const discountComponent = clamp((discountPct || 0) / 50, 0, 1) * 45;
  const buyScore = clamp(
    discountComponent +
      profitComponent +
      confidence * 0.15 +
      liquidity * 0.1 +
      (100 - riskScore) * 0.1,
  );
  const actionable = Boolean(
    reliable &&
      expectedNetProfit !== null &&
      expectedNetProfit >= minimumNetProfit &&
      ((discountPct || 0) >= minimumDiscount ||
        (quantity > 1 && (discountPct || 0) >= 10) ||
        (listing.suspected_mislisting && (discountPct || 0) > 0)),
  );

  const secondaryFlags = [
    quantity > 1 ? "WHOLESALE" : null,
    listing.suspected_mislisting ? "MISLISTED" : null,
  ].filter(Boolean);
  const reason = marketUnit
    ? `${discountPct?.toFixed(1)}% below exact-card market; estimated net profit $${(expectedNetProfit || 0).toFixed(2)}${secondaryFlags.length ? `; ${secondaryFlags.join(" + ")}` : ""}.`
    : "No current exact-card market value is available.";
  const riskNotes = !reliable
    ? `Deal label suppressed: sample ${sampleSize}, market confidence ${confidence.toFixed(0)}%, identity match ${identityMatch.toFixed(0)}%.`
    : `Risk ${riskScore.toFixed(0)}/100; assumes ${sellThroughPct.toFixed(0)}% sell-through and ${resaleFeePct.toFixed(2)}% resale fees.`;

  const { data: score, error: scoreError } = await supabase
    .from("tcos_mi_deal_scores")
    .insert({
      listing_id: listingId,
      market_value_id: valueResult.data?.id || null,
      deal_label: dealLabel,
      delivered_cost: deliveredCost,
      conservative_resale_value: expectedGrossResale,
      discount_pct: discountPct,
      expected_seller_fees: expectedSellerFees,
      expected_outbound_shipping: outboundShipping,
      expected_supplies: supplies,
      expected_net_profit: expectedNetProfit,
      buy_score: buyScore,
      confidence_score: confidence,
      liquidity_score: liquidity,
      risk_score: riskScore,
      actionable,
      reason,
      risk_notes: riskNotes,
      calculated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (scoreError) throw new Error(scoreError.message);

  return normalizeScore(score as Record<string, unknown>);
}
