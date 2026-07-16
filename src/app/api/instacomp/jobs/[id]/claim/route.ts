import {
  addInstaCompRecoveryUrls,
  boundedInstaCompInteger,
  cleanInstaCompText,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  readInstaCompJson,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompRpcError,
} from "../../../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };
const INSTACOMP_SAFE_CLAIM_LIMIT = 3;

function claimedItemForClient(item: Record<string, any>) {
  const { lease_token: leaseToken, ...safeItem } = item;

  return {
    ...safeItem,
    leaseToken,
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const { id } = await context.params;
    const jobId = requireUuid(id, "Job ID");
    const job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });
    const body = await readInstaCompJson(request);
    const workerId = cleanInstaCompText(body.workerId, 200, {
      required: true,
      label: "workerId",
    })!;
    const limit = boundedInstaCompInteger({
      value: body.limit,
      label: "limit",
      minimum: 1,
      maximum: INSTACOMP_SAFE_CLAIM_LIMIT,
      fallback: INSTACOMP_SAFE_CLAIM_LIMIT,
    });
    const leaseSeconds = boundedInstaCompInteger({
      value: body.leaseSeconds,
      label: "leaseSeconds",
      minimum: 30,
      maximum: 900,
      fallback: 300,
    });
    const { data, error } = await supabase.rpc(
      "tcos_claim_instacomp_scan_items",
      {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    );

    if (error) throwInstaCompRpcError(error);

    const claimedItems = Array.isArray(data)
      ? (data as unknown as Array<Record<string, any>>)
      : [];
    const responseItems = body.includeRecovery === true
      ? await addInstaCompRecoveryUrls(supabase, claimedItems)
      : claimedItems;
    const refreshedJob = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });

    return Response.json({
      job: refreshedJob,
      items: responseItems.map(claimedItemForClient),
      leaseSeconds,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
