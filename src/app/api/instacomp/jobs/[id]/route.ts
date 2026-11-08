import {
  INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS,
  INSTACOMP_JOB_ITEM_TABLE,
  INSTACOMP_JOB_TABLE,
  InstaCompJobServerError,
  addInstaCompRecoveryUrls,
  applyInstaCompJobActorScope,
  boundedInstaCompInteger,
  cleanInstaCompText,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  readInstaCompJson,
  refreshInstaCompJobCounts,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
} from "../../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECOVERY_ITEM_SELECT = [
  "id",
  "job_id",
  "position",
  "client_item_id",
  "status",
  "front_original_filename",
  "back_original_filename",
  "front_content_type",
  "back_content_type",
  "front_size_bytes",
  "back_size_bytes",
  "front_storage_path",
  "back_storage_path",
  "front_image_sha256",
  "back_image_sha256",
  "detail_storage_paths",
  "pairing_confidence",
  "attempt_count",
  "max_attempts",
  "next_attempt_at",
  "lease_owner",
  "lease_expires_at",
  "processing_started_at",
  "completed_at",
  "player",
  "year",
  "brand",
  "set_name",
  "card_number",
  "parallel",
  "serial_number",
  "team",
  "sport",
  "is_rookie",
  "is_auto",
  "is_relic",
  "condition_guess",
  "confidence",
  "search_query",
  "market_price",
  "suggested_price",
  "ocr_provider",
  "analysis_model",
  "result_payload",
  "review_reasons",
  "last_error_code",
  "last_error",
  "draft_inventory_item_id",
  "drafted_at",
  "trade_collection_item_id",
  "trade_available_at",
  "created_at",
  "updated_at",
].join(",");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const { id } = await context.params;
    const jobId = requireUuid(id, "Job ID");
    let job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });

    if (job.status === "cancelling") {
      await refreshInstaCompJobCounts(supabase, jobId);
      job = await getAccessibleInstaCompJob({ supabase, actor, jobId });
    }
    const url = new URL(request.url);
    const limit = boundedInstaCompInteger({
      value: url.searchParams.get("limit"),
      label: "limit",
      minimum: 1,
      maximum: 50,
      fallback: 25,
    });
    const afterPosition = boundedInstaCompInteger({
      value: url.searchParams.get("afterPosition"),
      label: "afterPosition",
      minimum: -1,
      maximum: 499,
      fallback: -1,
    });
    const includeRecovery =
      url.searchParams.get("includeRecovery") === "true";
    const { data, error } = await supabase
      .from(INSTACOMP_JOB_ITEM_TABLE)
      .select(RECOVERY_ITEM_SELECT)
      .eq("job_id", jobId)
      .gt("position", afterPosition)
      .order("position", { ascending: true })
      .limit(limit);

    if (error) throwInstaCompDatabaseError(error);

    const rows = (data || []) as Array<Record<string, any>>;
    const items: Array<Record<string, any>> = includeRecovery
      ? ((await addInstaCompRecoveryUrls(supabase, rows)) as Array<
          Record<string, any>
        >)
      : rows;
    const lastPosition = items.length
      ? Number(items[items.length - 1]?.position)
      : null;

    return Response.json({
      job,
      items,
      nextPosition:
        items.length === limit && lastPosition !== null ? lastPosition : null,
      hasMore: items.length === limit,
      recovery: {
        included: includeRecovery,
        expiresIn: includeRecovery
          ? INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS
          : null,
      },
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}

async function assertReadyToQueue(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  job: Record<string, any>;
}) {
  const { data, error } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .select("id,status")
    .eq("job_id", params.job.id);

  if (error) throwInstaCompDatabaseError(error);

  const items = data || [];

  if (items.length !== Number(params.job.total_items)) {
    throw new InstaCompJobServerError(
      `Register all ${params.job.total_items} card rows before queueing this job.`,
      409,
      "INSTACOMP_JOB_INCOMPLETE",
    );
  }

  const awaitingUpload = items.filter(
    (item) => item.status === "awaiting_upload",
  ).length;

  if (awaitingUpload) {
    throw new InstaCompJobServerError(
      `${awaitingUpload} card row${awaitingUpload === 1 ? " is" : "s are"} still awaiting image upload confirmation.`,
      409,
      "INSTACOMP_JOB_UPLOADS_INCOMPLETE",
    );
  }
}

