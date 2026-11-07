import {
  INSTACOMP_JOB_ITEM_TABLE,
  type InstaCompJobActor,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  readInstaCompJson,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
} from "../../../../../../lib/instacomp-job-server";
import { recordInstaCompAiLocalLesson } from "../../../../../../lib/instacomp-ai-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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

function localOperatorId(actor: InstaCompJobActor) {
  return actor.type === "seller"
    ? `seller:${actor.sellerAccountId}`
    : `store-owner:${actor.storeId}`;
}

function lessonIdentity(ai: Record<string, any>) {
  const parallel = String(ai.parallel || "").trim();
  return {
    sport: String(ai.sport || "").trim() || null,
    league: String(ai.league || "").trim() || null,
    year: String(ai.year || "").trim() || null,
    manufacturer: String(ai.manufacturer || ai.brand || "").trim() || null,
    brand: String(ai.brand || "").trim() || null,
    set_name: String(ai.setName || ai.set_name || "").trim() || null,
    subset: String(ai.subset || "").trim() || null,
    player: String(ai.player || "").trim() || null,
    team: String(ai.team || "").trim() || null,
    card_number: String(ai.cardNumber || ai.card_number || "").trim() || null,
    parallel: parallel && !/^base$/i.test(parallel) ? parallel : null,
    variation: String(ai.variation || "").trim() || null,
    serial_number: String(ai.serialNumber || ai.serial_number || "").trim() || null,
    rookie: ai.isRookie === true,
    autograph: ai.isAuto === true,
    memorabilia: ai.isRelic === true,
  };
}

async function processItem(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  actor: InstaCompJobActor;
  job: Record<string, any>;
  item: Record<string, any>;
}) {
  const resultPayload = objectRecord(params.item.result_payload);
  const ai = objectRecord(resultPayload.ai);
  if (resultPayload.ok !== true || !Object.keys(ai).length) {
    return { status: "skipped" as const, reason: "missing scan result identity" };
  }

  const internalScanId = String(ai.internalScanId || "").trim();
  if (!/^[0-9a-z-]{1,100}$/i.test(internalScanId)) {
    return { status: "skipped" as const, reason: "missing Mac-local scan receipt" };
  }

  const priorReceipt = objectRecord(resultPayload.localLearningReceipt);
  if (
    priorReceipt.authority === "mac_local" &&
    priorReceipt.internalScanId === internalScanId &&
    String(priorReceipt.lessonId || "").trim()
  ) {
    return {
      status: "processed" as const,
      duplicateObservation: true,
      entry: {
        id: String(priorReceipt.lessonId),
        trust_status: "mac_operator_confirmed",
        confirmed_count: 1,
        authority: "mac_local",
      },
    };
  }

  const lesson = await recordInstaCompAiLocalLesson({
    scanId: internalScanId,
    state: "operator_confirmed",
    operatorId: localOperatorId(params.actor),
    verificationSource: "saved_lot_operator_confirmation",
    notes: `Saved InstaComp lot ${params.job.id}, item ${params.item.id}. Mac-local lesson is authoritative; Supabase stores only this audit receipt.`,
    identity: lessonIdentity(ai),
  });

  const savedAt = new Date().toISOString();
  const localLearningReceipt = {
    schema: "tcos.instacomp.macLearningReceipt.v1",
    authority: "mac_local",
    lessonId: lesson.lessonId,
    trainingExampleId: lesson.trainingExampleId,
    internalScanId,
    trusted: lesson.trusted,
    state: lesson.state,
    savedAt,
  };
  const { error: updateError } = await params.supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .update({
      result_payload: { ...resultPayload, localLearningReceipt },
      knowledge_saved_at: savedAt,
    })
    .eq("id", params.item.id)
    .eq("job_id", params.job.id);
  if (updateError) throwInstaCompDatabaseError(updateError);

  return {
    status: "processed" as const,
    duplicateObservation: false,
    entry: {
      id: lesson.lessonId,
      trust_status: lesson.trusted ? "mac_operator_confirmed" : "mac_review_recorded",
      confirmed_count: lesson.trusted ? 1 : 0,
      authority: "mac_local",
    },
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
        "id,job_id,status,front_original_filename,result_payload,knowledge_saved_at",
      )
      .eq("job_id", job.id)
      .in("status", ["completed", "review_required"])
      .order("position", { ascending: true })
      .limit(500);
    if (requestedItemIds.length) query = query.in("id", requestedItemIds);

    const { data: items, error: itemsError } = await query;
    if (itemsError) throwInstaCompDatabaseError(itemsError);

    const processed: Array<Record<string, any>> = [];
    const skipped: Array<Record<string, any>> = [];
    for (const item of (items || []) as Array<Record<string, any>>) {
      try {
        const result = await processItem({ supabase, actor, job, item });
        if (result.status === "processed") {
          processed.push({
            itemId: item.id,
            entry: result.entry,
            duplicateObservation: result.duplicateObservation,
          });
        } else {
          skipped.push({ itemId: item.id, reason: result.reason });
        }
      } catch (error) {
        skipped.push({
          itemId: item.id,
          reason: error instanceof Error ? error.message : "Mac-local lesson storage failed",
        });
      }
    }

    return Response.json({
      ok: true,
      authority: "mac_local",
      processedCount: processed.length,
      skippedCount: skipped.length,
      trustedCount: processed.filter((item) => item.entry?.trust_status === "mac_operator_confirmed").length,
      learningCount: 0,
      processed,
      skipped,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
