import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  inventoryEngine,
  InventoryEngineError,
} from "../../../../../../../modules/inventory";
import {
  getInventoryActivationBlockers,
} from "../../../../../../../lib/inventory-activation";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  sku: string | null;
  title: string | null;
  category: string | null;
  status: string | null;
  quantity: number | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
};

type ProductRow = {
  id: number;
  image_url: string | null;
};

type SellerPayoutAccountRow = {
  onboarding_status: string | null;
  payouts_enabled: boolean | null;
  details_submitted: boolean | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingSellerInventoryTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("inventory_items") ||
    message.includes("products") ||
    message.includes("seller_payout_accounts")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller inventory activation is not available until the inventory and seller payout migrations are applied.",
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
      .select("id,legacy_product_id,seller_account_id,sku,title,category,status,quantity,price,metadata")
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
            "Seller inventory item is missing its linked product record and cannot be activated.",
        },
        { status: 409 },
      );
    }

    if (!["draft", "archived"].includes(inventoryItem.status || "draft")) {
      return Response.json(
        {
          error:
            "Only draft or archived seller inventory items can be activated.",
        },
        { status: 409 },
      );
    }

    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id,image_url")
      .eq("id", inventoryItem.legacy_product_id)
      .eq("store_id", storeId)
      .single();

    if (productError || !productData) {
      if (productError && isMissingSellerInventoryTables(productError)) {
        return unavailableResponse();
      }

      return Response.json(
        { error: "Linked product record was not found for this draft." },
        { status: 404 },
      );
    }

    const blockers = getInventoryActivationBlockers({
      sku: inventoryItem.sku,
      price: moneyNumber(inventoryItem.price),
      quantity: Number(inventoryItem.quantity || 0),
      imageUrl: (productData as ProductRow).image_url || null,
      title: inventoryItem.title,
      category: inventoryItem.category,
      metadata: inventoryItem.metadata,
    });

    if (blockers.length > 0) {
      return Response.json(
        {
          error:
            "This seller draft still has activation blockers and cannot go live yet.",
          blockers,
        },
        { status: 409 },
      );
    }

    const { data: payoutAccountData, error: payoutAccountError } = await supabase
      .from("seller_payout_accounts")
      .select("onboarding_status,payouts_enabled,details_submitted")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect")
      .maybeSingle();

    if (payoutAccountError) {
      if (isMissingSellerInventoryTables(payoutAccountError)) {
        return unavailableResponse();
      }

      throw payoutAccountError;
    }

    const payoutAccount = payoutAccountData as SellerPayoutAccountRow | null;

    if (
      !payoutAccount ||
      payoutAccount.onboarding_status !== "active" ||
      payoutAccount.payouts_enabled !== true ||
      payoutAccount.details_submitted !== true
    ) {
      return Response.json(
        {
          error:
            "Seller payout verification must be active before a seller draft can go live.",
        },
        { status: 409 },
      );
    }

    const updatedItem = await inventoryEngine.setStatus({
      legacyProductId: inventoryItem.legacy_product_id,
      status: "active",
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
      { error: error.message || "Could not activate seller inventory item." },
      { status: 500 },
    );
  }
}
