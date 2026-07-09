import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  inventoryEngine,
  InventoryEngineError,
} from "../../../../../../../modules/inventory";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  status: string | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function isMissingSellerInventoryTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("inventory_items") ||
    message.includes("products")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller inventory archiving is not available until the inventory migrations are applied.",
    },
    { status: 503 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const { inventoryItemId } = await context.params;
    const targetInventoryItemId = String(inventoryItemId || "").trim();

    if (!targetInventoryItemId) {
      return Response.json(
        { error: "Seller inventory item ID is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: inventoryData, error: inventoryError } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,status")
      .eq("id", targetInventoryItemId)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .single();

    if (inventoryError || !inventoryData) {
      if (inventoryError && isMissingSellerInventoryTables(inventoryError)) {
        return unavailableResponse();
      }

      return Response.json(
        { error: "Seller inventory item was not found." },
        { status: 404 },
      );
    }

    const inventoryItem = inventoryData as InventoryRow;

    if (!inventoryItem.legacy_product_id) {
      return Response.json(
        {
          error:
            "Seller inventory item is missing its linked product record and cannot be archived.",
        },
        { status: 409 },
      );
    }

    if ((inventoryItem.status || "draft") === "archived") {
      return Response.json(
        { error: "This seller inventory item is already archived." },
        { status: 409 },
      );
    }

    if ((inventoryItem.status || "draft") === "sold") {
      return Response.json(
        { error: "Sold inventory cannot be archived from the seller workspace." },
        { status: 409 },
      );
    }

    const updatedItem = await inventoryEngine.setStatus({
      legacyProductId: inventoryItem.legacy_product_id,
      status: "archived",
    });

    return Response.json({
      success: true,
      item: updatedItem,
    });
  } catch (error: any) {
    if (isMissingSellerInventoryTables(error)) {
      return unavailableResponse();
    }

    if (error instanceof InventoryEngineError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    return Response.json(
      { error: error.message || "Could not archive seller inventory item." },
      { status: 500 },
    );
  }
}
