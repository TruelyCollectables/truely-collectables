import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";
import type { MarketIntelDealListing } from "./market-intel-deals";
import {
  assertKingmakerTransition,
  kingmakerDecisionToStatus,
  requireKingmakerBuyTruth,
  type KingmakerLifecycleStatus,
  type KingmakerOwnerDecision,
  type KingmakerSourceType,
} from "./kingmaker-truth";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sourceKeyForListing(listing: MarketIntelDealListing) {
  const external = text(listing.external_listing_id);
  if (external) return external;
  const direct = text(listing.direct_url);
  if (!direct) throw new Error("KINGMAKER opportunity requires an external listing ID or direct URL.");
  return createHash("sha256").update(direct).digest("hex");
}

function sourceTypeForListing(listing: MarketIntelDealListing): KingmakerSourceType {
  const slug = text(listing.marketplace?.slug).toLowerCase();
  if (slug === "ebay") return "ebay";
  if (slug === "mercari") return "mercari";
  if (slug === "poshmark") return "poshmark";
  if (slug === "comc") return "comc";
  if (slug === "whatnot") return "whatnot";
  if (slug === "fanatics-collect" || slug === "fanatics_collect") return "fanatics_collect";
  if (slug === "collx") return "collx";
  if (slug === "facebook" || slug === "facebook-marketplace") return "facebook";
  return "other";
}

function identityStatusForListing(listing: MarketIntelDealListing) {
  const metadata = listing.metadata || {};
  if (metadata.identity_proof_status === "verified_exact") return "verified_exact";
  if (listing.identity_match_confidence !== null && listing.identity_match_confidence >= 95) {
    return "verified_exact";
  }
  return "review_required";
}

function marketStatusForListing(listing: MarketIntelDealListing) {
  const latest = listing.identity?.latest_value;
  if (!latest || latest.sample_size < 2 || latest.conservative_value === null) {
    return "insufficient_sales";
  }
  return "verified_completed_sales";
}

export async function upsertKingmakerOpportunityFromListing(
  listing: MarketIntelDealListing,
  options: { sourceWatch?: string | null } = {},
) {
  const sourceType = sourceTypeForListing(listing);
  const sourceKey = sourceKeyForListing(listing);
  const identityStatus = identityStatusForListing(listing);
  const marketStatus = marketStatusForListing(listing);
  const supabase = createSupabaseServerClient({ admin: true });

  const { data, error } = await supabase
    .from("tcos_kingmaker_opportunities")
    .upsert(
      {
        source_type: sourceType,
        source_key: sourceKey,
        source_watch: options.sourceWatch || null,
        source_listing_id: listing.id,
        collectible_identity_id: listing.collectible_identity_id,
        title: listing.original_title,
        direct_url: listing.direct_url,
        marketplace: listing.marketplace?.name || null,
        seller_name: listing.seller_name,
        asking_price: nullableMoney(listing.asking_price),
        shipping_price: nullableMoney(listing.shipping_price),
        buyer_fee: nullableMoney(listing.buyer_fee),
        delivered_cost: nullableMoney(listing.delivered_price),
        identity_status: identityStatus,
        market_status: marketStatus,
        last_seen_at: new Date().toISOString(),
        expires_at: listing.auction_end_at,
        metadata: {
          listing_status: listing.listing_status,
          listing_format: listing.listing_format,
          quantity: listing.quantity,
          suspected_mislisting: listing.suspected_mislisting,
          mislisting_reason: listing.mislisting_reason,
          deal_score_id: listing.score?.id || null,
          buy_score: listing.score?.buy_score ?? null,
          expected_net_profit: listing.score?.expected_net_profit ?? null,
          confidence_score: listing.score?.confidence_score ?? null,
          liquidity_score: listing.score?.liquidity_score ?? null,
          risk_score: listing.score?.risk_score ?? null,
        },
      },
      { onConflict: "source_type,source_key" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function recordKingmakerOwnerDecision(input: {
  opportunityId: string;
  decision: KingmakerOwnerDecision;
  reason?: string | null;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: current, error: readError } = await supabase
    .from("tcos_kingmaker_opportunities")
    .select("id,lifecycle_status")
    .eq("id", input.opportunityId)
    .single();
  if (readError) throw new Error(readError.message);

  const nextStatus = kingmakerDecisionToStatus(input.decision);
  assertKingmakerTransition(
    current.lifecycle_status as KingmakerLifecycleStatus,
    nextStatus,
  );

  const { data, error } = await supabase
    .from("tcos_kingmaker_opportunities")
    .update({
      owner_decision: input.decision,
      owner_decision_reason: input.reason || null,
      decision_at: new Date().toISOString(),
      lifecycle_status: nextStatus,
    })
    .eq("id", input.opportunityId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function linkKingmakerPurchase(input: {
  opportunityId: string;
  purchaseLotId: string;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: opportunity, error: readError } = await supabase
    .from("tcos_kingmaker_opportunities")
    .select("id,lifecycle_status,owner_decision,identity_status,market_status,purchased_lot_id")
    .eq("id", input.opportunityId)
    .single();
  if (readError) throw new Error(readError.message);

  assertKingmakerTransition(
    opportunity.lifecycle_status as KingmakerLifecycleStatus,
    "bought",
  );
  requireKingmakerBuyTruth({
    lifecycleStatus: "bought",
    ownerDecision: opportunity.owner_decision as KingmakerOwnerDecision | null,
    identityStatus: opportunity.identity_status,
    marketStatus: opportunity.market_status,
    purchaseLotId: input.purchaseLotId,
  });

  const { data: purchase, error: purchaseError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("id")
    .eq("id", input.purchaseLotId)
    .single();
  if (purchaseError || !purchase) {
    throw new Error(purchaseError?.message || "Purchase Ledger lot does not exist.");
  }

  const { data, error } = await supabase
    .from("tcos_kingmaker_opportunities")
    .update({
      lifecycle_status: "bought",
      owner_decision: "buy",
      purchased_lot_id: input.purchaseLotId,
      decision_at: new Date().toISOString(),
    })
    .eq("id", input.opportunityId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getKingmakerTruthHealth() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_kingmaker_truth_lifecycle")
    .select("opportunity_id,lifecycle_status,truth_consistent,truth_warnings,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data || [];
  const inconsistent = rows.filter((row) => row.truth_consistent !== true);
  return {
    ready: inconsistent.length === 0,
    opportunities: rows.length,
    inconsistent: inconsistent.length,
    warnings: inconsistent.flatMap((row) =>
      Array.isArray(row.truth_warnings) ? row.truth_warnings : [],
    ),
    lastUpdatedAt: rows[0]?.updated_at || null,
  };
}
