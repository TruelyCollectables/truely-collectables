import { NextRequest, NextResponse } from "next/server";
import { deliverPendingMarketIntelAlerts } from "../../../../../../../lib/market-intel-delivery";
import { isAuthorizedMarketIntelIngest } from "../../../../../../../lib/market-intel-ingestion";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 10);
    const result = await deliverPendingMarketIntelAlerts(limit);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to deliver alerts.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
