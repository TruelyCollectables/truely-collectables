import { NextResponse } from "next/server";
import { importEbayListingsPage } from "../../../../lib/ebay-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await importEbayListingsPage({
      offset: Number(url.searchParams.get("offset") || "0"),
      limit: Number(url.searchParams.get("limit") || "50"),
      runId: url.searchParams.get("runId") || undefined,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const message = error.message || "eBay import failed";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: message.includes("disabled") ? 403 : 500 },
    );
  }
}
