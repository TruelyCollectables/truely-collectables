import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { seedDillonLewisHoardTarget } from "../../../../../../lib/market-intel-hoard-target-seed";
import { seedMarketIntelGrowthProspects } from "../../../../../../lib/market-intel-prospect-seed";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const result = await seedMarketIntelGrowthProspects();
    await seedDillonLewisHoardTarget();
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/growth-specs?seeded=${result.total + 1}`,
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
