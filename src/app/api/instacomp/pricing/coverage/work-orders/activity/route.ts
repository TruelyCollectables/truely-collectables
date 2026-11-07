import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../../../lib/instacomp-job-server";
import { getKingmakerPrivatePricingWorkOrderActivity } from "../../../../../../../lib/kingmaker-private-pricing-work-order-activity-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const activity = await getKingmakerPrivatePricingWorkOrderActivity(actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
      action: request.nextUrl.searchParams.get("action"),
      actorType: request.nextUrl.searchParams.get("actorType"),
    });

    return NextResponse.json(
      { ok: true, activity, sourceDisclosure: null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof InstaCompJobServerError ? error.status : 500;
    const code = error instanceof InstaCompJobServerError
      ? error.code
      : "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_FAILED";
    const message = error instanceof Error
      ? error.message
      : "Private pricing work-order activity could not be loaded.";

    return NextResponse.json(
      { ok: false, error: message, code },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
