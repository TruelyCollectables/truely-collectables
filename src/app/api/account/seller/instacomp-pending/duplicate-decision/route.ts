import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { syncEbayPriceQuantity } from "../../../../../../lib/ebay";
import { effectiveInstaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";
import {
  pendingDuplicateCandidateMatches,
  pendingDuplicateProtectionMatchKey,
} from "../../../../../../lib/pending-duplicate-protection";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type DuplicateDecision =
  "merge_keep_price" | "merge_change_price" | "keep_separate";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function positiveMoney(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function isUniquePhysicalCopy(metadataValue: unknown) {
  const metadata = recordValue(metadataValue);
  const asset = recordValue(metadata.collectible_asset);
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  return Boolean(
    textValue(asset.exact_serial_number) ||
    textValue(asset.grading_cert_number) ||
    textValue(ai.gradingCertNumber) ||
    textValue(ai.certificationNumber),
  );
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = textValue(body.inventoryItemId);
    const existingLegacyProductId = positiveInteger(
      body.existingLegacyProductId,
    );
    const action = textValue(body.action) as DuplicateDecision | null;
    const requestedPrice = positiveMoney(body.price);

    if (!inventoryItemId || !existingLegacyProductId) {
      return Response.json(
        { error: "Pending item and existing listing are required." },
        { status: 400 },
      );
    }
    if (
      action !== "merge_keep_price" &&
      action !== "merge_change_price" &&
      action !== "keep_separate"
    ) {
      return Response.json(
        { error: "Choose a duplicate action." },
        { status: 400 },
      );
    }
    if (action === "merge_change_price" && !requestedPrice) {
      return Response.json(
        { error: "Enter the new combined listing price." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let draftQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,status,quantity,price,metadata,updated_at",
      )
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    draftQuery = isStoreOwnerAccount
      ? draftQuery.or(
          `seller_account_id.eq.${account.id},seller_account_id.is.null`,
        )
      : draftQuery.eq("seller_account_id", account.id);
    const { data: draft, error: draftError } = await draftQuery.maybeSingle();
    if (draftError) throw draftError;
    if (!draft || draft.status !== "draft" || !draft.legacy_product_id) {
      return Response.json(
        { error: "That pending card is no longer an available draft." },
        { status: 409 },
      );
    }

    let existingInventoryQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,status,quantity,price,metadata,updated_at",
      )
      .eq("store_id", storeId)
      .eq("legacy_product_id", existingLegacyProductId)
      .eq("status", "active")
      .gt("quantity", 0);
    existingInventoryQuery = isStoreOwnerAccount
      ? existingInventoryQuery.or(
          `seller_account_id.eq.${account.id},seller_account_id.is.null`,
        )
      : existingInventoryQuery.eq("seller_account_id", account.id);
    const { data: existingInventoryRows, error: existingInventoryError } =
      await existingInventoryQuery
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1);
    if (existingInventoryError) throw existingInventoryError;
    const existingInventory = existingInventoryRows?.[0] || null;
    if (!existingInventory) {
      return Response.json(
        {
          error:
            "The existing listing is no longer active. Reload Pending Inventory.",
        },
        { status: 409 },
      );
    }

    const { data: existingProduct, error: productError } = await supabase
      .from("products")
      .select("id,sku,title,price,quantity,ebay_item_id,archived_at")
      .eq("store_id", storeId)
      .eq("id", existingLegacyProductId)
      .is("archived_at", null)
      .gt("quantity", 0)
      .maybeSingle();
    if (productError) throw productError;
    if (!existingProduct) {
      return Response.json(
        { error: "The existing product listing is no longer active." },
        { status: 409 },
      );
    }

    const draftMatchKey = effectiveInstaCompPricingGroupKey(draft.metadata);
    const existingMatchKey = effectiveInstaCompPricingGroupKey(
      existingInventory.metadata,
    );
    const exactDuplicateMatch = pendingDuplicateCandidateMatches({
      draftPricingGroupKey: draftMatchKey,
      draftTitle: draft.title,
      candidatePricingGroupKey: existingMatchKey,
      candidateTitle: existingInventory.title,
    });
    if (!exactDuplicateMatch) {
      return Response.json(
        {
          error:
            "Exact-card identity changed. Reload Pending Inventory before resolving this duplicate.",
        },
        { status: 409 },
      );
    }
    const resolvedMatchKey = pendingDuplicateProtectionMatchKey({
      pricingGroupKey: draftMatchKey || existingMatchKey,
      title: draft.title,
    });
    if (!resolvedMatchKey) {
      return Response.json(
        { error: "The exact-card duplicate identity could not be resolved." },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const draftMetadata = recordValue(draft.metadata);
    const draftInstaComp = recordValue(draftMetadata.instacomp);

    if (action === "keep_separate") {
      const { data: updatedDraft, error } = await supabase
        .from("inventory_items")
        .update({
          metadata: {
            ...draftMetadata,
            instacomp: {
              ...draftInstaComp,
              duplicateInventoryDecision: {
                mode: "keep_separate",
                matchKey: resolvedMatchKey,
                existingLegacyProductId,
                existingInventoryItemId: existingInventory.id,
                decidedAt: now,
                decidedBy: account.email,
              },
            },
          },
          updated_at: now,
        })
        .eq("store_id", storeId)
        .eq("id", draft.id)
        .eq("status", "draft")
        .eq("updated_at", draft.updated_at)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updatedDraft) {
        return Response.json(
          {
            error:
              "That pending card changed while the duplicate decision was being saved. Reload Pending Inventory.",
          },
          { status: 409 },
        );
      }

      return Response.json({
        success: true,
        action,
        inventoryItemId: draft.id,
        existingLegacyProductId,
        message: "Separate listing approved for this exact card.",
      });
    }

    if (
      isUniquePhysicalCopy(draft.metadata) ||
      isUniquePhysicalCopy(existingInventory.metadata)
    ) {
      return Response.json(
        {
          error:
            "This is a serial-numbered or graded-cert physical asset and cannot be quantity-merged automatically.",
        },
        { status: 409 },
      );
    }

    const draftQuantity = positiveInteger(draft.quantity);
    const existingQuantity = positiveInteger(existingInventory.quantity);
    if (!draftQuantity || !existingQuantity) {
      return Response.json(
        { error: "Both listings must have positive quantity to merge." },
        { status: 409 },
      );
    }

    const { data: mergeData, error: mergeError } = await supabase.rpc(
      "tcos_merge_pending_duplicate_inventory",
      {
        p_store_id: storeId,
        p_draft_inventory_item_id: draft.id,
        p_existing_inventory_item_id: existingInventory.id,
        p_existing_product_id: existingLegacyProductId,
        p_expected_draft_updated_at: draft.updated_at,
        p_expected_existing_updated_at: existingInventory.updated_at,
        p_action: action,
        p_requested_price:
          action === "merge_change_price" ? requestedPrice : null,
        p_match_key: resolvedMatchKey,
        p_decided_by: account.email,
      },
    );
    if (mergeError) {
      const message =
        mergeError.message || "Could not atomically merge duplicate inventory.";
      const conflict = message.includes("TCOS_DUPLICATE_");
      return Response.json(
        {
          error: conflict
            ? "Inventory changed while the duplicate was being merged. Reload Pending Inventory and try again."
            : message,
          code: conflict
            ? "DUPLICATE_MERGE_CONFLICT"
            : "DUPLICATE_MERGE_FAILED",
          detail: conflict ? message : undefined,
        },
        { status: conflict ? 409 : 500 },
      );
    }

    const mergeResult = recordValue(mergeData);
    const mergedQuantity = positiveInteger(mergeResult.mergedQuantity);
    const previousQuantity = positiveInteger(mergeResult.previousQuantity);
    const addedQuantity = positiveInteger(mergeResult.addedQuantity);
    const finalPrice = positiveMoney(mergeResult.finalPrice);
    if (!mergedQuantity || !addedQuantity || !finalPrice) {
      return Response.json(
        {
          error:
            "The atomic duplicate merge returned an invalid result. Reload inventory before taking another action.",
        },
        { status: 500 },
      );
    }

    let ebaySync: Record<string, unknown> | null = null;
    if (existingProduct.ebay_item_id) {
      try {
        ebaySync = await syncEbayPriceQuantity({
          sku: existingProduct.sku,
          ebayItemId: existingProduct.ebay_item_id,
          newQuantity: mergedQuantity,
          newPrice: finalPrice,
        });
      } catch (error) {
        ebaySync = {
          success: false,
          error: error instanceof Error ? error.message : "eBay sync failed",
        };
      }

      const ebaySyncSucceeded = ebaySync?.success === true;
      const ebaySyncError =
        ebaySyncSucceeded
          ? null
          : textValue(ebaySync?.error) ||
            textValue(ebaySync?.reason) ||
            "Immediate eBay duplicate-merge sync did not complete.";
      const { error: outboxUpdateError } = await supabase
        .from("ebay_quantity_sync_outbox")
        .update(
          ebaySyncSucceeded
            ? {
                status: "synced",
                synced_at: new Date().toISOString(),
                last_attempt_at: new Date().toISOString(),
                last_error: null,
                updated_at: new Date().toISOString(),
              }
            : {
                status: "pending",
                last_attempt_at: new Date().toISOString(),
                last_error: ebaySyncError,
                next_attempt_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
        )
        .eq("store_id", storeId)
        .eq("source_type", "duplicate_merge")
        .eq("source_id", draft.id)
        .eq("legacy_product_id", existingLegacyProductId);
      if (outboxUpdateError) {
        console.error("Duplicate merge eBay outbox update error:", outboxUpdateError);
      }
    }

    return Response.json({
      success: true,
      action,
      inventoryItemId: draft.id,
      existingInventoryItemId: existingInventory.id,
      existingLegacyProductId,
      previousQuantity,
      addedQuantity,
      mergedQuantity,
      finalPrice,
      ebaySync,
      message:
        action === "merge_change_price"
          ? `Added ${addedQuantity} to the existing listing and changed the combined price.`
          : `Added ${addedQuantity} to the existing listing at its current price.`,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not resolve duplicate inventory." },
      { status: 500 },
    );
  }
}
