import {
  INSTACOMP_JOB_ITEM_STATUSES,
  INSTACOMP_JOB_ITEM_TABLE,
  InstaCompJobServerError,
  addInstaCompRecoveryUrls,
  cleanInstaCompText,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  readInstaCompJson,
  refreshInstaCompJobCounts,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
} from "../../../../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; itemId: string }>;
};

const CLIENT_ITEM_STATUSES = new Set(["cancelled"]);

const CLIENT_ITEM_TRANSITIONS: Record<string, Set<string>> = {
  awaiting_upload: new Set(["cancelled"]),
  queued: new Set(["cancelled"]),
  processing: new Set(),
  retry_wait: new Set(["cancelled"]),
  completed: new Set(["cancelled"]),
  review_required: new Set(["cancelled"]),
  failed: new Set(["cancelled"]),
  cancelled: new Set(["cancelled"]),
};

function optionalResultObject(value: unknown) {
  if (value === null || value === undefined) return null;

  if (typeof value !== "object" || Array.isArray(value)) {
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

  return value as Record<string, any>;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function nullableText(value: unknown, maximum: number) {
  return cleanInstaCompText(value, maximum);
}

function nullableMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function nullableConfidence(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function reviewReasons(value: unknown) {
  if (value === null || value === undefined) return null;

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

function resultUpdates(result: Record<string, any>) {
  const ai = objectValue(result.ai);
  const stats = objectValue(result.stats);
  const diagnostics = objectValue(result.ocrDiagnostics);
  const compResult = {
    providers: Array.isArray(result.providers) ? result.providers : [],
    activeComps: Array.isArray(result.activeComps) ? result.activeComps : [],
    marketValueComps: Array.isArray(result.marketValueComps)
      ? result.marketValueComps
      : [],
    soldComps: Array.isArray(result.soldComps) ? result.soldComps : [],
    remainingCards: Array.isArray(result.remainingCards)
      ? result.remainingCards
      : [],
    stats: result.stats || null,
    soldStats: result.soldStats || null,
  };
  const marketPrice = nullableMoney(stats.median);
  const suggestedPrice = nullableMoney(stats.suggestedPrice);

  return {
    player: nullableText(ai.player, 200),
    year: nullableText(ai.year, 40),
    brand: nullableText(ai.brand, 120),
    set_name: nullableText(ai.setName, 200),
    card_number: nullableText(ai.cardNumber, 80),
    parallel: nullableText(ai.parallel, 200),
    serial_number: nullableText(ai.serialNumber, 80),
    team: nullableText(ai.team, 160),
    sport: nullableText(ai.sport, 80),
    is_rookie: ai.isRookie === true,
    is_auto: ai.isAuto === true,
    is_relic: ai.isRelic === true,
    condition_guess: nullableText(ai.conditionGuess, 200),
    confidence: nullableConfidence(ai.confidence),
    search_query: nullableText(result.searchQuery, 1000),
    market_price: marketPrice,
    suggested_price: suggestedPrice,
    ocr_provider: nullableText(diagnostics.provider, 120),
    ocr_result: diagnostics,
    ai_result: ai,
    comp_result: compResult,
    source_coverage: Array.isArray(result.sourceCoverage)
      ? result.sourceCoverage
      : [],
    result_payload: result,
  };
}

async function loadItem(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  jobId: string;
  itemId: string;
}) {
  const { data, error } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .select("*")
    .eq("id", params.itemId)
    .eq("job_id", params.jobId)
    .maybeSingle();

  if (error) throwInstaCompDatabaseError(error);

  if (!data) {
    throw new InstaCompJobServerError(
      "InstaComp™ job item was not found.",
      404,
      "INSTACOMP_JOB_ITEM_NOT_FOUND",
    );
  }

  return data as Record<string, any>;
}

function publicItem(item: Record<string, any>) {
  const { lease_token: _leaseToken, ...safeItem } = item;
  void _leaseToken;
  return safeItem;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const routeParams = await context.params;
    const jobId = requireUuid(routeParams.id, "Job ID");
    const itemId = requireUuid(routeParams.itemId, "Item ID");

    await getAccessibleInstaCompJob({ supabase, actor, jobId, select: "id" });
    const item = await loadItem({ supabase, jobId, itemId });
    const [withRecovery] = await addInstaCompRecoveryUrls(supabase, [
      publicItem(item),
    ]);

    return Response.json({ item: withRecovery });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const routeParams = await context.params;
    const jobId = requireUuid(routeParams.id, "Job ID");
    const itemId = requireUuid(routeParams.itemId, "Item ID");

    await getAccessibleInstaCompJob({ supabase, actor, jobId, select: "id,status" });
    const item = await loadItem({ supabase, jobId, itemId });
    const body = await readInstaCompJson(request);
    const updates: Record<string, unknown> = {};
    const requestedStatus = cleanInstaCompText(body.status, 40);

    if (requestedStatus) {
      if (
        !INSTACOMP_JOB_ITEM_STATUSES.has(requestedStatus) ||
        !CLIENT_ITEM_STATUSES.has(requestedStatus)
      ) {
        throw new InstaCompJobServerError(
          "status is not client-writable for an InstaComp™ item.",
          400,
          "INSTACOMP_ITEM_STATUS_NOT_CLIENT_WRITABLE",
        );
      }

      if (
        requestedStatus !== item.status &&
        !CLIENT_ITEM_TRANSITIONS[String(item.status)]?.has(requestedStatus)
      ) {
        throw new InstaCompJobServerError(
          `InstaComp™ item cannot transition from ${item.status} to ${requestedStatus}.`,
          409,
          "INSTACOMP_INVALID_ITEM_TRANSITION",
        );
      }

      updates.status = requestedStatus;

      if (requestedStatus === "cancelled") {
        updates.completed_at = new Date().toISOString();
      } else {
        updates.completed_at = null;
      }

      if (requestedStatus === "cancelled") {
        updates.lease_token = null;
        updates.lease_owner = null;
        updates.lease_expires_at = null;
      }
    }

    const result = optionalResultObject(body.result);

    if (result) {
      if (!["completed", "review_required"].includes(String(item.status))) {
        throw new InstaCompJobServerError(
          "Only a completed or review-required row may receive manual result edits. Workers must finish leased rows through the complete action.",
          409,
          "INSTACOMP_RESULT_REQUIRES_TERMINAL_ITEM",
        );
      }

      Object.assign(updates, resultUpdates(result));
      updates.analysis_model = nullableText(body.analysisModel, 120);
    }

    if (Object.prototype.hasOwnProperty.call(body, "reviewReasons")) {
      updates.review_reasons = reviewReasons(body.reviewReasons) || [];
    }

    if (Object.prototype.hasOwnProperty.call(body, "error")) {
      const errorValue = body.error;
      const errorObject = objectValue(errorValue);
      const errorMessage =
        typeof errorValue === "string"
          ? cleanInstaCompText(errorValue, 4000)
          : cleanInstaCompText(errorObject.message, 4000);
      const errorCode = cleanInstaCompText(errorObject.code, 120);

      updates.last_error = errorMessage;
      updates.last_error_code = errorCode;
    }

    if (Object.prototype.hasOwnProperty.call(body, "draft")) {
      throw new InstaCompJobServerError(
        "Draft links may only be written by the seller-scoped InstaComp™ draft endpoint.",
        400,
        "INSTACOMP_DRAFT_LINK_NOT_CLIENT_WRITABLE",
      );
    }

    if (!Object.keys(updates).length) {
      throw new InstaCompJobServerError(
        "No supported item changes were provided.",
        400,
        "INSTACOMP_EMPTY_PATCH",
      );
    }

    updates.updated_at = new Date().toISOString();

    const { data: updatedItem, error } = await supabase
      .from(INSTACOMP_JOB_ITEM_TABLE)
      .update(updates)
      .eq("id", itemId)
      .eq("job_id", jobId)
      .select("*")
      .single();

    if (error) throwInstaCompDatabaseError(error);

    await refreshInstaCompJobCounts(supabase, jobId);
    const job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });

    return Response.json({ job, item: publicItem(updatedItem) });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
