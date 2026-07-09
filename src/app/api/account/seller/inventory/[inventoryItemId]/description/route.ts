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

type InventoryOwnershipRow = {
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
        "Seller description tools are not available until the inventory migrations are applied.",
    },
    { status: 503 },
  );
}

async function loadOwnedInventoryRow(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  accountId: string;
  inventoryItemId: string;
}) {
  const { data, error } = await params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,seller_account_id,status")
    .eq("id", params.inventoryItemId)
    .eq("store_id", params.storeId)
    .eq("seller_account_id", params.accountId)
    .single();

  if (error || !data) {
    if (error && isMissingSellerInventoryTables(error)) {
      throw error;
    }

    throw new InventoryEngineError("Seller inventory item was not found.", 404);
  }

  return data as InventoryOwnershipRow;
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

    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "regenerate").trim();

    if (!["regenerate", "ai"].includes(mode)) {
      return Response.json(
        { error: "Description mode must be regenerate or ai." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const ownershipRow = await loadOwnedInventoryRow({
      supabase,
      storeId,
      accountId: account.id,
      inventoryItemId: targetInventoryItemId,
    });

    if (!ownershipRow.legacy_product_id) {
      return Response.json(
        {
          error:
            "Seller inventory item is missing its linked product record and cannot generate a description.",
        },
        { status: 409 },
      );
    }

    const current = await inventoryEngine.getByLegacyProductId(
      ownershipRow.legacy_product_id,
    );

    if (!current || current.inventoryItemId !== ownershipRow.id) {
      return Response.json(
        { error: "Linked seller product could not be loaded." },
        { status: 404 },
      );
    }

    if (current.sellerAccountId !== account.id) {
      return Response.json(
        { error: "Seller ownership mismatch." },
        { status: 403 },
      );
    }

    const updatedItem =
      mode === "ai"
        ? await inventoryEngine.generateAiDescription(
            ownershipRow.legacy_product_id,
          )
        : await inventoryEngine.regenerateDescription(
            ownershipRow.legacy_product_id,
          );

    return Response.json({
      success: true,
      item: updatedItem,
      mode,
    });
  } catch (error: any) {
    if (isMissingSellerInventoryTables(error)) {
      return unavailableResponse();
    }

    if (error instanceof InventoryEngineError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    return Response.json(
      { error: error.message || "Could not generate seller description." },
      { status: 500 },
    );
  }
}