async function forceCancelInstaCompJobItems(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  jobId: string;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .update({
      status: "cancelled",
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null,
      draft_reservation_token: null,
      draft_reservation_expires_at: null,
      completed_at: now,
      last_error_code: "job_force_cancelled",
      last_error: "The InstaComp™ job was force-cancelled by Clear Batch.",
    })
    .eq("job_id", params.jobId)
    .in("status", [
      "awaiting_upload",
      "queued",
      "processing",
      "retry_wait",
      "failed",
    ]);

  if (error) throwInstaCompDatabaseError(error);

  const { error: reservationError } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .update({
      draft_reservation_token: null,
      draft_reservation_expires_at: null,
    })
    .eq("job_id", params.jobId)
    .not("draft_reservation_token", "is", null);

  if (reservationError) throwInstaCompDatabaseError(reservationError);
}

export async function PATCH(request: Request, context: RouteContext) {
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
    const updates: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      updates.name =
        cleanInstaCompText(body.name, 200, {
          required: true,
          label: "name",
        }) || job.name;
    }

    if (Object.prototype.hasOwnProperty.call(body, "requestedConcurrency")) {
      updates.requested_concurrency = boundedInstaCompInteger({
        value: body.requestedConcurrency,
        label: "requestedConcurrency",
        minimum: 1,
        maximum: 12,
      });
    }

    if (Object.prototype.hasOwnProperty.call(body, "autoCreateDrafts")) {
      if (typeof body.autoCreateDrafts !== "boolean") {
        throw new InstaCompJobServerError(
          "autoCreateDrafts must be true or false.",
          400,
          "INSTACOMP_INVALID_BOOLEAN",
        );
      }

      updates.auto_create_drafts = body.autoCreateDrafts;
    }

    const requestedStatus = cleanInstaCompText(body.status, 40);
    const cancelRequested = body.cancelRequested === true;
    const forceCancel = body.forceCancel === true;

    if (
      Object.prototype.hasOwnProperty.call(body, "forceCancel") &&
      typeof body.forceCancel !== "boolean"
    ) {
      throw new InstaCompJobServerError(
        "forceCancel must be true or false.",
        400,
        "INSTACOMP_INVALID_BOOLEAN",
      );
    }

    if (requestedStatus && !["queued", "cancelling"].includes(requestedStatus)) {
      throw new InstaCompJobServerError(
        "Clients may only queue or cancel an InstaComp™ job.",
        400,
        "INSTACOMP_JOB_STATUS_NOT_CLIENT_WRITABLE",
      );
    }

    if (requestedStatus === "queued") {
      if (String(job.status) !== "uploading") {
        throw new InstaCompJobServerError(
          `InstaComp™ job cannot be queued from ${job.status}.`,
          409,
          "INSTACOMP_INVALID_JOB_TRANSITION",
        );
      }

      await assertReadyToQueue({ supabase, job });
      updates.status = "queued";
      updates.last_error = null;
      updates.last_error_code = null;
      updates.completed_at = null;
      updates.cancel_requested_at = null;
      updates.cancelled_at = null;
    }

    if (cancelRequested || requestedStatus === "cancelling") {
      if (["completed", "cancelled"].includes(String(job.status))) {
        throw new InstaCompJobServerError(
          `InstaComp™ job cannot be cancelled from ${job.status}.`,
          409,
          "INSTACOMP_INVALID_JOB_TRANSITION",
        );
      }

      const now = new Date().toISOString();
      updates.status = "cancelling";
      updates.cancel_requested_at = now;
    }

    if (!Object.keys(updates).length) {
      throw new InstaCompJobServerError(
        "No supported job changes were provided.",
        400,
        "INSTACOMP_EMPTY_PATCH",
      );
    }

    updates.updated_at = new Date().toISOString();

    let updateQuery = supabase
      .from(INSTACOMP_JOB_TABLE)
      .update(updates)
      .eq("id", jobId);
    updateQuery = applyInstaCompJobActorScope(updateQuery, actor);

    const { data: updatedJob, error } = await updateQuery.select("*").single();

    if (error) throwInstaCompDatabaseError(error);

    if (forceCancel && (cancelRequested || requestedStatus === "cancelling")) {
      await forceCancelInstaCompJobItems({ supabase, jobId });
    }

    await refreshInstaCompJobCounts(supabase, jobId);

    const refreshedJob = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });

    return Response.json({
      job: refreshedJob || updatedJob,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
