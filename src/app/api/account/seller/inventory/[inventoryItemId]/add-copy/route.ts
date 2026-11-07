import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";
import { inventoryEngine, InventoryEngineError } from "../../../../../../../modules/inventory";

export const dynamic = "force-dynamic";

type InventoryOwnershipRow = {
  id: string;
  seller_account_id: string | null;
  legacy_product_id: number | null;
  title: string | null;
};

function isMissingSellerInventoryTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("inventory_items") ||
    message.includes("products")
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const { inventoryItemId } = await context.params;
    const targetInventoryItemId = String(inventoryItemId || "").trim();
    if (!targetInventoryItemId) {
      return Response.json({ success: false, error: "inventoryItemId is required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: row, error: readError } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,legacy_product_id,title")
      .eq("id", targetInventoryItemId)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .single();

    if (readError || !row) {
      if (readError && isMissingSellerInventoryTables(readError)) {
        return Response.json(
          { success: false, error: "Seller inventory editing is not available until the inventory migrations are applied." },
          { status: 503 },
        );
      }
      return Response.json({ success: false, error: "Inventory item was not found." }, { status: 404 });
    }

    const ownershipRow = row as InventoryOwnershipRow;
    if (!ownershipRow.legacy_product_id) {
      return Response.json(
        { success: false, error: "This item cannot be quantity-merged because it has no linked product record." },
        { status: 409 },
      );
    }

    const current = await inventoryEngine.getByLegacyProductId(ownershipRow.legacy_product_id);
    if (!current || current.inventoryItemId !== ownershipRow.id) {
      return Response.json({ success: false, error: "Linked product record could not be loaded." }, { status: 404 });
    }

    const nextQuantity = Math.max(1, Math.floor(Number(current.quantity || 0)) + 1);
    const updated = await inventoryEngine.updateProduct(ownershipRow.legacy_product_id, {
      title: current.title,
      description: current.description,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: nextQuantity,
      status: current.status,
      imageUrl: current.imageUrl,
      authenticity: current.authenticity,
    });

    return Response.json({
      success: true,
      inventoryItemId: updated.inventoryItemId,
      title: updated.title,
      quantity: updated.quantity,
      price: updated.price,
      message: `Added one copy to ${updated.title}. Quantity is now ${updated.quantity} at ${updated.price}.`,
    });
  } catch (error) {
    if (error instanceof InventoryEngineError) {
      return Response.json({ success: false, error: error.message }, { status: error.statusCode });
    }
    if (isMissingSellerInventoryTables(error as { code?: string; message?: string })) {
      return Response.json(
        { success: false, error: "Seller inventory editing is not available until the inventory migrations are applied." },
        { status: 503 },
      );
    }
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Could not add a copy to inventory." },
      { status: 500 },
    );
  }
}
