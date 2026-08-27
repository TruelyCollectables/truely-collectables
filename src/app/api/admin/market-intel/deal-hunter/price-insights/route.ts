import { NextRequest, NextResponse } from "next/server";
import { adminHandoffFromUrl, adminRedirectUrl } from "../../../../../../lib/admin-handoff";
import { priceInsightsCandidateEligibility } from "../../../../../../lib/deal-hunter-price-insights-capture";
import { filterExactEbayPriceInsightsRows } from "../../../../../../lib/instacomp-ebay-price-insights";
import { persistExactCardMarketHistory } from "../../../../../../lib/instacomp-market-history";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").replace(/\s+/g, " ").trim();
}

function money(formData: FormData, name: string, { allowZero = false } = {}) {
  const value = Number(text(formData, name));
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${name} must be ${allowZero ? "zero or a positive number" : "a positive number"}.`);
  }
  return Number(value.toFixed(2));
}

function redirect(request: NextRequest, handoff: ReturnType<typeof adminHandoffFromUrl>, params: URLSearchParams) {
  return NextResponse.redirect(
    adminRedirectUrl(
      `/admin/market-intel/deal-hunter/price-insights?${params.toString()}`,
      request.url,
      handoff,
    ),
    303,
  );
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const formData = await request.formData();
    const candidateId = text(formData, "candidateId");
    const soldTitle = text(formData, "soldTitle");
    const soldAt = text(formData, "soldAt");
    const sourceUrl = text(formData, "sourceUrl");
    const itemPrice = money(formData, "itemPrice");
    const shippingPrice = money(formData, "shippingPrice", { allowZero: true });
    const condition = text(formData, "condition") || null;
    const buyingOption = text(formData, "buyingOption") || null;

    if (!candidateId || !soldTitle || !soldAt || !sourceUrl) {
      throw new Error("Candidate, sold title, sold date, item price, shipping, and direct eBay item URL are required.");
    }
    const soldDate = new Date(`${soldAt}T12:00:00Z`);
    if (!Number.isFinite(soldDate.getTime())) throw new Error("Sold date is invalid.");

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: candidate, error } = await supabase
      .from("tcos_deal_hunter_candidates")
      .select("id,title,identity,exact_market,evaluation,listing_item_id,listing_url")
      .eq("id", candidateId)
      .maybeSingle();
    if (error) throw new Error(`Candidate lookup failed: ${error.message}`);
    if (!candidate) throw new Error("Deal Hunter candidate was not found.");

    const eligibility = priceInsightsCandidateEligibility(candidate);
    if (!eligibility.eligible) throw new Error(eligibility.reason);

    const capture = filterExactEbayPriceInsightsRows(
      [
        {
          title: soldTitle,
          soldAt: soldDate.toISOString(),
          itemPrice,
          shippingPrice,
          url: sourceUrl,
          condition,
          buyingOption,
          capturedAt: new Date().toISOString(),
        },
      ],
      eligibility.ai,
      1,
    );
    if (capture.accepted.length !== 1) {
      const reason = capture.rejected[0]?.reason || "The sold row did not pass the strict exact-card firewall.";
      throw new Error(`Price Insights row rejected: ${reason}`);
    }

    const identity = candidate.identity && typeof candidate.identity === "object" && !Array.isArray(candidate.identity)
      ? (candidate.identity as Record<string, unknown>)
      : {};
    const saved = await persistExactCardMarketHistory({
      registry: eligibility.registry,
      ai: eligibility.ai,
      sold: capture.accepted,
      active: [],
      scanId: String(identity.internalScanId || "").trim() || null,
      observedAt: new Date().toISOString(),
    });
    if (saved.status === "blocked") throw new Error(saved.reason);

    const params = new URLSearchParams({
      saved: "1",
      candidateId,
      inserted: String(saved.inserted || 0),
      duplicates: String(saved.duplicates || 0),
      registryIdentityId: String(saved.registryIdentityId || eligibility.registry.identityId || ""),
    });
    return redirect(request, handoff, params);
  } catch (error) {
    return redirect(
      request,
      handoff,
      new URLSearchParams({
        error: error instanceof Error ? error.message : "Unable to save Price Insights sold evidence.",
      }),
    );
  }
}
