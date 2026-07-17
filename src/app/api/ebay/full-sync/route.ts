import { NextResponse } from "next/server";
import { importEbayListingsPage } from "../../../../lib/ebay-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMIT = 100;
const MAX_BATCHES = 25;
const LIMIT_OPTIONS = [10, 25, 50, 100];

function safeLimit(value: string | null) {
  const parsed = Number(value || LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : LIMIT;
}

function safeMaxBatches(value: string | null) {
  const parsed = Number(value || MAX_BATCHES);
  if (!Number.isFinite(parsed)) return MAX_BATCHES;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_BATCHES);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accept = request.headers.get("accept") || "";

    if (!url.searchParams.has("execute") && accept.includes("text/html")) {
      return NextResponse.redirect(new URL("/admin/ebay/import-runner", url));
    }

    const limit = safeLimit(url.searchParams.get("limit"));
    const maxBatches = safeMaxBatches(url.searchParams.get("maxBatches"));
    const results = [];
    const runId = new Date().toISOString();
    let offset = 0;
    let totals = {
      received: 0,
      imported: 0,
      markedSold: 0,
      skipped: 0,
      policyAllowed: 0,
      policyNeedsReview: 0,
      policyBlocked: 0,
    };

    for (let batch = 1; batch <= maxBatches; batch++) {
      const result = await importEbayListingsPage({
        offset,
        limit,
        runId,
      });

      totals = {
        received: totals.received + result.received,
        imported: totals.imported + result.imported,
        markedSold: totals.markedSold + result.markedSold,
        skipped: totals.skipped + result.skipped,
        policyAllowed: totals.policyAllowed + result.policyAllowed,
        policyNeedsReview:
          totals.policyNeedsReview + result.policyNeedsReview,
        policyBlocked: totals.policyBlocked + result.policyBlocked,
      };

      results.push({
        batch,
        offset,
        status: 200,
        ok: true,
        received: result.received,
        imported: result.imported,
        markedSold: result.markedSold,
        skipped: result.skipped,
        policyAllowed: result.policyAllowed,
        policyNeedsReview: result.policyNeedsReview,
        policyBlocked: result.policyBlocked,
        nextOffset: result.nextOffset,
        debugSamples: result.debugSamples,
      });

      if (result.nextOffset === null) {
        break;
      }

      offset = result.nextOffset;
    }

    return NextResponse.json({
      success: true,
      message: "Full eBay sync completed",
      runId,
      limit,
      maxBatches,
      totals,
      results,
    });
  } catch (error: any) {
    const message = error.message || "Full sync failed";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: message.includes("disabled") ? 403 : 500 },
    );
  }
}
