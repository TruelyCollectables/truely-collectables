import {
  buildTcosCardKnowledgeDraft,
  trustStatusForConfirmedCount,
  type TcosCardKnowledgeResultPayload,
} from "../../../../../../lib/instacomp-card-knowledge";
import {
  INSTACOMP_JOB_ITEM_TABLE,
  InstaCompJobServerError,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  readInstaCompJson,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
} from "../../../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const KNOWLEDGE_ENTRY_TABLE = "tcos_card_knowledge_entries";
const KNOWLEDGE_OBSERVATION_TABLE = "tcos_card_knowledge_observations";

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function cleanUuidList(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      try {
        return requireUuid(String(item), "Item ID");
      } catch {
        return null;
      }
    })
    .filter((item): item is string => Boolean(item));
}

function isKnowledgeSchemaMissing(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes(KNOWLEDGE_ENTRY_TABLE) ||
    message.includes(KNOWLEDGE_OBSERVATION_TABLE) ||
    message.includes("knowledge_entry_id") ||
    message.includes("knowledge_saved_at")
  );
}

function schemaError() {
  return new InstaCompJobServerError(
    "TCOS Card Knowledge Base tables are not installed yet. Apply supabase/migrations/20260716170000_create_tcos_card_knowledge_base.sql, then process the saved lot again.",
    503,
    "INSTACOMP_KNOWLEDGE_SCHEMA_MISSING",
  );
}

