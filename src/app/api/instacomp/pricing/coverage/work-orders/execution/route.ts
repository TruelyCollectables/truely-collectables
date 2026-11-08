import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../../lib/instacomp-mutation-security";
import {
  getKingmakerWorkOrderExecution,
  updateKingmakerWorkOrderExecution,
} from "../../../../../../../lib/kingmaker-private-pricing-work-order-execution-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 250;

function fail(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  const code =
    error instanceof InstaCompJobServerError
      ? error.code
      : "KINGMAKER_EXECUTION_FAILED";
  const message =
    error instanceof Error ? error.message : "Work-order execution failed.";
  return NextResponse.json(
    { ok: false, error: message, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function batchFailure(error: unknown, index: number, attackKey: unknown) {
  return {
    index,
    attackKey: typeof attackKey === "string" ? attackKey : null,
    code:
      error instanceof InstaCompJobServerError
        ? error.code
        : "KINGMAKER_EXECUTION_ITEM_FAILED",
    error:
      error instanceof Error ? error.message : "Work-order execution failed.",
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const execution = await getKingmakerWorkOrderExecution(actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      offset: request.nextUrl.searchParams.get("offset"),
      lane: request.nextUrl.searchParams.get("lane"),
      search: request.nextUrl.searchParams.get("search"),
      sort: request.nextUrl.searchParams.get("sort"),
    });
    return NextResponse.json(
      { ok: true, execution, sourceDisclosure: null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json(
        {
          ok: false,
          error: "A JSON request body is required.",
          code: "KINGMAKER_EXECUTION_BODY_REQUIRED",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    if (Array.isArray(body.items)) {
      if (body.items.length < 1) {
        return NextResponse.json(
          {
            ok: false,
            error: "At least one work order is required.",
            code: "KINGMAKER_EXECUTION_BATCH_EMPTY",
          },
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
      if (body.items.length > MAX_BATCH_SIZE) {
        return NextResponse.json(
          {
            ok: false,
            error: `A maximum of ${MAX_BATCH_SIZE} work orders may be updated at once.`,
            code: "KINGMAKER_EXECUTION_BATCH_TOO_LARGE",
          },
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }

      const workOrders: unknown[] = [];
      const failures: ReturnType<typeof batchFailure>[] = [];
      for (const [index, item] of body.items.entries()) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          failures.push(
            batchFailure(
              new Error("Each batch item must be a JSON object."),
              index,
              null,
            ),
          );
          continue;
        }
        const input = item as Record<string, unknown>;
        try {
          workOrders.push(await updateKingmakerWorkOrderExecution(actor, input));
        } catch (error) {
          failures.push(batchFailure(error, index, input.attackKey));
        }
      }

      return NextResponse.json(
        {
          ok: failures.length === 0,
          batch: {
            requested: body.items.length,
            completed: workOrders.length,
            failed: failures.length,
            workOrders,
            failures,
          },
          sourceDisclosure: null,
        },
        {
          status: failures.length === body.items.length ? 409 : 200,
          headers: { "cache-control": "no-store" },
        },
      );
    }

    const workOrder = await updateKingmakerWorkOrderExecution(actor, body);
    return NextResponse.json(
      { ok: true, workOrder, sourceDisclosure: null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
