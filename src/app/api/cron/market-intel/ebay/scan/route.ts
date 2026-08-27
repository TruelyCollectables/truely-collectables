import { NextRequest, NextResponse } from "next/server";
import { getRotatingMarketIntelIdentityIds } from "../../../../../../lib/market-intel-daily-refresh";
import { scanEbayForMarketIntel } from "../../../../../../lib/market-intel-ebay";
import { isAuthorizedMarketIntelIngest } from "../../../../../../lib/market-intel-ingestion";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = request.nextUrl.searchParams;
    const maxTargets = Number(params.get("maxTargets") || 10);
    const identityIds = await getRotatingMarketIntelIdentityIds(maxTargets);
    if (identityIds.length === 0) {
      throw new Error("No active exact-card identities are available to scan.");
    }

    const result = await scanEbayForMarketIntel({
      identityIds,
      maxTargets: identityIds.length,
      resultsPerTarget: Number(params.get("resultsPerTarget") || 10),
      minimumConfidence: Number(params.get("minimumConfidence") || 70),
    });

    return NextResponse.json(
      {
        ...result,
        rotation: {
          selectedIdentityCount: identityIds.length,
          selectedIdentityIds: identityIds,
          cadenceHours: 6,
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to scan eBay.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
