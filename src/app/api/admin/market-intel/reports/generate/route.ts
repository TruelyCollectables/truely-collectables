import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { generateFreshDailyMarketIntelReport } from "../../../../../../lib/market-intel-daily-refresh";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const result = await generateFreshDailyMarketIntelReport();
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?generated=1&reportId=${result.report.id}&refreshStatus=${result.refresh.status}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to refresh sources and generate report.";
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
