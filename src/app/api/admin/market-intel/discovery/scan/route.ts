import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { scanEbayForPremiumIdentityCandidates } from "../../../../../../lib/market-intel-baseball-premium-enforcement";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const formData = await request.formData();
    const result = await scanEbayForPremiumIdentityCandidates({
      maxSubjects: Number(formData.get("maxSubjects") || 5),
      resultsPerQuery: Number(formData.get("resultsPerQuery") || 15),
    });
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?scanned=1&created=${result.created}&updated=${result.updated}&parsed=${result.parsed}&policyRejected=${result.premiumPolicy.candidatesRejected}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run discovery scan.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
