import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { backfillRecordedEbayPurchaseComps } from "../../../../../../../lib/market-intel-ebay-purchase-comps";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const result = await backfillRecordedEbayPurchaseComps();
    for (const path of [
      "/admin/market-intel/purchases/ebay-intake",
      "/admin/market-intel/purchases",
      "/admin/market-intel/comps",
      "/admin/market-intel/watch-center",
      "/admin/market-intel/portfolio",
    ]) {
      revalidatePath(path);
    }

    const params = new URLSearchParams({
      compSync: "1",
      compCreated: String(result.created),
      compUpdated: String(result.updated),
      compSkipped: String(result.skipped),
      compErrors: String(result.errors.length),
    });
    if (result.errors[0]) {
      params.set("compError", result.errors[0].message.slice(0, 220));
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/ebay-intake?${params.toString()}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to sync recorded eBay purchases into sold comps.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/ebay-intake?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
