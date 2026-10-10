import "server-only";

import type { MarketIntelDealListing } from "./market-intel-deals";
import type { KingmakerOwnerDecision } from "./kingmaker-truth";
import {
  decideKingmakerOpportunity,
  getKingmakerTruthHealth as getMacTruthHealth,
  linkKingmakerPurchase as linkMacPurchase,
  upsertKingmakerListing,
} from "./kingmaker-mac-server";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function sourceTypeForListing(listing: MarketIntelDealListing) {
  const slug = text(listing.marketplace?.slug).toLowerCase();
  return slug === "fanatics-collect" ? "fanatics_collect" : slug || "other";
}

function identityStatusForListing(listing: MarketIntelDealListing) {
  const metadata = listing.metadata || {};
  if (metadata.identity_proof_status === "verified_exact") return "verified_exact";
  if (listing.identity_match_confidence !== null && listing.identity_match_confidence >= 95) return "verified_exact";
  return "review_required";
}

function marketStatusForListing(listing: MarketIntelDealListing) {
  const latest = listing.identity?.latest_value;
  if (!latest || latest.sample_size < 2 || latest.conservative_value === null) return "insufficient_sales";
  return "verified_completed_sales";
}

export async function upsertKingmakerOpportunityFromListing(
  listing: MarketIntelDealListing,
  options: { sourceWatch?: string | null } = {},
) {
  return (await upsertKingmakerListing({
    sourceType: sourceTypeForListing(listing),
    sourceKey: text(listing.external_listing_id) || text(listing.direct_url),
    title: listing.original_title,
    directUrl: listing.direct_url,
    marketplace: listing.marketplace?.name || null,
    sellerName: listing.seller_name,
    askingPrice: listing.asking_price,
    shippingPrice: listing.shipping_price,
    buyerFee: listing.buyer_fee,
    deliveredCost: listing.delivered_price,
    identityStatus: identityStatusForListing(listing),
    marketStatus: marketStatusForListing(listing),
    identity: listing.identity || {},
    exactMarket: listing.identity?.latest_value || {},
    metadata: {
      listingStatus: listing.listing_status,
      listingFormat: listing.listing_format,
      quantity: listing.quantity,
      suspectedMislisting: listing.suspected_mislisting,
      mislistingReason: listing.mislisting_reason,
      dealScoreId: listing.score?.id || null,
      buyScore: listing.score?.buy_score ?? null,
      expectedNetProfit: listing.score?.expected_net_profit ?? null,
      confidenceScore: listing.score?.confidence_score ?? null,
      liquidityScore: listing.score?.liquidity_score ?? null,
      riskScore: listing.score?.risk_score ?? null,
    },
  }, options.sourceWatch)).opportunity;
}

export async function recordKingmakerOwnerDecision(input: {
  opportunityId: string;
  decision: KingmakerOwnerDecision;
  reason?: string | null;
}) {
  return (await decideKingmakerOpportunity(input.opportunityId, input.decision, input.reason)).opportunity;
}

export async function linkKingmakerPurchase(input: {
  opportunityId: string;
  purchaseLotId: string;
}) {
  return (await linkMacPurchase(input.opportunityId, input.purchaseLotId)).opportunity;
}

export async function getKingmakerTruthHealth() {
  return getMacTruthHealth();
}
