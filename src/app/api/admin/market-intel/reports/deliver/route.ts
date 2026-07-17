import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { deliverDailyMarketIntelReport } from "../../../../../../lib/market-intel-delivery";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const reportId = String(formData.get("reportId") ?? "").trim() || undefined;
    const result = await deliverDailyMarketIntelReport(reportId);
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?reportDelivered=${result.delivered ? "1" : "already"}`,
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
        `/admin/market-intel/reports?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
