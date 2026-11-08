import { NextResponse } from "next/server";
import { importEbayListingsPage } from "../../../../lib/ebay-sync";
import { syncEbayAllListingImages } from "../../../../lib/ebay-all-image-sync";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await importEbayListingsPage({
      offset: Number(url.searchParams.get("offset") || "0"),
      limit: Number(url.searchParams.get("limit") || "10"),
      runId: url.searchParams.get("runId") || undefined,
    });
    const failedSample = result.debugSamples.find((sample) =>
      String(sample.reason || "").includes("failed"),
    );

    if (failedSample) {
      const failedReason = String(failedSample.reason || "unknown_import_failure");
      return NextResponse.json(
        {
          ...result,
          success: false,
          error: `eBay import batch stopped after reporting ${failedReason}. Review the diagnostic receipt before resuming.`,
        },
        { status: 409 },
      );
    }

    const imageSync =
      result.nextOffset === null
        ? await syncEbayAllListingImages({
            supabase: createSupabaseServerClient({ admin: true }),
            storeId: getActiveStoreId(),
          })
        : null;

    return NextResponse.json({ ...result, imageSync });
  } catch (error: any) {
    const message = error.message || "eBay import failed";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: message.includes("disabled") ? 403 : 500 },
    );
  }
}
