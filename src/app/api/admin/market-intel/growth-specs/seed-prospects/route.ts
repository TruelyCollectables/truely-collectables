import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { seedMarketIntelGrowthProspects } from "../../../../../../lib/market-intel-prospect-seed";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const result = await seedMarketIntelGrowthProspects();
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/growth-specs?seeded=${result.total}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load growth prospects.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/growth-specs?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
