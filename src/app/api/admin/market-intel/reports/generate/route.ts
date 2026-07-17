import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { generateDailyMarketIntelReport } from "../../../../../../lib/market-intel-reporting";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const result = await generateDailyMarketIntelReport();
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?generated=1&reportId=${result.report.id}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate report.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
