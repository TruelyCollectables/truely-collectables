import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../lib/instacomp-job-server";
import { getKingmakerPricingReceiptHistory } from "../../../../../../lib/kingmaker-pricing-receipt-history-server";
import { summarizePricingReceipts } from "../../../../../../lib/kingmaker-pricing-receipt-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
    const receipts = await getKingmakerPricingReceiptHistory({ actor, limit });
    return NextResponse.json({
      ok: true,
      analytics: summarizePricingReceipts(receipts),
      receiptCount: receipts.length,
      sourceDisclosure: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not summarize pricing receipts.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
