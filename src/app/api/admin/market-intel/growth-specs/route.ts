import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../lib/admin-handoff";
import { growthProfessionalCardEligibility } from "../../../../../lib/market-intel-card-scope";
import { growthIdentityEligibility } from "../../../../../lib/market-intel-growth";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalNumber(formData: FormData, name: string) {
  const raw = text(formData, name);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function numberField(formData: FormData, name: string, fallback: number) {
  return optionalNumber(formData, name) ?? fallback;
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const supabase = createSupabaseServerClient({ admin: true });
    const sourceListingId = text(formData, "sourceListingId") || null;
    let identityId = text(formData, "collectibleIdentityId");
    let listingQuantity: number | null = null;
    let listingDeliveredCost: number | null = null;
    let listingTitle: string | null = null;

    if (sourceListingId) {
      const { data: listing, error: listingError } = await supabase
        .from("tcos_mi_listings")
        .select(
          "id,collectible_identity_id,delivered_price,quantity,listing_status,original_title",
        )
        .eq("id", sourceListingId)
        .single();
      if (listingError) throw new Error(listingError.message);
      if (!listing.collectible_identity_id) {
        throw new Error("The source listing is not matched to an exact card identity.");
      }
      if (identityId && identityId !== listing.collectible_identity_id) {
        throw new Error("The selected card identity does not match the source listing.");
      }
      identityId = listing.collectible_identity_id;
      listingQuantity = Number(listing.quantity || 1);
      listingDeliveredCost = Number(listing.delivered_price || 0);
      listingTitle = String(listing.original_title || "");
    }

    if (!identityId) throw new Error("An exact card identity is required.");

    const { data: identity, error: identityError } = await supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,subject_id,sport_or_category,manufacturer,brand,product_line,set_name,display_name,parallel_name,insert_name,variation_name,serial_numbered_to,autograph,memorabilia,active",
      )
      .eq("id", identityId)
      .single();
    if (identityError) throw new Error(identityError.message);
    if (!identity.active) throw new Error("The selected exact card identity is inactive.");

    const subjectResult = identity.subject_id
      ? await supabase
          .from("tcos_mi_subjects")
          .select("league_or_brand")
          .eq("id", identity.subject_id)
          .maybeSingle()
      : { data: null, error: null };
    if (subjectResult.error) throw new Error(subjectResult.error.message);

    const nonBaseEligibility = growthIdentityEligibility(identity);
    if (!nonBaseEligibility.eligible) {
      throw new Error(
        "Base cards are blocked from Growth Specs. Choose a Silver, Holo, named parallel, insert, variation, numbered card, autograph, or memorabilia card.",
      );
    }

    const professionalEligibility = growthProfessionalCardEligibility({
      sportOrCategory: identity.sport_or_category,
      leagueOrBrand: subjectResult.data?.league_or_brand || null,
      manufacturer: identity.manufacturer,
      brand: identity.brand,
      productLine: identity.product_line,
      setName: identity.set_name,
      displayName: identity.display_name,
      listingTitle,
    });
    if (!professionalEligibility.eligible) {
      throw new Error(
        professionalEligibility.rejectionReasons.join(" ") ||
          "Only licensed professional baseball and WNBA cards are allowed.",
      );
    }

    const quantity = Math.round(
      optionalNumber(formData, "quantity") ?? listingQuantity ?? 1,
    );
    const totalDeliveredCost =
      optionalNumber(formData, "totalDeliveredCost") ?? listingDeliveredCost ?? 0;
    const targetExitPrice = numberField(formData, "targetExitPrice", 25);
    const sellThroughPct = numberField(formData, "sellThroughPct", 80);
    const resaleFeePct = numberField(formData, "resaleFeePct", 13.5);
    const outboundShippingPerCard = numberField(
      formData,
      "outboundShippingPerCard",
      1.25,
    );
    const suppliesPerCard = numberField(formData, "suppliesPerCard", 0.15);
    const holdMonths = Math.round(numberField(formData, "holdMonths", 24));
    const convictionScore = numberField(formData, "convictionScore", 50);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive whole number.");
    }
    if (totalDeliveredCost < 0) {
      throw new Error("Total delivered cost cannot be negative.");
    }
    const unitCost = totalDeliveredCost / quantity;
    if (unitCost > 5) {
      throw new Error(
        `Growth Specs are capped at $5 delivered per card. This scenario is $${unitCost.toFixed(2)} per card.`,
      );
    }
    if (targetExitPrice <= 0) throw new Error("Target exit price must be positive.");
    if (sellThroughPct < 0 || sellThroughPct > 100) {
      throw new Error("Sell-through must be between 0 and 100%.");
    }
    if (resaleFeePct < 0 || resaleFeePct > 100) {
      throw new Error("Resale fees must be between 0 and 100%.");
    }
    if (outboundShippingPerCard < 0 || suppliesPerCard < 0) {
      throw new Error("Shipping and supplies cannot be negative.");
    }
    if (holdMonths <= 0) throw new Error("Hold period must be positive.");
    if (convictionScore < 0 || convictionScore > 100) {
      throw new Error("Conviction must be between 0 and 100.");
    }

    const thesisExpiresAt = text(formData, "thesisExpiresAt") || null;
    if (thesisExpiresAt && Number.isNaN(new Date(thesisExpiresAt).getTime())) {
      throw new Error("Thesis expiration date is invalid.");
    }

    const { error } = await supabase.from("tcos_mi_growth_specs").insert({
      collectible_identity_id: identityId,
      source_listing_id: sourceListingId,
      status: "active",
      quantity,
      total_delivered_cost: totalDeliveredCost,
      target_exit_price: targetExitPrice,
      sell_through_pct: sellThroughPct,
      resale_fee_pct: resaleFeePct,
      outbound_shipping_per_card: outboundShippingPerCard,
      supplies_per_card: suppliesPerCard,
      hold_months: holdMonths,
      conviction_score: convictionScore,
      catalyst: text(formData, "catalyst") || null,
      thesis: text(formData, "thesis") || null,
      thesis_expires_at: thesisExpiresAt,
      notes:
        [
          text(formData, "notes") || null,
          `Card scope verified: ${professionalEligibility.scope}`,
        ]
          .filter(Boolean)
          .join("\n") || null,
    });

    if (error) {
      if (error.code === "23505") {
        throw new Error("That marketplace listing already has a saved Growth Spec.");
      }
      throw new Error(error.message);
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/growth-specs?saved=1",
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save Growth Spec.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/growth-specs?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
