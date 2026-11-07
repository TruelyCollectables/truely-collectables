import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../../../../lib/instacomp-job-server";
import { getKingmakerWorkOrderTargetHistory } from "../../../../../../../../lib/kingmaker-private-pricing-work-order-target-history-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  const code =
    error instanceof InstaCompJobServerError
      ? error.code
      : "KINGMAKER_TARGET_HISTORY_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "KINGMAKER work-order history failed.";
  return NextResponse.json(
    { ok: false, error: message, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const history = await getKingmakerWorkOrderTargetHistory(actor, {
      attackKey: request.nextUrl.searchParams.get("attackKey"),
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
    });
    return NextResponse.json(
      { ok: true, history, sourceDisclosure: null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
