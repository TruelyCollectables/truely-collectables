import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../../../../lib/instacomp-job-server";
import { getKingmakerWorkOrderScoreboard } from "../../../../../../../../lib/kingmaker-private-pricing-work-order-scoreboard-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  const code =
    error instanceof InstaCompJobServerError
      ? error.code
      : "KINGMAKER_SCOREBOARD_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "KINGMAKER operations scoreboard failed.";
  return NextResponse.json(
    { ok: false, error: message, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const scoreboard = await getKingmakerWorkOrderScoreboard(actor);
    return NextResponse.json(
      { ok: true, scoreboard, sourceDisclosure: null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
