import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { scanEbayForMarketIntel } from "../../../../../../lib/market-intel-ebay";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const identityId = String(formData.get("identityId") ?? "").trim();
    const maxTargets = Number(formData.get("maxTargets") || 10);
    const resultsPerTarget = Number(formData.get("resultsPerTarget") || 10);
    const minimumConfidence = Number(
      formData.get("minimumConfidence") || 70,
    );

    const result = await scanEbayForMarketIntel({
      identityIds: identityId ? [identityId] : undefined,
      maxTargets,
      resultsPerTarget,
      minimumConfidence,
    });

    const errors = result.targetResults.filter((target) => target.error).length;
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/ebay?scanned=1&targets=${result.targetCount}&accepted=${result.candidatesAccepted}&created=${result.ingest.created}&updated=${result.ingest.updated}&priceChanges=${result.ingest.priceChanges}&errors=${errors + result.ingest.errors}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to scan eBay.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/ebay?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
