import { NextRequest, NextResponse } from "next/server";
import {
  cleanupStaleMarketIntelListings,
  isAuthorizedMarketIntelIngest,
} from "../../../../../lib/market-intel-ingestion";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = request.nextUrl.searchParams.get("staleAfterHours");
    const staleAfterHours = raw ? Number(raw) : 26;
    const result = await cleanupStaleMarketIntelListings(staleAfterHours);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to clean listings.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
