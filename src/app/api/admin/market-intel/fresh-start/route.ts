import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { resetMarketIntelSearchesAndPurchases } from "../../../../../../lib/market-intel-fresh-start";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const result = await resetMarketIntelSearchesAndPurchases({
      keepPurchaseId: String(formData.get("keepPurchaseId") || "").trim(),
      confirmation: String(formData.get("confirmation") || "").trim(),
    });

    for (const path of [
      "/admin/market-intel",
      "/admin/market-intel/fresh-start",
      "/admin/market-intel/watchlist",
      "/admin/market-intel/watch-center",
      "/admin/market-intel/discovery",
      "/admin/market-intel/deals",
      "/admin/market-intel/purchases",
      "/admin/market-intel/purchases/ebay-intake",
      "/admin/market-intel/portfolio",
      "/admin/market-intel/comps",
    ]) {
      revalidatePath(path);
    }

    const params = new URLSearchParams({
      reset: "1",
      searches: String(result.watchTargetsDeleted),
      purchases: String(result.purchasesDeleted),
      sales: String(result.salesDeleted),
      comps: String(result.receiptCompsDeleted),
      keeper: `#${result.keeper.purchaseNumber} ${result.keeper.collectibleName}`,
    });
    if (result.marketWarnings[0]) {
      params.set("warning", result.marketWarnings[0].slice(0, 220));
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/fresh-start?${params.toString()}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reset Market Intel.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/fresh-start?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
