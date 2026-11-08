import {
  INSTACOMP_JOB_ITEM_TABLE,
  InstaCompJobServerError,
  boundedInstaCompInteger,
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
        "InstaComp™ job item was not found.",
        404,
        "INSTACOMP_JOB_ITEM_NOT_FOUND",
      );
    }

    const body = await readInstaCompJson(request);
    const leaseToken = requireUuid(body.leaseToken, "leaseToken");
    const errorCode =
      cleanInstaCompText(body.errorCode, 120) || "instacomp_scan_failed";
    const errorMessage = cleanInstaCompText(body.errorMessage, 4000, {
      required: true,
      label: "errorMessage",
    })!;

    if (
      Object.prototype.hasOwnProperty.call(body, "retryable") &&
      typeof body.retryable !== "boolean"
    ) {
      throw new InstaCompJobServerError(
        "retryable must be true or false.",
        400,
        "INSTACOMP_INVALID_BOOLEAN",
      );
    }

    const retryable = body.retryable !== false;
    const retryDelaySeconds = boundedInstaCompInteger({
      value: body.retryDelaySeconds,
      label: "retryDelaySeconds",
      minimum: 0,
      maximum: 3600,
      fallback: 30,
    });
    const { data, error } = await supabase.rpc(
      "tcos_fail_instacomp_scan_item",
      {
        p_item_id: itemId,
        p_lease_token: leaseToken,
        p_error_code: errorCode,
        p_error_message: errorMessage,
        p_retryable: retryable,
        p_retry_delay_seconds: retryDelaySeconds,
      },
    );

    if (error) throwInstaCompRpcError(error);

    const itemRow = Array.isArray(data) ? data[0] : data;

    if (!itemRow || typeof itemRow !== "object") {
      throw new InstaCompJobServerError(
        "The failed queue row could not be reloaded.",
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
