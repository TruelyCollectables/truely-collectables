import { NextResponse } from "next/server";
import { importEbayListingsPage } from "../../../../lib/ebay-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMIT = 100;
const MAX_BATCHES = 25;

export async function GET() {
  try {
    const results = [];
    const runId = new Date().toISOString();
    let offset = 0;
    let totals = {
      received: 0,
      imported: 0,
      markedSold: 0,
      skipped: 0,
    };

    for (let batch = 1; batch <= MAX_BATCHES; batch++) {
      const result = await importEbayListingsPage({
        offset,
        limit: LIMIT,
        runId,
      });

      totals = {
        received: totals.received + result.received,
        imported: totals.imported + result.imported,
        markedSold: totals.markedSold + result.markedSold,
        skipped: totals.skipped + result.skipped,
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
      limit: LIMIT,
      maxBatches: MAX_BATCHES,
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
