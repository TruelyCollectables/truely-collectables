import { NextRequest, NextResponse } from "next/server";
import {
  ingestMarketIntelListings,
  isAuthorizedMarketIntelIngest,
  type MarketIntelIngestItem,
} from "../../../../../lib/market-intel-ingestion";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      items?: MarketIntelIngestItem[];
    };
    const result = await ingestMarketIntelListings(body.items || []);

    return NextResponse.json(result, {
      status: result.errors > 0 ? 207 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to ingest listings.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
