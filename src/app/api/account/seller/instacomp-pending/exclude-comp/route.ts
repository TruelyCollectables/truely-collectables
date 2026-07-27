import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function evidenceList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 250)
    : [];
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    const compUrl = String(body?.compUrl || "").trim();
    const lane = body?.lane === "active" ? "active" : "sold";
    if (!inventoryItemId || !compUrl) {
      return NextResponse.json(
        { error: "Choose a card and comp to exclude." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let query = supabase
      .from("inventory_items")
      .select("id,seller_account_id,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    query = isStoreOwnerAccount
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: item, error } = await query.maybeSingle();
    if (error) throw error;
    if (!item) return NextResponse.json({ error: "Card not found." }, { status: 404 });

    const metadata = recordValue(item.metadata);
    const instaComp = recordValue(metadata.instacomp);
    const sold = evidenceList(instaComp.soldCompEvidence);
    const active = evidenceList(instaComp.activeCompetition);
    const source = lane === "sold" ? sold : active;
    const excluded = source.find((row) => String(row?.url || "") === compUrl);
    if (!excluded) {
      return NextResponse.json({ error: "That comp is no longer in this card's evidence." }, { status: 404 });
    }

    const nextSold = sold.filter((row) => String(row?.url || "") !== compUrl);
    const nextActive = active.filter((row) => String(row?.url || "") !== compUrl);
    const excludedCompUrls = Array.from(new Set([...stringList(instaComp.excludedCompUrls), compUrl]));
    const excludedCompEvidence = [
      ...evidenceList(instaComp.excludedCompEvidence).filter(
        (row) => String(row?.url || "") !== compUrl,
      ),
      {
        ...excluded,
        exclusionLane: lane,
        exclusionReason: "seller_excluded_wrong_comp",
        excludedAt: new Date().toISOString(),
        excludedBy: account.id,
      },
    ].slice(-250);
    const pricingAnalysis = calculateInstaCompSweetSpot({
      sold: nextSold,
      active: nextActive,
    });
    const hasReliableSoldComps = pricingAnalysis.soldCount > 0;
    const suggestedPrice = hasReliableSoldComps ? pricingAnalysis.suggestedPrice : 0;
    const pricingStatus = hasReliableSoldComps && suggestedPrice > 0
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const checkedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        soldCompEvidence: nextSold,
        activeCompetition: nextActive,
        excludedCompUrls,
        excludedCompEvidence,
        pricingAnalysis,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason: hasReliableSoldComps
          ? pricingAnalysis.explanation
          : nextActive.length
            ? "No exact sold listing remains. " + nextActive.length +
              " exact active listing" + (nextActive.length === 1 ? " is" : "s are") +
              " shown only as competition; seller pricing is required."
            : "No exact sold or active listing remains; seller pricing is required.",
        reliableSoldCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
        trustedForPricing: hasReliableSoldComps,
        pricingCheckedAt: checkedAt,
        scannedAt: checkedAt,
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: checkedAt })
      .eq("id", item.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      inventoryItemId: item.id,
      excludedUrl: compUrl,
      excludedLane: lane,
      suggestedPrice,
      pricingAnalysis,
      soldCompCount: nextSold.length,
      activeCompCount: nextActive.length,
      message: "Comp excluded permanently and the sweet spot was recalculated without rescanning.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not exclude this comp." },
      { status: 500 },
    );
  }
}
