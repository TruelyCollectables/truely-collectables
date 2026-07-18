import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { endMarketIntelListing } from "../../../../../../../lib/market-intel-listing-state";
import { requestOrigin } from "../../../../../../../lib/request-origin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const origin = requestOrigin(request);
  const json = wantsJson(request);

  try {
    const ended = await endMarketIntelListing(id, {
      onlyIfActive: true,
      metadata: {
        end_reason: "manual_admin",
        end_source: "market-intel-deal-desk",
      },
    });

    if (json) {
      return NextResponse.json({
        success: true,
        listingId: ended.id,
        message: `Ended listing${ended.quantity ? ` with qty ${ended.quantity}` : ""}.`,
      });
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/deals?ended=1",
        origin,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to end listing.";
    if (json) {
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/deals?error=${encodeURIComponent(message)}`,
        origin,
        handoff,
      ),
      303,
    );
  }
}
