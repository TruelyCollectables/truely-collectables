import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../lib/instacomp-job-server";
import { getKingmakerPrivatePricingCoverage } from "../../../../../lib/kingmaker-private-pricing-coverage-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const coverage = await getKingmakerPrivatePricingCoverage(actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
      gapType: request.nextUrl.searchParams.get("gapType"),
      sport: request.nextUrl.searchParams.get("sport"),
      search: request.nextUrl.searchParams.get("search"),
    });

    return NextResponse.json(
      {
        ok: true,
        coverage,
        sourceDisclosure: null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof InstaCompJobServerError
      ? error.status
      : 500;
    const code = error instanceof InstaCompJobServerError
      ? error.code
      : "KINGMAKER_PRIVATE_PRICING_COVERAGE_FAILED";
    const message = error instanceof Error
      ? error.message
      : "Private pricing coverage could not be loaded.";

    return NextResponse.json(
      { ok: false, error: message, code },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
