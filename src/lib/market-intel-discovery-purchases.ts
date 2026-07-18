import "server-only";

import { assertCandidateBaseballPremiumPolicy } from "./market-intel-baseball-premium-enforcement";
import {
  approveIdentityCandidate,
  type CandidateApprovalInput,
} from "./market-intel-identity-candidates";
import { normalizeDuplicateIdentityKey } from "./market-intel-identity-duplicate-guard";
import { normalizeDiscoveryApprovalInput } from "./market-intel-discovery-repair";
import { endMarketIntelListing } from "./market-intel-listing-state";
import { createSupabaseServerClient } from "./supabase-server";

export type DiscoveryPurchaseInput = CandidateApprovalInput & {
  totalAcquisitionCost: number;
  purchaseDate?: string | null;
  alreadyReceived?: boolean;
};

function finiteMoney(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export async function recordDiscoveryCandidatePurchase(
  input: DiscoveryPurchaseInput,
) {
  if (!finiteMoney(input.totalAcquisitionCost)) {
    throw new Error("Actual out-the-door cost must be zero or greater.");
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Purchase quantity must be a positive whole number.");
  }

  const normalized = await normalizeDiscoveryApprovalInput(input);
  await assertCandidateBaseballPremiumPolicy(normalized);
  await normalizeDuplicateIdentityKey(normalized);
  const approval = await approveIdentityCandidate(normalized);
  if (!approval.listingId) {
    throw new Error("The candidate was approved, but no normalized listing was created.");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const { data: listingRows, error: listingError } = await supabase
    .from("tcos_mi_listings")
    .select(
      "id,marketplace_id,collectible_identity_id,direct_url,original_title,asking_price,shipping_price,buyer_fee,delivered_price,quantity,metadata",
    )
    .eq("id", approval.listingId)
    .limit(2);
  if (listingError) throw new Error(listingError.message);
  if (!listingRows || listingRows.length !== 1) {
    throw new Error(
      listingRows?.length
        ? "The approved listing ID is duplicated."
        : "The approved listing could not be found.",
    );
  }
  const listing = listingRows[0];
  if (!listing.collectible_identity_id) {
    throw new Error("The approved listing does not have an exact collectible identity.");
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("id,purchase_number")
    .eq("source_listing_id", listing.id)
    .limit(2);
  if (existingError) throw new Error(existingError.message);
  if (existingRows && existingRows.length > 0) {
    return {
      purchaseId: String(existingRows[0].id),
      purchaseNumber: Number(existingRows[0].purchase_number),
      alreadyRecorded: true,
      listingEndWarning: null,
    };
  }

  const purchasedAt = input.purchaseDate
    ? new Date(`${input.purchaseDate}T12:00:00`).toISOString()
    : new Date().toISOString();
  const alreadyReceived = Boolean(input.alreadyReceived);

  const { data: scoreRows } = await supabase
    .from("tcos_mi_deal_scores")
    .select(
      "id,deal_label,expected_net_profit,buy_score,discount_pct,confidence_score,liquidity_score,risk_score",
    )
    .eq("listing_id", listing.id)
    .order("calculated_at", { ascending: false })
    .limit(1);
  const latestScore = scoreRows?.[0] || null;

  const { data: purchaseRows, error: purchaseError } = await supabase
    .from("tcos_mi_purchase_lots")
    .insert({
      collectible_identity_id: listing.collectible_identity_id,
      marketplace_id: listing.marketplace_id,
      source_listing_id: listing.id,
      purchased_at: purchasedAt,
      status: alreadyReceived ? "in_inventory" : "awaiting_receipt",
      quantity_purchased: normalized.quantity,
      item_subtotal: input.totalAcquisitionCost,
      inbound_shipping: 0,
      buyer_fees: 0,
      sales_tax: 0,
      other_acquisition_cost: 0,
      received_at: alreadyReceived ? new Date().toISOString() : null,
      source_url: listing.direct_url,
      deal_label: latestScore?.deal_label || null,
      notes: `Purchased from the TCOS Discovery Desk: ${listing.original_title}. Actual out-the-door cost: $${input.totalAcquisitionCost.toFixed(2)}.`,
      metadata: {
        beta_one_purchase_source: "discovery_desk",
        discovery_candidate_id: normalized.candidateId,
        source_listing_title: listing.original_title,
        source_listing_asking_price: Number(listing.asking_price || 0),
        source_listing_shipping_price: Number(listing.shipping_price || 0),
        source_listing_buyer_fee: Number(listing.buyer_fee || 0),
        source_listing_delivered_price: Number(listing.delivered_price || 0),
        source_listing_metadata: listing.metadata || {},
        actual_out_the_door_cost: input.totalAcquisitionCost,
        deal_score_id: latestScore?.id || null,
        expected_net_profit_at_purchase:
          latestScore?.expected_net_profit ?? null,
        buy_score_at_purchase: latestScore?.buy_score ?? null,
        discount_pct_at_purchase: latestScore?.discount_pct ?? null,
        confidence_at_purchase: latestScore?.confidence_score ?? null,
        liquidity_at_purchase: latestScore?.liquidity_score ?? null,
        risk_at_purchase: latestScore?.risk_score ?? null,
      },
    })
    .select("id,purchase_number")
    .limit(2);
  if (purchaseError) throw new Error(purchaseError.message);
  if (!purchaseRows || purchaseRows.length !== 1) {
    throw new Error("The purchase position was not returned after insert.");
  }
  const purchase = purchaseRows[0];
  const now = new Date().toISOString();

  // The purchase row is the money record. Listing cleanup is deliberately
  // best-effort so a secondary status-update failure cannot falsely report
  // that a successfully inserted purchase was not recorded.
  let listingEndWarning: string | null = null;
  try {
    await endMarketIntelListing(String(listing.id), {
      endedAt: now,
      metadata: {
        purchased_at: now,
        purchase_lot_id: purchase.id,
        actual_out_the_door_cost: input.totalAcquisitionCost,
        end_reason: "purchased",
        end_source: "discovery_desk",
      },
    });
  } catch (error) {
    listingEndWarning =
      error instanceof Error
        ? `Purchase recorded, but listing cleanup failed: ${error.message}`
        : "Purchase recorded, but listing cleanup failed.";
  }

  await supabase
    .from("tcos_mi_alerts")
    .update({ status: "dismissed", dismissed_at: now })
    .eq("listing_id", listing.id)
    .eq("status", "pending");

  return {
    purchaseId: String(purchase.id),
    purchaseNumber: Number(purchase.purchase_number),
    alreadyRecorded: false,
    listingEndWarning,
  };
}
