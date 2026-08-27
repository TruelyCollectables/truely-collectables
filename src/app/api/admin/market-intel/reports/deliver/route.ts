import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { deliverFreshDailyMarketIntelReport } from "../../../../../../lib/market-intel-daily-delivery";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const reportId = String(formData.get("reportId") ?? "").trim() || undefined;
    const result = await deliverFreshDailyMarketIntelReport(reportId);
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/delivery?reportDelivered=${result.delivered ? "1" : "already"}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to deliver report.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/delivery?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
