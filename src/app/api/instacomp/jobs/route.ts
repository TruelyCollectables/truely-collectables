import {
  INSTACOMP_JOB_MAX_ITEMS,
  INSTACOMP_JOB_STATUSES,
  INSTACOMP_JOB_TABLE,
  InstaCompJobServerError,
  applyInstaCompJobActorScope,
  boundedInstaCompInteger,
  cleanInstaCompText,
  instaCompJobErrorResponse,
  readInstaCompJson,
  refreshInstaCompJobCounts,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  throwInstaCompDatabaseError,
} from "../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalJsonRecord(value: unknown, label: string) {
  if (value === null || value === undefined) return {};

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      `${label} must be a JSON object.`,
      400,
      "INSTACOMP_INVALID_OBJECT",
    );
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > 32_000) {
    throw new InstaCompJobServerError(
      `${label} must be 32KB or smaller.`,
      400,
      "INSTACOMP_OBJECT_TOO_LARGE",
    );
  }

  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const body = await readInstaCompJson(request);
    const clientBatchId = cleanInstaCompText(body.clientBatchId, 200, {
      required: true,
      label: "clientBatchId",
    })!;
    const name = cleanInstaCompText(body.name, 200) || "InstaComp card lot";
    const totalItems = boundedInstaCompInteger({
      value: body.totalItems,
      label: "totalItems",
      minimum: 1,
      maximum: INSTACOMP_JOB_MAX_ITEMS,
    });
    const requestedConcurrency = boundedInstaCompInteger({
      value: body.requestedConcurrency,
      label: "requestedConcurrency",
      minimum: 1,
      maximum: 6,
      fallback: 3,
    });
    if (
      Object.prototype.hasOwnProperty.call(body, "autoCreateDrafts") &&
      typeof body.autoCreateDrafts !== "boolean"
    ) {
      throw new InstaCompJobServerError(
        "autoCreateDrafts must be true or false.",
        400,
        "INSTACOMP_INVALID_BOOLEAN",
      );
    }

    const autoCreateDrafts = body.autoCreateDrafts === true;
    const options = optionalJsonRecord(body.options, "options");
    const metadata = optionalJsonRecord(body.metadata, "metadata");

    let existingQuery = supabase
      .from(INSTACOMP_JOB_TABLE)
      .select("*")
      .eq("client_batch_id", clientBatchId)
      .eq("actor_type", actor.type);
    existingQuery = applyInstaCompJobActorScope(existingQuery, actor);

    if (actor.type === "admin") {
      existingQuery = existingQuery.is("seller_account_id", null);
    }

    const { data: existing, error: existingError } =
      await existingQuery.maybeSingle();

    if (existingError) throwInstaCompDatabaseError(existingError);

    if (existing) {
      if (
        Number(existing.total_items) !== totalItems ||
        Number(existing.requested_concurrency) !== requestedConcurrency ||
        Boolean(existing.auto_create_drafts) !== autoCreateDrafts
      ) {
        throw new InstaCompJobServerError(
          "clientBatchId already belongs to a job with different settings.",
          409,
          "INSTACOMP_CLIENT_BATCH_CONFLICT",
        );
      }

      return Response.json({
        job: existing,
        alreadyExisted: true,
      });
    }

    let cancellingJobsQuery = supabase
      .from(INSTACOMP_JOB_TABLE)
      .select("id")
      .eq("status", "cancelling")
      .eq("actor_type", actor.type);
    cancellingJobsQuery = applyInstaCompJobActorScope(
      cancellingJobsQuery,
      actor,
    );

    if (actor.type === "admin") {
      cancellingJobsQuery = cancellingJobsQuery.is("seller_account_id", null);
    }

    const { data: cancellingJobs, error: cancellingJobsError } =
      await cancellingJobsQuery;

    if (cancellingJobsError) {
      throwInstaCompDatabaseError(cancellingJobsError);
    }

    await Promise.all(
      (cancellingJobs || []).map((row) =>
        refreshInstaCompJobCounts(supabase, row.id),
      ),
    );

    let activeJobsQuery = supabase
      .from(INSTACOMP_JOB_TABLE)
      .select("id", { count: "exact", head: true })
      .in("status", ["uploading", "queued", "processing", "cancelling"])
      .eq("actor_type", actor.type);
    activeJobsQuery = applyInstaCompJobActorScope(activeJobsQuery, actor);

    if (actor.type === "admin") {
      activeJobsQuery = activeJobsQuery.is("seller_account_id", null);
    }

    const { count: activeJobCount, error: activeJobError } =
      await activeJobsQuery;

    if (activeJobError) throwInstaCompDatabaseError(activeJobError);

    if ((activeJobCount || 0) >= 3) {
      throw new InstaCompJobServerError(
        "Finish or cancel an active InstaComp lot before creating another one.",
        429,
        "INSTACOMP_ACTIVE_JOB_LIMIT",
      );
    }

    let dailyJobsQuery = supabase
      .from(INSTACOMP_JOB_TABLE)
      .select("total_items")
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      )
      .eq("actor_type", actor.type);
    dailyJobsQuery = applyInstaCompJobActorScope(dailyJobsQuery, actor);

    if (actor.type === "admin") {
      dailyJobsQuery = dailyJobsQuery.is("seller_account_id", null);
    }

    const { data: dailyJobs, error: dailyJobError } = await dailyJobsQuery;

    if (dailyJobError) throwInstaCompDatabaseError(dailyJobError);

    const dailyCardCount = (dailyJobs || []).reduce(
      (sum, row) => sum + Number(row.total_items || 0),
      0,
    );

    if (dailyCardCount + totalItems > 1500) {
      throw new InstaCompJobServerError(
        "This account reached the 1,500-card daily InstaComp intake limit.",
        429,
        "INSTACOMP_DAILY_CARD_LIMIT",
      );
    }

    const { data: job, error } = await supabase
      .from(INSTACOMP_JOB_TABLE)
      .insert({
        store_id: actor.storeId,
        seller_account_id: actor.sellerAccountId,
        actor_type: actor.type,
        client_batch_id: clientBatchId,
        name,
        status: "uploading",
        total_items: totalItems,
        requested_concurrency: requestedConcurrency,
        auto_create_drafts: autoCreateDrafts,
        options,
        metadata,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        let replayQuery = supabase
          .from(INSTACOMP_JOB_TABLE)
          .select("*")
          .eq("client_batch_id", clientBatchId)
          .eq("actor_type", actor.type);
        replayQuery = applyInstaCompJobActorScope(replayQuery, actor);

        if (actor.type === "admin") {
          replayQuery = replayQuery.is("seller_account_id", null);
        }

        const { data: replay } = await replayQuery.maybeSingle();

        if (
          replay &&
          Number(replay.total_items) === totalItems &&
          Number(replay.requested_concurrency) === requestedConcurrency &&
          Boolean(replay.auto_create_drafts) === autoCreateDrafts
        ) {
          return Response.json({
            job: replay,
            alreadyExisted: true,
          });
        }

        throw new InstaCompJobServerError(
          "clientBatchId already belongs to another InstaComp job.",
          409,
          "INSTACOMP_CLIENT_BATCH_CONFLICT",
        );
      }

      throwInstaCompDatabaseError(error);
    }

    return Response.json(
      {
        job,
        alreadyExisted: false,
      },
      { status: 201 },
    );
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const url = new URL(request.url);
    const limit = boundedInstaCompInteger({
      value: url.searchParams.get("limit"),
      label: "limit",
      minimum: 1,
      maximum: 100,
      fallback: 50,
    });
    const status = cleanInstaCompText(url.searchParams.get("status"), 40);
    const before = cleanInstaCompText(url.searchParams.get("before"), 80);

    if (status && !INSTACOMP_JOB_STATUSES.has(status)) {
      throw new InstaCompJobServerError(
        "status is not a valid InstaComp job status.",
        400,
        "INSTACOMP_INVALID_JOB_STATUS",
      );
    }

    let query = supabase
      .from(INSTACOMP_JOB_TABLE)
      .select("*")
      .eq("actor_type", actor.type)
      .order("created_at", { ascending: false })
      .limit(limit);
    query = applyInstaCompJobActorScope(query, actor);

    if (actor.type === "admin") {
      query = query.is("seller_account_id", null);
    }

    if (status) query = query.eq("status", status);

    if (before) {
      const beforeDate = new Date(before);

      if (!Number.isFinite(beforeDate.getTime())) {
        throw new InstaCompJobServerError(
          "before must be a valid ISO date.",
          400,
          "INSTACOMP_INVALID_CURSOR",
        );
      }

      query = query.lt("created_at", beforeDate.toISOString());
    }

    const { data, error } = await query;

    if (error) throwInstaCompDatabaseError(error);

    const jobs = data || [];

    return Response.json({
      jobs,
      nextCursor:
        jobs.length === limit ? jobs[jobs.length - 1]?.created_at || null : null,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
