import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { cleanupStaleMarketIntelListings } from "../../../../../../lib/market-intel-ingestion";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const raw = String(formData.get("staleAfterHours") ?? "26").trim();
    const staleAfterHours = Number(raw);
    const result = await cleanupStaleMarketIntelListings(staleAfterHours);

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/ingestion?cleaned=1&stale=${result.markedStale}&ended=${result.endedAuctions}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to clean listings.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/ingestion?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
