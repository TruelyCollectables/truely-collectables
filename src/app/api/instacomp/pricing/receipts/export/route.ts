import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../lib/instacomp-job-server";
import { getKingmakerPricingReceiptHistory } from "../../../../../../lib/kingmaker-pricing-receipt-history-server";
import { pricingReceiptsToCsv } from "../../../../../../lib/kingmaker-pricing-receipt-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 500), 1000));
    const receipts = await getKingmakerPricingReceiptHistory({ actor, limit });
    return new NextResponse(pricingReceiptsToCsv(receipts), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=pricing-receipts.csv",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export pricing receipts.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
