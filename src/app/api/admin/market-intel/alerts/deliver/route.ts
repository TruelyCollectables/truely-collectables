import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { deliverPendingMarketIntelAlerts } from "../../../../../../lib/market-intel-delivery";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const limit = Number(formData.get("limit") || 10);
    const result = await deliverPendingMarketIntelAlerts(limit);
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?alertsDelivered=${result.delivered}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to deliver alerts.";
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
