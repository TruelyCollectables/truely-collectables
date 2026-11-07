import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  mergeAuthenticityIntoMetadata,
  sanitizeAuthenticityProfile,
  validateAuthenticityProfile,
} from "../../../../../../lib/authenticity";
import { mergeUnder20SellerProtectionOptIn } from "../../../../../../lib/shipping";
import {
  inventoryEngine,
  InventoryEngineError,
  type InventoryStatus,
} from "../../../../../../modules/inventory";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type InventoryOwnershipRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function parseText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function parseMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseQuantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
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
        "Seller inventory editing is not available until the inventory migrations are applied.",
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
    .select("id,legacy_product_id,seller_account_id,status,metadata")
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

function editableStatus(status: string | null | undefined) {
  return ["draft", "active", "archived"].includes(status || "draft");
}

export async function PATCH(
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
    const title = parseText(body.title, 200);
    const description = parseText(body.description, 4000);
    const price = parseMoney(body.price);
    const quantity = parseQuantity(body.quantity);
    const authenticity = sanitizeAuthenticityProfile(body.authenticity);
    const authenticityError = validateAuthenticityProfile(authenticity);
    const under20SellerProtectionOptIn =
      body.under20SellerProtectionOptIn === true;

    if (!title) {
      return Response.json(
        { error: "Title is required." },
        { status: 400 },
      );
    }

    if (authenticityError) {
      return Response.json({ error: authenticityError }, { status: 400 });
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
            "Seller inventory item is missing its linked product record and cannot be edited.",
        },
        { status: 409 },
      );
    }

    if (!editableStatus(ownershipRow.status)) {
      return Response.json(
        {
          error:
            "Only draft, active, or archived seller inventory items can be edited from the seller workspace.",
        },
        { status: 409 },
      );
    }

    if ((ownershipRow.status || "draft") === "active" && quantity <= 0) {
      return Response.json(
        {
          error:
            "Active seller listings must keep quantity above zero. Pause the listing first if you want it off the storefront.",
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

    const updatedItem = await inventoryEngine.updateProduct(
      ownershipRow.legacy_product_id,
      {
        title,
        description,
        player: current.player,
        sport: current.sport,
        price,
        quantity,
        status: (ownershipRow.status || "draft") as InventoryStatus,
        imageUrl: current.imageUrl,
        authenticity,
      },
    );
    const nextMetadata = mergeUnder20SellerProtectionOptIn(
      mergeAuthenticityIntoMetadata(ownershipRow.metadata, authenticity),
      under20SellerProtectionOptIn,
    );

    await supabase
      .from("inventory_items")
      .update({
        metadata: nextMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ownershipRow.id)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id);

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
      { error: error.message || "Could not update seller inventory item." },
      { status: 500 },
    );
  }
}
