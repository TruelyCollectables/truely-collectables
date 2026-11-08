import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { recalculateMarketIntelValue } from "../../../../../../../lib/market-intel-comps";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    await recalculateMarketIntelValue(id);
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${id}?saved=value`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to recalculate value.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${id}?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