async function refreshTrustStatus(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  entryId: string;
  now: string;
}) {
  const { count, error: countError } = await params.supabase
    .from(KNOWLEDGE_OBSERVATION_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("knowledge_entry_id", params.entryId)
    .eq("confirmation_status", "operator_confirmed");

  if (countError) {
    if (isKnowledgeSchemaMissing(countError)) throw schemaError();
    throwInstaCompDatabaseError(countError);
  }

  const confirmedCount = count || 0;
  const trustStatus = trustStatusForConfirmedCount(confirmedCount);
  const updates = {
    confirmed_count: confirmedCount,
    trust_status: trustStatus,
    trusted_at: trustStatus === "tcos_trusted" ? params.now : null,
    last_seen_at: params.now,
  };
  const { data, error } = await params.supabase
    .from(KNOWLEDGE_ENTRY_TABLE)
    .update(updates)
    .eq("id", params.entryId)
    .select("id,identity_fingerprint,title,confirmed_count,trust_status")
    .single();

  if (error) {
    if (isKnowledgeSchemaMissing(error)) throw schemaError();
    throwInstaCompDatabaseError(error);
  }

  return data as Record<string, any>;
}

async function processItemIntoKnowledgeBase(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  job: Record<string, any>;
  item: Record<string, any>;
  now: string;
}) {
  const resultPayload = objectRecord(
    params.item.result_payload,
  ) as TcosCardKnowledgeResultPayload;
  const draft = buildTcosCardKnowledgeDraft({
    resultPayload,
    fallbackTitle: params.item.front_original_filename,
  });

  if (!resultPayload.ok || !draft) {
    return {
      status: "skipped" as const,
      reason: "missing scan result identity",
    };
  }

  const ai = objectRecord(resultPayload.ai);
  const stats = objectRecord(resultPayload.stats);
  const soldStats = objectRecord(resultPayload.soldStats);
  const upsertPayload = {
    identity_fingerprint: draft.identityFingerprint,
    title: draft.title,
    year: draft.year,
    brand: draft.brand,
    set_name: draft.setName,
    card_number: draft.cardNumber,
    player: draft.player,
    parallel: draft.parallel,
    variation: draft.variation,
    serial_run: draft.serialRun,
    serial_number: draft.serialNumber,
    team: draft.team,
    sport: draft.sport,
    is_rookie: draft.isRookie,
    is_auto: draft.isAuto,
    is_relic: draft.isRelic,
    latest_scan_job_id: params.job.id,
    latest_scan_item_id: params.item.id,
    latest_scan_id: resultPayload.scanId || null,
    front_image_sha256: params.item.front_image_sha256 || null,
    back_image_sha256: params.item.back_image_sha256 || null,
    front_storage_path: params.item.front_storage_path || null,
    back_storage_path: params.item.back_storage_path || null,
    ai_result: ai,
    operator_corrections: objectRecord(resultPayload.operatorCorrections),
    catalog_evidence: objectRecord(resultPayload.catalogEvidence),
    consensus: objectRecord(resultPayload.consensus),
    market_snapshot: {
      stats,
      soldStats,
      suggestedPrice: stats.suggestedPrice ?? null,
    },
    source_coverage: Array.isArray(resultPayload.sourceCoverage)
      ? resultPayload.sourceCoverage
      : [],
    result_payload: resultPayload,
    last_seen_at: params.now,
  };

  const { data: entry, error: entryError } = await params.supabase
    .from(KNOWLEDGE_ENTRY_TABLE)
    .upsert(upsertPayload, { onConflict: "identity_fingerprint" })
    .select("id,identity_fingerprint,title,confirmed_count,trust_status")
    .single();

  if (entryError) {
    if (isKnowledgeSchemaMissing(entryError)) throw schemaError();
    throwInstaCompDatabaseError(entryError);
  }

  const { data: existingObservation, error: existingObservationError } =
    await params.supabase
      .from(KNOWLEDGE_OBSERVATION_TABLE)
      .select("id,knowledge_entry_id")
      .eq("source_scan_item_id", params.item.id)
      .maybeSingle();

  if (existingObservationError) {
    if (isKnowledgeSchemaMissing(existingObservationError)) throw schemaError();
    throwInstaCompDatabaseError(existingObservationError);
  }

  const oldEntryId =
    existingObservation?.knowledge_entry_id &&
    existingObservation.knowledge_entry_id !== entry.id
      ? String(existingObservation.knowledge_entry_id)
      : null;
  const { error: observationError } = await params.supabase
    .from(KNOWLEDGE_OBSERVATION_TABLE)
    .upsert(
      {
        knowledge_entry_id: entry.id,
        source_scan_job_id: params.job.id,
        source_scan_item_id: params.item.id,
        source_scan_id: resultPayload.scanId || null,
        confirmation_status: "operator_confirmed",
        title: draft.title,
        front_image_sha256: params.item.front_image_sha256 || null,
        back_image_sha256: params.item.back_image_sha256 || null,
        ai_result: ai,
        operator_corrections: objectRecord(resultPayload.operatorCorrections),
        catalog_evidence: objectRecord(resultPayload.catalogEvidence),
        consensus: objectRecord(resultPayload.consensus),
        result_payload: resultPayload,
        observed_at: params.now,
      },
      { onConflict: "source_scan_item_id" },
    );

  if (observationError) {
    if (isKnowledgeSchemaMissing(observationError)) throw schemaError();
    throwInstaCompDatabaseError(observationError);
  }

  const refreshedEntry = await refreshTrustStatus({
    supabase: params.supabase,
    entryId: entry.id,
    now: params.now,
  });

  if (oldEntryId) {
    await refreshTrustStatus({
      supabase: params.supabase,
      entryId: oldEntryId,
      now: params.now,
    });
  }

  const { error: itemUpdateError } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .update({
      knowledge_entry_id: entry.id,
      knowledge_saved_at: params.now,
    })
    .eq("id", params.item.id)
    .eq("job_id", params.job.id);

  if (itemUpdateError) {
    if (isKnowledgeSchemaMissing(itemUpdateError)) throw schemaError();
    throwInstaCompDatabaseError(itemUpdateError);
  }

  return {
    status: "processed" as const,
    entry: refreshedEntry,
    duplicateObservation: Boolean(existingObservation),
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const routeParams = await context.params;
    const jobId = requireUuid(routeParams.id, "Job ID");
    const body = await readInstaCompJson(request);
    const requestedItemIds = cleanUuidList(body.itemIds);
    const job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
      select: "id,store_id,seller_account_id,status",
    });

    let query = supabase
      .from(INSTACOMP_JOB_ITEM_TABLE)
      .select(
        [
          "id",
          "job_id",
          "status",
          "front_original_filename",
          "front_storage_path",
          "back_storage_path",
          "front_image_sha256",
          "back_image_sha256",
          "result_payload",
        ].join(","),
      )
      .eq("job_id", job.id)
      .in("status", ["completed", "review_required"])
      .order("position", { ascending: true })
      .limit(500);

    if (requestedItemIds.length) {
      query = query.in("id", requestedItemIds);
    }

    const { data: items, error: itemsError } = await query;

    if (itemsError) {
      if (isKnowledgeSchemaMissing(itemsError)) throw schemaError();
      throwInstaCompDatabaseError(itemsError);
    }

    const now = new Date().toISOString();
    const processed: Array<Record<string, any>> = [];
    const skipped: Array<Record<string, any>> = [];

    for (const item of ((items || []) as Array<Record<string, any>>)) {
      const result = await processItemIntoKnowledgeBase({
        supabase,
        job,
        item: item as Record<string, any>,
        now,
      });

      if (result.status === "processed") {
        processed.push({
          itemId: item.id,
          entry: result.entry,
          duplicateObservation: result.duplicateObservation,
        });
      } else {
        skipped.push({
          itemId: item.id,
          reason: result.reason,
        });
      }
    }

    const trustedCount = processed.filter(
      (item) => item.entry?.trust_status === "tcos_trusted",
    ).length;

    return Response.json({
      ok: true,
      processedCount: processed.length,
      skippedCount: skipped.length,
      trustedCount,
      learningCount: processed.length - trustedCount,
      processed,
      skipped,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
