import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const storeId = getActiveStoreId();
    const body = await request.json();
    const inventoryItemId = body.inventoryItemId ? String(body.inventoryItemId) : null;
    const data = await postInstaCompMacAccounting("/v1/kingmaker/accounting/receive", {
      card_uuid: String(body.cardUuid || ""),
      inventory_item_id: inventoryItemId,
      acquisition_item_id: Number(body.acquisitionItemId || 0),
    });

    if (inventoryItemId && data.status === "received") {
      const supabase = createSupabaseServerClient({ admin: true });
      const { data: item } = await supabase
        .from("inventory_items")
        .select("id,metadata")
        .eq("id", inventoryItemId)
        .eq("store_id", storeId)
        .maybeSingle();
      if (item) {
        const metadata =
          item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
            ? { ...(item.metadata as Record<string, unknown>) }
            : {};
        metadata.acquisition = {
          sourceOfTruth: "mac_local_kingmaker_accounting",
          status: "received",
          receivedAt: data.receivedAt || new Date().toISOString(),
          ...(data.match && typeof data.match === "object" ? data.match : {}),
        };
        await supabase
          .from("inventory_items")
          .update({ metadata })
          .eq("id", inventoryItemId)
          .eq("store_id", storeId);
      }
    }

    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
