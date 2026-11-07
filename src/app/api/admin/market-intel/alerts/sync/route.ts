import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { syncAllMarketIntelAlerts } from "../../../../../../lib/market-intel-alert-sync";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const result = await syncAllMarketIntelAlerts();
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?synced=1&created=${result.created}&expired=${result.expired}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync alerts.";
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
