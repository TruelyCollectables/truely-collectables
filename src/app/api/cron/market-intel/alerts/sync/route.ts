import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedMarketIntelIngest } from "../../../../../../lib/market-intel-ingestion";
import { syncMarketIntelAlertOutbox } from "../../../../../../lib/market-intel-reporting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncMarketIntelAlertOutbox();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to sync alert outbox.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
