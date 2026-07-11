import {
  INSTACOMP_JOB_ITEM_TABLE,
  InstaCompJobServerError,
  cleanInstaCompText,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  readInstaCompJson,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
  throwInstaCompRpcError,
} from "../../../../../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; itemId: string }>;
};

function parseResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      "result must be a JSON object.",
      400,
      "INSTACOMP_INVALID_RESULT",
    );
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > 2_000_000) {
    throw new InstaCompJobServerError(
      "One card result must be 2MB or smaller.",
      400,
      "INSTACOMP_RESULT_TOO_LARGE",
    );
  }

  return value as Record<string, unknown>;
}

function parseReviewReasons(value: unknown) {
  if (value === null || value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new InstaCompJobServerError(
      "reviewReasons must be an array of text values.",
      400,
      "INSTACOMP_INVALID_REVIEW_REASONS",
    );
  }

  return value
    .slice(0, 50)
    .map((reason) => cleanInstaCompText(reason, 500))
    .filter((reason): reason is string => Boolean(reason));
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const routeParams = await context.params;
    const jobId = requireUuid(routeParams.id, "Job ID");
    const itemId = requireUuid(routeParams.itemId, "Item ID");

    await getAccessibleInstaCompJob({ supabase, actor, jobId, select: "id" });

    const { data: ownedItem, error: itemError } = await supabase
      .from(INSTACOMP_JOB_ITEM_TABLE)
      .select("id")
      .eq("id", itemId)
      .eq("job_id", jobId)
      .maybeSingle();

    if (itemError) throwInstaCompDatabaseError(itemError);

    if (!ownedItem) {
      throw new InstaCompJobServerError(
        "InstaComp job item was not found.",
        404,
        "INSTACOMP_JOB_ITEM_NOT_FOUND",
      );
    }

    const body = await readInstaCompJson(request);
    const leaseToken = requireUuid(body.leaseToken, "leaseToken");
    const status = cleanInstaCompText(body.status, 40, {
      required: true,
      label: "status",
    })!;

    if (!["completed", "review_required"].includes(status)) {
      throw new InstaCompJobServerError(
        "status must be completed or review_required.",
        400,
        "INSTACOMP_INVALID_RESULT_STATUS",
      );
    }

    const result = parseResult(body.result);
    const reasons = parseReviewReasons(body.reviewReasons);
    if (
      body.draftInventoryItemId !== null &&
      body.draftInventoryItemId !== undefined &&
      body.draftInventoryItemId !== ""
    ) {
      throw new InstaCompJobServerError(
        "Draft links must be created through the seller-scoped draft endpoint.",
        400,
        "INSTACOMP_DRAFT_LINK_NOT_CLIENT_WRITABLE",
      );
    }
    const { data, error } = await supabase.rpc(
      "tcos_finish_instacomp_scan_item",
      {
        p_item_id: itemId,
        p_lease_token: leaseToken,
        p_result_status: status,
        p_result_payload: result,
        p_review_reasons: reasons,
        p_draft_inventory_item_id: null,
      },
    );

    if (error) throwInstaCompRpcError(error);

    const itemRow = Array.isArray(data) ? data[0] : data;

    if (!itemRow || typeof itemRow !== "object") {
      throw new InstaCompJobServerError(
        "The completed queue row could not be reloaded.",
        500,
        "INSTACOMP_ITEM_RELOAD_FAILED",
      );
    }

    const item = itemRow as Record<string, any>;
    const { lease_token: _leaseToken, ...safeItem } = item;
    void _leaseToken;
    const job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });

    return Response.json({ job, item: safeItem });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
