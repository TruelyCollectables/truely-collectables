import { NextRequest, NextResponse } from "next/server";
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
    const result = await scanEbayForMarketIntel({
      maxTargets: Number(params.get("maxTargets") || 10),
      resultsPerTarget: Number(params.get("resultsPerTarget") || 10),
      minimumConfidence: Number(params.get("minimumConfidence") || 70),
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
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
