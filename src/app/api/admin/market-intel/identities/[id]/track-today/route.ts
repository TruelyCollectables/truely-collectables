import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { recalculateMarketIntelValue } from "../../../../../../../lib/market-intel-comps";
import { scanEbayForMarketIntel } from "../../../../../../../lib/market-intel-ebay";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const json = wantsJson(request);

  try {
    const scan = await scanEbayForMarketIntel({
      identityIds: [id],
      maxTargets: 1,
      resultsPerTarget: 25,
      minimumConfidence: 80,
    });
    const market = await recalculateMarketIntelValue(id);

    for (const path of [
      "/admin/market-intel/watch-center",
      "/admin/market-intel/deals",
      "/admin/market-intel/buy",
      "/admin/market-intel/growth-specs",
      "/admin/market-intel/purchases",
      "/admin/market-intel/portfolio",
      `/admin/market-intel/comps/${id}`,
    ]) {
      revalidatePath(path);
    }

    const accepted = Number(scan.candidatesAccepted || 0);
    const created = Number(scan.ingest.created || 0);
    const updated = Number(scan.ingest.updated || 0);
    const scored = Number(scan.ingest.scored || 0);
    const message = `Tracked today: ${accepted} exact live match${accepted === 1 ? "" : "es"}; ${created} new, ${updated} refreshed, ${scored} scored. Market snapshot now uses ${market.sample_size} verified comp${market.sample_size === 1 ? "" : "s"}.`;

    if (json) {
      return NextResponse.json(
        {
          success: true,
          identityId: id,
          message,
          scan: {
            accepted,
            created,
            updated,
            scored,
            errors: scan.ingest.errors,
          },
          market,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${id}?saved=value&tracked=1`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to track this exact card today.";

    if (json) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${id}?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
