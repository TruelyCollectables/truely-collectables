import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../lib/instacomp-mutation-security";
import {
  getKingmakerPrivatePricingWorkOrders,
  saveKingmakerPrivatePricingWorkOrder,
} from "../../../../../../lib/kingmaker-private-pricing-work-orders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown, fallbackCode: string, fallbackMessage: string) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  const code = error instanceof InstaCompJobServerError ? error.code : fallbackCode;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json(
    { ok: false, error: message, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const workOrders = await getKingmakerPrivatePricingWorkOrders(actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
      status: request.nextUrl.searchParams.get("status"),
      search: request.nextUrl.searchParams.get("search"),
    });

    return NextResponse.json(
      { ok: true, workOrders, sourceDisclosure: null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return failure(
      error,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_FAILED",
      "Private pricing work orders could not be loaded.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json(
        {
          ok: false,
          error: "A JSON request body is required.",
          code: "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_BODY_REQUIRED",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const workOrder = await saveKingmakerPrivatePricingWorkOrder(actor, body);
    return NextResponse.json(
      { ok: true, workOrder, sourceDisclosure: null },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return failure(
      error,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_SAVE_FAILED",
      "Private pricing work order could not be saved.",
    );
  }
}
