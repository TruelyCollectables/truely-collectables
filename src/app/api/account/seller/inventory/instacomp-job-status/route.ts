import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textList(value: unknown) {
  return Array.isArray(value)
    ? value.map(String).map((entry) => entry.trim()).filter(Boolean).slice(0, 100)
    : [];
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,metadata,updated_at")
      .eq("store_id", storeId)
      .eq("status", "draft");
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    const { data, error } = await query;
    if (error) throw error;

    const statuses = Object.fromEntries(
      (data || []).map((row: any) => {
        const metadata = record(row.metadata);
        const instaComp = record(metadata.instacomp);
        const ai = record(instaComp.ai);
        const parallelDecision = record(instaComp.parallelDecision);
        const visualFeatures = record(
          instaComp.parallelVisualFeatures || ai.parallelVisualFeatures,
        );
        const manualIdentityLocked = instaComp.manualIdentityLocked === true;
        const identityComplete = instaComp.identityComplete === true;
        const effectiveStatus = manualIdentityLocked
          ? "manual_locked"
          : identityComplete
            ? "identity_complete"
            : text(instaComp.lastStatus) || "waiting";
        const effectiveStage = manualIdentityLocked
          ? "manual_lock"
          : identityComplete
            ? "complete"
            : text(instaComp.lastStage);
        const suppressStaleFailure = manualIdentityLocked || identityComplete;

        return [
          String(row.id),
          {
            status: effectiveStatus,
            stage: effectiveStage,
            error: suppressStaleFailure ? null : text(instaComp.lastError),
            errorCode: suppressStaleFailure
              ? null
              : text(instaComp.lastErrorCode),
            identityComplete,
            manualIdentityLocked,
            identitySource: text(instaComp.identitySource),
            pricingStatus: text(instaComp.pricingStatus),
            printRun:
              text(ai.printRun) ||
              text(ai.serialNumber) ||
              text(visualFeatures.serialStampText),
            backEvidenceText: text(ai.backEvidenceText),
            selectedParallel:
              text(ai.checklistParallel) ||
              text(ai.parallelName) ||
              text(ai.parallel) ||
              text(parallelDecision.selectedParallel),
            candidateParallels: textList(parallelDecision.candidateParallels),
            visualColor: text(visualFeatures.dominantColor),
            visualPattern: text(visualFeatures.pattern),
            visualSerial: text(visualFeatures.serialStampText),
            visualConfidence: Number(visualFeatures.confidence || 0),
            parallelEvidence: text(parallelDecision.evidence),
            updatedAt: row.updated_at || null,
          },
        ];
      }),
    );

    return Response.json(
      { success: true, statuses },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load InstaComp job status.",
      },
      { status: 500 },
    );
  }
}
