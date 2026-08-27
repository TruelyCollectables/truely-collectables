import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  checklistRegistryReceiptBlockers,
  readChecklistRegistryReceipt,
} from "../../../../../../lib/instacomp-registry-receipt";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

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
    const isStoreOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select("id,title,status,metadata,updated_at")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true })
      .limit(500);

    query = isStoreOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    const { data, error } = await query;
    if (error) throw error;

    const items = (data || [])
      .filter((row: any) => {
        const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
        const instaComp = metadata.instacomp || {};
        return Boolean(instaComp.source || instaComp.scanId);
      })
      .map((row: any) => {
        const receipt = readChecklistRegistryReceipt(row.metadata);
        const blockers = checklistRegistryReceiptBlockers(row.metadata);
        return {
          inventoryItemId: row.id,
          title: row.title || "Untitled item",
          receipt,
          readyForMarketplaceComps: blockers.length === 0,
          readyForPublish: blockers.length === 0,
          blockers,
          updatedAt: row.updated_at || null,
        };
      });

    return Response.json(
      {
        items,
        summary: {
          total: items.length,
          identified: items.filter((item) => item.receipt.status === "identified").length,
          reviewRequired: items.filter((item) => item.receipt.status !== "identified").length,
          publishReady: items.filter((item) => item.readyForPublish).length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load Checklist Registry readiness.",
      },
      { status: 500 },
    );
  }
}
