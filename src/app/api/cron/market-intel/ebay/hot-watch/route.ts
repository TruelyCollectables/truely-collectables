import { NextRequest, NextResponse } from "next/server";
import { runMarketIntelProfitHunterHotWatch } from "../../../../../../lib/market-intel-ebay-profit-hunter";
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
    const result = await runMarketIntelProfitHunterHotWatch({
      maxSubjects: Number(params.get("maxSubjects") || 3),
      maxIdentities: Number(params.get("maxIdentities") || 4),
      resultsPerQuery: Number(params.get("resultsPerQuery") || 5),
      minimumConfidence: Number(params.get("minimumConfidence") || 55),
      maxQueriesPerIdentity: Number(params.get("maxQueriesPerIdentity") || 8),
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
            : "Unable to run the Profit Hunter Hot Watch scanner.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
