import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { sendMarketIntelTestEmail } from "../../../../../../../lib/market-intel-test-email";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    await sendMarketIntelTestEmail();
    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/delivery/test?sent=1",
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to send the test email.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/delivery/test?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
