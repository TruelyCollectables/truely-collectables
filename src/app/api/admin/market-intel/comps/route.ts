import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { recalculateMarketIntelValue } from "../../../../../../lib/market-intel-comps";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

function numberField(formData: FormData, name: string, fallback = 0) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  let identityId = "";

  try {
    const formData = await request.formData();
    identityId = String(formData.get("identityId") ?? "").trim();
    const marketplaceId = String(formData.get("marketplaceId") ?? "").trim();
    const soldAt = String(formData.get("soldAt") ?? "").trim();
    const soldPrice = numberField(formData, "soldPrice");
    const shippingPrice = numberField(formData, "shippingPrice");
    const buyerFee = numberField(formData, "buyerFee");
    const quantity = Math.round(numberField(formData, "quantity", 1));
    const matchConfidence = numberField(formData, "matchConfidence", 100);
    const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();

    if (!identityId || !marketplaceId || !soldAt) {
      throw new Error("Identity, marketplace, and sold date are required.");
    }
    if (soldPrice < 0 || shippingPrice < 0 || buyerFee < 0) {
      throw new Error("Sale amounts cannot be negative.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive whole number.");
    }
    if (matchConfidence < 0 || matchConfidence > 100) {
      throw new Error("Match confidence must be between 0 and 100.");
    }
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      throw new Error("Source URL must begin with http:// or https://.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { error } = await supabase.from("tcos_mi_sold_comps").insert({
      marketplace_id: marketplaceId,
      collectible_identity_id: identityId,
      external_sale_id:
        String(formData.get("externalSaleId") ?? "").trim() || null,
      source_url: sourceUrl || null,
      original_title:
        String(formData.get("originalTitle") ?? "").trim() || null,
      sold_at: new Date(`${soldAt}T12:00:00`).toISOString(),
      sold_price: soldPrice,
      shipping_price: shippingPrice,
      buyer_fee: buyerFee,
      quantity,
      verified: true,
      match_confidence: matchConfidence,
      excluded: formData.get("excluded") === "on",
      exclusion_reason:
        String(formData.get("exclusionReason") ?? "").trim() || null,
      outlier_flag: formData.get("outlierFlag") === "on",
      metadata: {
        entered_manually: true,
        entered_from: "market-intel-beta-one",
      },
    });

    if (error) throw new Error(error.message);
    await recalculateMarketIntelValue(identityId);

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${identityId}?saved=comp`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save comp.";
    const destination = identityId
      ? `/admin/market-intel/comps/${identityId}?error=${encodeURIComponent(message)}`
      : `/admin/market-intel/comps?error=${encodeURIComponent(message)}`;
    return NextResponse.redirect(
      adminRedirectUrl(destination, request.url, handoff),
      303,
    );
  }
}
