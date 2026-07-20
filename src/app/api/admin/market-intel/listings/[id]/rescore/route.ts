import { NextRequest, NextResponse } from "next/server";
import { scoreMarketIntelListing } from "../../../../../../../lib/market-intel-deals";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function booleanValue(value: FormDataEntryValue | null) {
  return value === "1" || value === "true" || value === "on";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const formData = await request.formData().catch(() => new FormData());
    const expectedExternalListingId = String(
      formData.get("expectedExternalListingId") || "",
    ).trim();
    const requireZeroScores = booleanValue(formData.get("requireZeroScores"));

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: listing, error: listingError } = await supabase
      .from("tcos_mi_listings")
      .select("id,external_listing_id,listing_status")
      .eq("id", id)
      .single();

    if (listingError || !listing) {
      throw new Error(listingError?.message || "Listing was not found.");
    }
    if (String(listing.listing_status) !== "active") {
      throw new Error("Only active listings can be rescored.");
    }
    if (
      expectedExternalListingId &&
      String(listing.external_listing_id || "") !== expectedExternalListingId
    ) {
      throw new Error(
        `Listing guard failed: expected marketplace item ${expectedExternalListingId}.`,
      );
    }

    const [{ data: scoresBefore, error: scoresBeforeError }, { data: purchasesBefore, error: purchasesBeforeError }] =
      await Promise.all([
        supabase.from("tcos_mi_deal_scores").select("id").eq("listing_id", id),
        supabase
          .from("tcos_mi_purchase_lots")
          .select("id")
          .eq("source_listing_id", id),
      ]);

    if (scoresBeforeError) throw new Error(scoresBeforeError.message);
    if (purchasesBeforeError) throw new Error(purchasesBeforeError.message);
    if (requireZeroScores && (scoresBefore || []).length !== 0) {
      throw new Error("Controlled rescore blocked because a score already exists.");
    }

    const score = await scoreMarketIntelListing(id);

    const [{ data: scoresAfter, error: scoresAfterError }, { data: purchasesAfter, error: purchasesAfterError }] =
      await Promise.all([
        supabase
          .from("tcos_mi_deal_scores")
          .select("id,listing_id,deal_label,buy_score,actionable,reason,risk_notes,calculated_at")
          .eq("listing_id", id)
          .order("calculated_at", { ascending: false }),
        supabase
          .from("tcos_mi_purchase_lots")
          .select("id")
          .eq("source_listing_id", id),
      ]);

    if (scoresAfterError) throw new Error(scoresAfterError.message);
    if (purchasesAfterError) throw new Error(purchasesAfterError.message);
    if ((purchasesAfter || []).length !== (purchasesBefore || []).length) {
      throw new Error("Purchase count changed unexpectedly during rescore.");
    }

    return NextResponse.json({
      success: true,
      listingId: id,
      externalListingId: listing.external_listing_id,
      score,
      scoreCountBefore: (scoresBefore || []).length,
      scoreCountAfter: (scoresAfter || []).length,
      scoresAfter: scoresAfter || [],
      purchaseCountBefore: (purchasesBefore || []).length,
      purchaseCountAfter: (purchasesAfter || []).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to rescore listing.";
    return NextResponse.json(
      {
        success: false,
        listingId: id,
        error: message,
      },
      { status: 400 },
    );
  }
}
