import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../../lib/account-auth";
import { sanitizeAuthenticityProfile } from "../../../../../../../../lib/authenticity";
import { inventoryEngine, InventoryEngineError } from "../../../../../../../../modules/inventory";
import { getActiveStoreId } from "../../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type ProductDuplicateRow = {
  id: number;
  title: string | null;
  seller_account_id: string | null;
  sku: string | null;
  ebay_item_id: string | null;
};

type SellerMarketplaceStagedItemRow = {
  id: string;
  source_item_id: string | null;
  sku: string | null;
  title: string | null;
  quantity: number | string | null;
  price: number | string | null;
  item_condition: string | null;
  image_url: string | null;
  stage_status: string | null;
  metadata: Record<string, unknown> | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function numericId(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function cleanStageItemIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0),
    ),
  ).slice(0, 100);
}

async function loadPromotionConflicts(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  sku: string | null;
  ebayItemId: string | null;
}) {
  let duplicateQuery = params.supabase
    .from("products")
    .select("id,title,seller_account_id,sku,ebay_item_id")
    .eq("store_id", params.storeId);

  if (params.ebayItemId && params.sku) {
    duplicateQuery = duplicateQuery.or(
      `ebay_item_id.eq.${params.ebayItemId},sku.eq.${params.sku}`,
    );
  } else if (params.ebayItemId) {
    duplicateQuery = duplicateQuery.eq("ebay_item_id", params.ebayItemId);
  } else if (params.sku) {
    duplicateQuery = duplicateQuery.eq("sku", params.sku);
  } else {
    return [];
  }

  const { data, error } = await duplicateQuery.limit(5);

  if (error) throw error;

  return (data || []) as ProductDuplicateRow[];
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

async function loadStagedItem(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  accountId: string;
  stagedItemId: string;
}) {
  const { data, error } = await params.supabase
    .from("seller_marketplace_staged_items")
    .select(
      "id,source_item_id,sku,title,quantity,price,item_condition,image_url,stage_status,metadata",
    )
    .eq("id", params.stagedItemId)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .single();

  if (error || !data) {
    if (error && isMissingSellerStagingTables(error)) {
      throw error;
    }

    throw error || new Error("Seller staged item was not found.");
  }

  return data as SellerMarketplaceStagedItemRow;
}

async function promoteOneSellerStagedItem(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  accountId: string;
  stagedItemId: string;
}) {
  const stagedItem = await loadStagedItem(params);
  const metadata = metadataRecord(stagedItem.metadata);
  const promotedLegacyProductId = numericId(metadata.promoted_legacy_product_id);
  const sku = cleanText(stagedItem.sku);
  const ebayItemId =
    cleanText(metadata.source_listing_id) || cleanText(stagedItem.source_item_id);

  if (String(stagedItem.stage_status || "") !== "staged") {
    throw new InventoryEngineError(
      "Only staged seller listings can be promoted. Move this row to STAGED first.",
      409,
    );
  }

  if (promotedLegacyProductId) {
    throw new InventoryEngineError(
      `This seller listing already created draft product #${promotedLegacyProductId}.`,
      409,
    );
  }

  const duplicateMatches = await loadPromotionConflicts({
    supabase: params.supabase,
    storeId: params.storeId,
    sku,
    ebayItemId,
  });

  if (duplicateMatches.length > 0) {
    const firstMatch = duplicateMatches[0];

    throw new InventoryEngineError(
      `Promotion blocked because ${firstMatch.title || "an existing product"} already matches this seller listing by SKU or eBay item ID.`,
      409,
    );
  }

  const promotedItem = await inventoryEngine.createSellerDraftProduct({
    sellerAccountId: params.accountId,
    title: String(stagedItem.title || "Untitled"),
    description: cleanText(metadata.generated_description),
    category: cleanText(metadata.category_hint),
    condition: cleanText(stagedItem.item_condition),
    price: Number(stagedItem.price || 0),
    quantity: Math.max(0, Number(stagedItem.quantity || 0)),
    imageUrl: cleanText(stagedItem.image_url),
    sku,
    ebayItemId,
    authenticity: sanitizeAuthenticityProfile(metadata.authenticity),
  });

  const updatedMetadata = {
    ...metadata,
    promoted_legacy_product_id: promotedItem.legacyProductId,
    promoted_inventory_item_id: promotedItem.inventoryItemId,
    promoted_at: new Date().toISOString(),
  };

  const { data: updatedStagedItem, error: updateError } = await params.supabase
    .from("seller_marketplace_staged_items")
    .update({
      stage_status: "mapped",
      metadata: updatedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.stagedItemId)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .select(
      "id,provider,source_item_id,sku,title,quantity,price,currency,offer_status,listing_status,item_condition,image_url,stage_status,metadata,updated_at",
    )
    .single();

  if (updateError) {
    if (isMissingSellerStagingTables(updateError)) {
      throw updateError;
    }

    throw updateError;
  }

  return {
    stagedItem: updatedStagedItem,
    promotedItem,
  };
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
    const stagedItemIds = cleanStageItemIds(body.stagedItemIds);
    const targetIds = stagedItemIds.length > 0
      ? stagedItemIds
      : stagedItemId
        ? [stagedItemId]
        : [];

    if (targetIds.length === 0) {
      return Response.json(
        { error: "A staged item ID is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    if (targetIds.length === 1) {
      const result = await promoteOneSellerStagedItem({
        supabase,
        storeId,
        accountId: account.id,
        stagedItemId: targetIds[0],
      });

      return Response.json({
        success: true,
        promotedItem: result.promotedItem,
        stagedItem: result.stagedItem,
      });
    }

    const promotedItems: Array<{
      stagedItemId: string;
      legacyProductId: number;
      inventoryItemId: string | null;
    }> = [];
    const errors: Array<{ stagedItemId: string; error: string }> = [];

    for (const targetId of targetIds) {
      try {
        const result = await promoteOneSellerStagedItem({
          supabase,
          storeId,
          accountId: account.id,
          stagedItemId: targetId,
        });
        promotedItems.push({
          stagedItemId: targetId,
          legacyProductId: result.promotedItem.legacyProductId,
          inventoryItemId: result.promotedItem.inventoryItemId,
        });
      } catch (error: any) {
        if (isMissingSellerStagingTables(error)) {
          return unavailableResponse();
        }

        errors.push({
          stagedItemId: targetId,
          error: error.message || "Could not promote seller staged item.",
        });
      }
    }

    return Response.json({
      success: errors.length === 0,
      promotedItems,
      promotedCount: promotedItems.length,
      errorCount: errors.length,
      errors,
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
