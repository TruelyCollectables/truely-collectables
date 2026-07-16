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
    const reason = cleanInstaCompText(body.reason, 4000, {
      required: true,
      label: "reason",
    })!;
    const { data, error } = await supabase.rpc(
      "tcos_requeue_instacomp_scan_item",
      {
        p_item_id: itemId,
        p_reason: reason,
      },
    );

    if (error) throwInstaCompRpcError(error);

    const itemRow = Array.isArray(data) ? data[0] : data;

    if (!itemRow || typeof itemRow !== "object") {
      throw new InstaCompJobServerError(
        "The requeued row could not be reloaded.",
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
