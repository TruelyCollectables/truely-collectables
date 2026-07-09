import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  inventoryEngine,
  InventoryEngineError,
} from "../../../../../../modules/inventory";
import {
  getInventoryActivationBlockers,
  type InventoryActivationBlocker,
} from "../../../../../../lib/inventory-activation";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type BulkAction = "activate" | "archive";

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
        "Seller bulk inventory controls are not available until the inventory and seller payout migrations are applied.",
    },
    { status: 503 },
  );
}

function parseInventoryItemIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0),
    ),
  ).slice(0, 100);
}

function parseAction(value: unknown): BulkAction | null {
  const action = String(value || "").trim();
  return action === "activate" || action === "archive" ? action : null;
}

function payoutReady(account: SellerPayoutAccountRow | null) {
  return (
    !!account &&
    account.onboarding_status === "active" &&
    account.payouts_enabled === true &&
    account.details_submitted === true
  );
}

export async function POST(request: Request) {
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

    const body = await request.json().catch(() => ({}));
    const action = parseAction(body.action);
    const inventoryItemIds = parseInventoryItemIds(body.inventoryItemIds);

    if (!action) {
      return Response.json(
        { error: "Bulk seller inventory action must be activate or archive." },
        { status: 400 },
      );
    }

    if (inventoryItemIds.length === 0) {
      return Response.json(
        { error: "At least one seller inventory item must be selected." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: inventoryData, error: inventoryError } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,sku,title,category,status,quantity,price,metadata")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .in("id", inventoryItemIds);

    if (inventoryError) {
      if (isMissingSellerInventoryTables(inventoryError)) {
        return unavailableResponse();
      }

      throw inventoryError;
    }

    const inventoryRows = (inventoryData || []) as InventoryRow[];
    const inventoryById = new Map(inventoryRows.map((row) => [row.id, row]));
    const legacyProductIds = Array.from(
      new Set(
        inventoryRows
          .map((row) => row.legacy_product_id)
          .filter(
            (value): value is number =>
              typeof value === "number" &&
              Number.isInteger(value) &&
              value > 0,
          ),
      ),
    );

    const { data: productData, error: productError } =
      action !== "activate" || legacyProductIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,image_url")
            .eq("store_id", storeId)
            .in("id", legacyProductIds);

    if (productError) {
      if (isMissingSellerInventoryTables(productError)) {
        return unavailableResponse();
      }

      throw productError;
    }

    const productsById = new Map(
      ((productData || []) as ProductRow[]).map((row) => [row.id, row]),
    );

    const { data: payoutAccountData, error: payoutAccountError } =
      action !== "activate"
        ? { data: null, error: null }
        : await supabase
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
    const results: Array<{
      inventoryItemId: string;
      success: boolean;
      status: number;
      message: string;
      blockers?: InventoryActivationBlocker[];
    }> = [];

    for (const inventoryItemId of inventoryItemIds) {
      const inventoryItem = inventoryById.get(inventoryItemId);

      if (!inventoryItem) {
        results.push({
          inventoryItemId,
          success: false,
          status: 404,
          message: "Seller inventory item was not found.",
        });
        continue;
      }

      if (!inventoryItem.legacy_product_id) {
        results.push({
          inventoryItemId,
          success: false,
          status: 409,
          message:
            action === "activate"
              ? "Seller inventory item is missing its linked product record and cannot be activated."
              : "Seller inventory item is missing its linked product record and cannot be archived.",
        });
        continue;
      }

      if (action === "archive") {
        const currentStatus = inventoryItem.status || "draft";

        if (currentStatus === "archived") {
          results.push({
            inventoryItemId,
            success: false,
            status: 409,
            message: "This seller inventory item is already archived.",
          });
          continue;
        }

        if (currentStatus === "sold") {
          results.push({
            inventoryItemId,
            success: false,
            status: 409,
            message: "Sold inventory cannot be archived from the seller workspace.",
          });
          continue;
        }

        try {
          await inventoryEngine.setStatus({
            legacyProductId: inventoryItem.legacy_product_id,
            status: "archived",
          });
          results.push({
            inventoryItemId,
            success: true,
            status: 200,
            message: "Seller inventory item archived.",
          });
        } catch (error: any) {
          if (error instanceof InventoryEngineError) {
            results.push({
              inventoryItemId,
              success: false,
              status: error.statusCode,
              message: error.message,
            });
            continue;
          }

          throw error;
        }

        continue;
      }

      const currentStatus = inventoryItem.status || "draft";

      if (!["draft", "archived"].includes(currentStatus)) {
        results.push({
          inventoryItemId,
          success: false,
          status: 409,
          message: "Only draft or archived seller inventory items can be activated.",
        });
        continue;
      }

      const product = productsById.get(inventoryItem.legacy_product_id);

      if (!product) {
        results.push({
          inventoryItemId,
          success: false,
          status: 404,
          message: "Linked product record was not found for this draft.",
        });
        continue;
      }

      const blockers = getInventoryActivationBlockers({
        sku: inventoryItem.sku,
        price: moneyNumber(inventoryItem.price),
        quantity: Number(inventoryItem.quantity || 0),
        imageUrl: product.image_url || null,
        title: inventoryItem.title,
        category: inventoryItem.category,
        metadata: inventoryItem.metadata,
      });

      if (blockers.length > 0) {
        results.push({
          inventoryItemId,
          success: false,
          status: 409,
          message:
            "This seller draft still has activation blockers and cannot go live yet.",
          blockers,
        });
        continue;
      }

      if (!payoutReady(payoutAccount)) {
        results.push({
          inventoryItemId,
          success: false,
          status: 409,
          message:
            "Seller payout verification must be active before a seller draft can go live.",
        });
        continue;
      }

      try {
        await inventoryEngine.setStatus({
          legacyProductId: inventoryItem.legacy_product_id,
          status: "active",
        });
        results.push({
          inventoryItemId,
          success: true,
          status: 200,
          message: "Seller inventory item activated.",
        });
      } catch (error: any) {
        if (error instanceof InventoryEngineError) {
          results.push({
            inventoryItemId,
            success: false,
            status: error.statusCode,
            message: error.message,
          });
          continue;
        }

        throw error;
      }
    }

    const successCount = results.filter((result) => result.success).length;
    const failureCount = results.length - successCount;

    return Response.json({
      success: true,
      action,
      summary: {
        requestedCount: inventoryItemIds.length,
        processedCount: results.length,
        successCount,
        failureCount,
      },
      results,
    });
  } catch (error: any) {
    if (isMissingSellerInventoryTables(error)) {
      return unavailableResponse();
    }

    if (error instanceof InventoryEngineError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    return Response.json(
      { error: error.message || "Could not update seller inventory in bulk." },
      { status: 500 },
    );
  }
}
