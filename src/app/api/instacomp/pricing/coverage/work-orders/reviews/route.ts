import { NextRequest, NextResponse } from "next/server";
import { InstaCompJobServerError, requireInstaCompJobActor } from "../../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../../lib/instacomp-mutation-security";
import { getKingmakerWorkOrderReviews, scheduleKingmakerWorkOrderReview } from "../../../../../../../lib/kingmaker-private-pricing-work-order-reviews-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  const code = error instanceof InstaCompJobServerError ? error.code : "KINGMAKER_REVIEW_FAILED";
  const message = error instanceof Error ? error.message : "Review scheduling failed.";
  return NextResponse.json({ ok: false, error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const reviews = await getKingmakerWorkOrderReviews(actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
      reviewState: request.nextUrl.searchParams.get("reviewState"),
    });
    return NextResponse.json({ ok: true, reviews, sourceDisclosure: null }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: "A JSON request body is required.", code: "KINGMAKER_REVIEW_BODY_REQUIRED" }, { status: 400, headers: { "cache-control": "no-store" } });
    const review = await scheduleKingmakerWorkOrderReview(actor, body);
    return NextResponse.json({ ok: true, review, sourceDisclosure: null }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return fail(error); }
}
