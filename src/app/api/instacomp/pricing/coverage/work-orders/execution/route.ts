import { NextRequest, NextResponse } from "next/server";
import { InstaCompJobServerError, requireInstaCompJobActor } from "../../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../../lib/instacomp-mutation-security";
import { getKingmakerWorkOrderExecution, updateKingmakerWorkOrderExecution } from "../../../../../../../lib/kingmaker-private-pricing-work-order-execution-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  const code = error instanceof InstaCompJobServerError ? error.code : "KINGMAKER_EXECUTION_FAILED";
  const message = error instanceof Error ? error.message : "Work-order execution failed.";
  return NextResponse.json({ ok: false, error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const execution = await getKingmakerWorkOrderExecution(actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
      lane: request.nextUrl.searchParams.get("lane"),
    });
    return NextResponse.json({ ok: true, execution, sourceDisclosure: null }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: "A JSON request body is required.", code: "KINGMAKER_EXECUTION_BODY_REQUIRED" }, { status: 400, headers: { "cache-control": "no-store" } });
    const workOrder = await updateKingmakerWorkOrderExecution(actor, body);
    return NextResponse.json({ ok: true, workOrder, sourceDisclosure: null }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return fail(error); }
}
