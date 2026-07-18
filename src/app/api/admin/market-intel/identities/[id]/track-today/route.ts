import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { trackMarketIntelIdentityToday } from "../../../../../../../lib/market-intel-track-today";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const json = wantsJson(request);

  try {
    const result = await trackMarketIntelIdentityToday(id);

    if (json) {
      return NextResponse.json(
        { success: true, ...result },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${id}?saved=value&tracked=1`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to track this exact card today.";

    if (json) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

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
