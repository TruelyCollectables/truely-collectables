import { NextRequest, NextResponse } from "next/server";
import { scanEbayForGrowthSpecIdentities } from "../../../../../../lib/market-intel-growth-scan";
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
    const result = await scanEbayForGrowthSpecIdentities({
      maxTargets: Number(params.get("maxTargets") || 25),
      resultsPerTarget: Number(params.get("resultsPerTarget") || 15),
      minimumConfidence: Number(params.get("minimumConfidence") || 80),
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to scan eBay Growth Spec identities.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
