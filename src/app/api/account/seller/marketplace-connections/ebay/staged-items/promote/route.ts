import { createClient } from "@supabase/supabase-js";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../../lib/account-auth";
import { inventoryEngine, InventoryEngineError } from "../../../../../../../../modules/inventory";
import { getActiveStoreId } from "../../../../../../../../lib/stores";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function isMissingSellerStagingTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_marketplace_staged_items")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller staged item promotion is not available until the staging migrations are applied.",
    },
    { status: 503 },
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
    const stagedItemId = String(body.stagedItemId || "").trim();

    if (!stagedItemId) {
      return Response.json(
        { error: "A staged item ID is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: stagedItem, error: stagedItemError } = await supabase
      .from("seller_marketplace_staged_items")
      .select(
        "id,source_item_id,sku,title,quantity,price,item_condition,image_url,stage_status,metadata",
      )
      .eq("id", stagedItemId)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .single();

    if (stagedItemError || !stagedItem) {
      if (stagedItemError && isMissingSellerStagingTables(stagedItemError)) {
        return unavailableResponse();
      }

      throw stagedItemError || new Error("Seller staged item was not found.");
    }

    const metadata =
      stagedItem.metadata && typeof stagedItem.metadata === "object"
        ? (stagedItem.metadata as Record<string, unknown>)
        : {};
    const promotedItem = await inventoryEngine.createSellerDraftProduct({
      sellerAccountId: account.id,
      title: String(stagedItem.title || "Untitled"),
      description: cleanText(metadata.generated_description),
      category: cleanText(metadata.category_hint),
      condition: cleanText(stagedItem.item_condition),
      price: Number(stagedItem.price || 0),
      quantity: Math.max(0, Number(stagedItem.quantity || 0)),
      imageUrl: cleanText(stagedItem.image_url),
      sku: cleanText(stagedItem.sku),
      ebayItemId:
        cleanText(metadata.source_listing_id) || cleanText(stagedItem.source_item_id),
    });

    const updatedMetadata = {
      ...metadata,
      promoted_legacy_product_id: promotedItem.legacyProductId,
      promoted_inventory_item_id: promotedItem.inventoryItemId,
      promoted_at: new Date().toISOString(),
    };

    const { data: updatedStagedItem, error: updateError } = await supabase
      .from("seller_marketplace_staged_items")
      .update({
        stage_status: "mapped",
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stagedItemId)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .select(
        "id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
      )
      .single();

    if (updateError) {
      if (isMissingSellerStagingTables(updateError)) {
        return unavailableResponse();
      }

      throw updateError;
    }

    return Response.json({
      success: true,
      promotedItem,
      stagedItem: updatedStagedItem,
    });
  } catch (error: any) {
    if (isMissingSellerStagingTables(error)) {
      return unavailableResponse();
    }

    if (error instanceof InventoryEngineError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    return Response.json(
      {
        error: error.message || "Could not promote seller staged item",
      },
      { status: 500 },
    );
  }
}
