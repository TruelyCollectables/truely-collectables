import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { getKingmakerPricingReceiptHistory } from "../../../../../lib/kingmaker-pricing-receipt-history-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const receiptId = request.nextUrl.searchParams.get("receiptId");
    const limitValue = Number(request.nextUrl.searchParams.get("limit") || 25);
    const receipts = await getKingmakerPricingReceiptHistory({
      actor,
      receiptId,
      limit: Number.isFinite(limitValue) ? limitValue : 25,
    });

    return NextResponse.json({
      ok: true,
      receipt: receiptId ? receipts[0] || null : undefined,
      receipts: receiptId ? undefined : receipts,
      sourceDisclosure: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Pricing receipts.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
