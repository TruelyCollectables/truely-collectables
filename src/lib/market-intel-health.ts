import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelHealthMarketplace = {
  id: string;
  name: string;
  slug: string;
  activeCount: number;
  staleCount: number;
  endedCount: number;
  latestSeenAt: string | null;
};

export type MarketIntelHealthListing = {
  id: string;
  marketplace_id: string;
  collectible_identity_id: string | null;
  original_title: string;
  direct_url: string;
  listing_status: string;
  delivered_price: number;
  quantity: number;
  first_seen_at: string;
  last_seen_at: string;
  identity_match_confidence: number | null;
  metadata: Record<string, unknown>;
  marketplaceName: string;
  scored: boolean;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getMarketIntelIngestionHealth() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [listingResult, marketplaceResult, scoreResult] = await Promise.all([
    supabase
      .from("tcos_mi_listings")
      .select(
        "id,marketplace_id,collectible_identity_id,original_title,direct_url,listing_status,delivered_price,quantity,first_seen_at,last_seen_at,identity_match_confidence,metadata",
      )
      .order("last_seen_at", { ascending: false }),
    supabase
      .from("tcos_mi_marketplaces")
      .select("id,name,slug")
      .eq("active", true)
      .order("name"),
    supabase
      .from("tcos_mi_deal_scores")
      .select("listing_id,calculated_at")
      .order("calculated_at", { ascending: false }),
  ]);

  for (const result of [listingResult, marketplaceResult, scoreResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const marketplaces = (marketplaceResult.data || []).map((marketplace) => ({
    id: String(marketplace.id),
    name: String(marketplace.name),
    slug: String(marketplace.slug),
  }));
  const marketplaceById = new Map(
    marketplaces.map((marketplace) => [marketplace.id, marketplace]),
  );
  const scoredListingIds = new Set<string>();
  for (const score of scoreResult.data || []) {
    scoredListingIds.add(String(score.listing_id));
  }

  const listings = (listingResult.data || []).map((listing) => ({
    id: String(listing.id),
    marketplace_id: String(listing.marketplace_id),
    collectible_identity_id: listing.collectible_identity_id
      ? String(listing.collectible_identity_id)
      : null,
    original_title: String(listing.original_title),
    direct_url: String(listing.direct_url),
    listing_status: String(listing.listing_status),
    delivered_price: numberValue(listing.delivered_price),
    quantity: numberValue(listing.quantity),
    first_seen_at: String(listing.first_seen_at),
    last_seen_at: String(listing.last_seen_at),
    identity_match_confidence:
      listing.identity_match_confidence === null
        ? null
        : numberValue(listing.identity_match_confidence),
    metadata: (listing.metadata || {}) as Record<string, unknown>,
    marketplaceName:
      marketplaceById.get(String(listing.marketplace_id))?.name || "Unknown",
    scored: scoredListingIds.has(String(listing.id)),
  })) satisfies MarketIntelHealthListing[];

  const now = Date.now();
  const freshCutoff = now - 2 * 60 * 60 * 1000;
  const activeListings = listings.filter(
    (listing) => listing.listing_status === "active",
  );
  const freshListings = activeListings.filter(
    (listing) => new Date(listing.last_seen_at).getTime() >= freshCutoff,
  );
  const priceChangedListings = listings.filter(
    (listing) =>
      Array.isArray(listing.metadata.price_history) &&
      listing.metadata.price_history.length > 0,
  );
  const ingestedListings = listings.filter(
    (listing) => listing.metadata.ingestion_source === "market-intel-gateway",
  );
  const latestIngestAt = ingestedListings
    .map((listing) =>
      String(listing.metadata.last_ingested_at || listing.last_seen_at),
    )
    .sort()
    .at(-1) || null;

  const marketplaceHealth: MarketIntelHealthMarketplace[] = marketplaces.map(
    (marketplace) => {
      const marketplaceListings = listings.filter(
        (listing) => listing.marketplace_id === marketplace.id,
      );
      return {
        ...marketplace,
        activeCount: marketplaceListings.filter(
          (listing) => listing.listing_status === "active",
        ).length,
        staleCount: marketplaceListings.filter(
          (listing) => listing.listing_status === "stale",
        ).length,
        endedCount: marketplaceListings.filter(
          (listing) => listing.listing_status === "ended",
        ).length,
        latestSeenAt:
          marketplaceListings.map((listing) => listing.last_seen_at).sort().at(-1) ||
          null,
      };
    },
  );

  return {
    ingestSecretConfigured: Boolean(
      (
        process.env.MARKET_INTEL_INGEST_SECRET ||
        process.env.CRON_SECRET ||
        ""
      ).trim(),
    ),
    totals: {
      all: listings.length,
      active: activeListings.length,
      fresh: freshListings.length,
      stale: listings.filter((listing) => listing.listing_status === "stale")
        .length,
      ended: listings.filter((listing) => listing.listing_status === "ended")
        .length,
      unmatched: activeListings.filter(
        (listing) => !listing.collectible_identity_id,
      ).length,
      unscored: activeListings.filter((listing) => !listing.scored).length,
      priceChanged: priceChangedListings.length,
      gatewayIngested: ingestedListings.length,
    },
    latestIngestAt,
    marketplaceHealth,
    recentListings: listings.slice(0, 25),
  };
}
