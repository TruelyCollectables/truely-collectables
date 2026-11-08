import { NextRequest, NextResponse } from "next/server";
import { scanEbayForPremiumIdentityCandidates } from "../../../../../../lib/market-intel-baseball-premium-enforcement";
import { isAuthorizedMarketIntelIngest } from "../../../../../../lib/market-intel-ingestion";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await scanEbayForPremiumIdentityCandidates({
      maxSubjects: Number(request.nextUrl.searchParams.get("maxSubjects") || 5),
      resultsPerQuery: Number(
        request.nextUrl.searchParams.get("resultsPerQuery") || 15,
      ),
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
            : "Unable to run licensed-card discovery.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
