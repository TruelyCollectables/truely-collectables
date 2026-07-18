import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { endMarketIntelListing } from "../../../../../../../lib/market-intel-listing-state";
import { requestOrigin } from "../../../../../../../lib/request-origin";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

function numberField(formData: FormData, name: string, fallback: number) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const origin = requestOrigin(request);
  const json = wantsJson(request);

  try {
    const formData = await request.formData();
    const supabase = createSupabaseServerClient({ admin: true });

    const { data: listing, error: listingError } = await supabase
      .from("tcos_mi_listings")
      .select(
        "id,marketplace_id,collectible_identity_id,direct_url,original_title,listing_status,asking_price,shipping_price,buyer_fee,delivered_price,quantity,metadata",
      )
      .eq("id", id)
      .single();

    if (listingError) throw new Error(listingError.message);
    if (!listing.collectible_identity_id) {
      throw new Error("This listing does not have an exact collectible identity.");
    }

    const { data: existing, error: existingError } = await supabase
      .from("tcos_mi_purchase_lots")
      .select("id,purchase_number")
      .eq("source_listing_id", id)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existing) {
      const redirectUrl = adminRedirectUrl(
        `/admin/market-intel/purchases/${existing.id}`,
        origin,
        handoff,
      );
      if (json) {
        return NextResponse.json({
          success: true,
          alreadyRecorded: true,
          purchaseId: existing.id,
          purchaseNumber: existing.purchase_number,
          redirectUrl: redirectUrl.toString(),
          message: `Purchase #${existing.purchase_number} was already recorded for this listing.`,
        });
      }

      return NextResponse.redirect(redirectUrl, 303);
    }

    const defaultTotal = Number(listing.delivered_price || 0);
    const totalAcquisitionCost = numberField(
      formData,
      "totalAcquisitionCost",
      defaultTotal,
    );
    const quantityPurchased = Math.round(
      numberField(formData, "quantityPurchased", Number(listing.quantity || 1)),
    );
    const purchaseDate = String(formData.get("purchaseDate") ?? "").trim();
    const alreadyReceived = formData.get("alreadyReceived") === "on";

    if (totalAcquisitionCost < 0) {
      throw new Error("Total out-the-door cost cannot be negative.");
    }
    if (!Number.isInteger(quantityPurchased) || quantityPurchased <= 0) {
      throw new Error("Purchase quantity must be a positive whole number.");
    }

    const purchasedAt = purchaseDate
      ? new Date(`${purchaseDate}T12:00:00`).toISOString()
      : new Date().toISOString();

    const { data: latestScore } = await supabase
      .from("tcos_mi_deal_scores")
      .select(
        "id,deal_label,expected_net_profit,buy_score,discount_pct,confidence_score,liquidity_score,risk_score",
      )
      .eq("listing_id", id)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: purchase, error: purchaseError } = await supabase
      .from("tcos_mi_purchase_lots")
      .insert({
        collectible_identity_id: listing.collectible_identity_id,
        marketplace_id: listing.marketplace_id,
        source_listing_id: id,
        purchased_at: purchasedAt,
        status: alreadyReceived ? "in_inventory" : "awaiting_receipt",
        quantity_purchased: quantityPurchased,
        item_subtotal: totalAcquisitionCost,
        inbound_shipping: 0,
        buyer_fees: 0,
        sales_tax: 0,
        other_acquisition_cost: 0,
        received_at: alreadyReceived ? new Date().toISOString() : null,
        source_url: listing.direct_url,
        deal_label: latestScore?.deal_label || null,
        notes: `Converted from TCOS Market Intel listing: ${listing.original_title}. Total acquisition cost was entered as the actual out-the-door amount.`,
        metadata: {
          beta_one_purchase_source: "shark_list",
          source_listing_title: listing.original_title,
          source_listing_asking_price: Number(listing.asking_price || 0),
          source_listing_shipping_price: Number(listing.shipping_price || 0),
          source_listing_buyer_fee: Number(listing.buyer_fee || 0),
          source_listing_delivered_price: Number(listing.delivered_price || 0),
          source_listing_metadata: listing.metadata || {},
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
      .single();

    if (purchaseError) throw new Error(purchaseError.message);

    const now = new Date().toISOString();
    let listingEndWarning: string | null = null;
    try {
      await endMarketIntelListing(id, {
        endedAt: now,
        metadata: {
          purchased_at: now,
          purchase_lot_id: purchase.id,
          end_reason: "purchased",
          end_source: "shark_list",
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
      .eq("listing_id", id)
      .eq("status", "pending");

    const redirectUrl = adminRedirectUrl(
      `/admin/market-intel/purchases/${purchase.id}?saved=purchased`,
      origin,
      handoff,
    );

    if (json) {
      return NextResponse.json({
        success: true,
        alreadyRecorded: false,
        purchaseId: purchase.id,
        purchaseNumber: purchase.purchase_number,
        redirectUrl: redirectUrl.toString(),
        warning: listingEndWarning,
        message: `Purchase #${purchase.purchase_number} recorded. Quantity ${quantityPurchased}; listing moved out of the active deal desk.${listingEndWarning ? ` ${listingEndWarning}` : ""}`,
      });
    }

    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record purchase.";
    if (json) {
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/buy?error=${encodeURIComponent(message)}`,
        origin,
        handoff,
      ),
      303,
    );
  }
}
