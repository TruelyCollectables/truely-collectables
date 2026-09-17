import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function assertOwnedInventoryIds(account: { id: string; email?: string | null }, inventoryItemIds: string[]) {
  const ids = [...new Set(inventoryItemIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("A seller-owned inventory item is required.");

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
    text(account.email).toLowerCase(),
  );
  let query = supabase
    .from("inventory_items")
    .select("id")
    .eq("store_id", storeId)
    .in("id", ids);
  query = isOwner
    ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
    : query.eq("seller_account_id", account.id);
  const { data, error } = await query;
  if (error) throw error;
  const allowed = new Set((data || []).map((row: { id: string }) => text(row.id)));
  if (allowed.size !== ids.length || ids.some((id) => !allowed.has(id))) {
    throw new Error("One or more inventory items are not available to this seller.");
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = await request.json();
    const bulkItems = Array.isArray(body.items)
      ? body.items
          .slice(0, 500)
          .map((item: any) => ({
            card_uuid: text(item?.cardUuid),
            inventory_item_id: text(item?.inventoryItemId),
            scan_id: text(item?.scanId),
            identity: item?.identity && typeof item.identity === "object" ? item.identity : {},
          }))
          .filter((item: any) => Boolean(item.inventory_item_id && item.scan_id))
      : null;

    if (bulkItems) {
      if (!bulkItems.length) {
        return Response.json({ error: "No verified seller inventory scans were supplied." }, { status: 400 });
      }
      await assertOwnedInventoryIds(account, bulkItems.map((item: any) => item.inventory_item_id));
      const data = await postInstaCompMacAccounting(
        "/v1/kingmaker/accounting/purchase-match-bulk",
        { items: bulkItems },
        30_000,
      );
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    }

    const inventoryItemId = text(body.inventoryItemId);
    const scanId = text(body.scanId);
    if (!inventoryItemId || !scanId) {
      return Response.json({ error: "A seller-owned inventory item and verified scan are required." }, { status: 400 });
    }
    await assertOwnedInventoryIds(account, [inventoryItemId]);
    const data = await postInstaCompMacAccounting("/v1/kingmaker/accounting/purchase-match", {
      card_uuid: text(body.cardUuid),
      inventory_item_id: inventoryItemId,
      scan_id: scanId,
      identity: body.identity && typeof body.identity === "object" ? body.identity : {},
    });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
