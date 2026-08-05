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

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

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
        return [
          String(row.id),
          {
            status: text(instaComp.lastStatus) || (instaComp.identityComplete === true ? "identity_complete" : "waiting"),
            stage: text(instaComp.lastStage) || null,
            error: text(instaComp.lastError),
            errorCode: text(instaComp.lastErrorCode),
            identityComplete: instaComp.identityComplete === true,
            manualIdentityLocked: instaComp.manualIdentityLocked === true,
            identitySource: text(instaComp.identitySource),
            pricingStatus: text(instaComp.pricingStatus),
            printRun: text(ai.printRun) || text(ai.serialNumber),
            backEvidenceText: text(ai.backEvidenceText),
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
      { error: error instanceof Error ? error.message : "Could not load InstaComp job status." },
      { status: 500 },
    );
  }
}
