import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../lib/admin-handoff";
import { scoreMarketIntelListing } from "../../../../../lib/market-intel-deals";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function numberField(formData: FormData, name: string, fallback = 0) {
  const raw = text(formData, name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const collectibleIdentityId = text(formData, "collectibleIdentityId");
    const marketplaceId = text(formData, "marketplaceId");
    const directUrl = text(formData, "directUrl");
    const originalTitle = text(formData, "originalTitle");
    const listingFormat = text(formData, "listingFormat") || "unknown";
    const askingPrice = numberField(formData, "askingPrice");
    const shippingPrice = numberField(formData, "shippingPrice");
    const buyerFee = numberField(formData, "buyerFee");
    const quantity = Math.round(numberField(formData, "quantity", 1));
    const sellerRatingRaw = text(formData, "sellerRating");
    const sellerRating = sellerRatingRaw ? Number(sellerRatingRaw) : null;
    const identityMatchConfidence = numberField(
      formData,
      "identityMatchConfidence",
      100,
    );
    const auctionEndAt = text(formData, "auctionEndAt");

    if (!collectibleIdentityId || !marketplaceId || !directUrl || !originalTitle) {
      throw new Error(
        "Exact card, marketplace, direct listing URL, and title are required.",
      );
    }
    if (!/^https?:\/\//i.test(directUrl)) {
      throw new Error("Direct listing URL must begin with http:// or https://.");
    }
    if (!["fixed_price", "auction", "best_offer", "lot", "unknown"].includes(listingFormat)) {
      throw new Error("Unsupported listing format.");
    }
    if (askingPrice < 0 || shippingPrice < 0 || buyerFee < 0) {
      throw new Error("Listing costs cannot be negative.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive whole number.");
    }
    if (
      sellerRating !== null &&
      (!Number.isFinite(sellerRating) || sellerRating < 0 || sellerRating > 100)
    ) {
      throw new Error("Seller rating must be between 0 and 100.");
    }
    if (identityMatchConfidence < 0 || identityMatchConfidence > 100) {
      throw new Error("Identity-match confidence must be between 0 and 100.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: listing, error } = await supabase
      .from("tcos_mi_listings")
      .insert({
        marketplace_id: marketplaceId,
        collectible_identity_id: collectibleIdentityId,
        external_listing_id: text(formData, "externalListingId") || null,
        direct_url: directUrl,
        original_title: originalTitle,
        listing_status: "active",
        listing_format: listingFormat,
        asking_price: askingPrice,
        shipping_price: shippingPrice,
        buyer_fee: buyerFee,
        quantity,
        seller_name: text(formData, "sellerName") || null,
        seller_rating: sellerRating,
        auction_end_at: auctionEndAt
          ? new Date(auctionEndAt).toISOString()
          : null,
        listed_at: new Date().toISOString(),
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        identity_match_confidence: identityMatchConfidence,
        identity_match_method: "manual_exact_identity",
        suspected_mislisting: formData.get("suspectedMislisting") === "on",
        mislisting_reason: text(formData, "mislistingReason") || null,
        metadata: {
          resale_fee_pct: numberField(formData, "resaleFeePct", 13.5),
          sell_through_pct: numberField(formData, "sellThroughPct", 100),
          expected_outbound_shipping: numberField(
            formData,
            "expectedOutboundShipping",
            0,
          ),
          expected_supplies: numberField(formData, "expectedSupplies", 0),
          manual_intake: true,
          intake_source: "market-intel-beta-one",
        },
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    await scoreMarketIntelListing(listing.id);

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/deals?saved=1",
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save listing.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/deals?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
