import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    const disposition = body.disposition === "investment_stash" ? "investment_stash" : "resale";
    if (!inventoryItemId) return Response.json({ error: "Inventory item is required." }, { status: 400 });

    const data = await postInstaCompMacAccounting("/v1/kingmaker/accounting/inventory-disposition", {
      inventory_item_id: inventoryItemId,
      disposition,
    });
    if (data.status !== "received") return Response.json(data, { status: 409 });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    );
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,seller_account_id,metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    itemQuery = isOwner
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: readError } = await itemQuery.maybeSingle();
    if (readError) throw readError;
    if (!item) return Response.json({ error: "Inventory item not found." }, { status: 404 });
    const metadata = record(item.metadata);
    const current = record(metadata.inventory_lifecycle);
    const nextMetadata = {
      ...metadata,
      inventory_lifecycle: {
        ...current,
        sourceOfTruth: "mac_local_kingmaker_accounting",
        state: data.inventoryState,
        disposition,
        scanId: data.scanId || current.scanId || null,
        updatedAt: new Date().toISOString(),
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    if (updateError) throw updateError;
    return Response.json({ success: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not change inventory destination." },
      { status: 400 },
    );
  }
}
