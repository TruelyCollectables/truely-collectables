import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  classifyWebsiteProductIdentity,
  isSellableWebsiteProduct,
  websiteInventoryAnchorKey,
  websiteProductAnchorKey,
  type WebsiteInventoryProduct,
} from "../../../../../../lib/instacomp-current-website-inventory";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function uniquePhysical(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const asset = record(metadata.collectible_asset);
  const identity = record(
    instaComp.manualIdentityLocked === true
      ? instaComp.manualIdentity
      : instaComp.ai,
  );
  return Boolean(
    text(asset.exact_serial_number) ||
      text(asset.grading_cert_number) ||
      text(identity.serialNumber) ||
      text(identity.certificationNumber) ||
      text(identity.gradingCertNumber),
  );
}

function withWebsiteActive(metadataValue: unknown, productId: number, now: string) {
  const metadata = record(metadataValue);
  const dual = record(metadata.dual_marketplace);
  return {
    ...metadata,
    dual_marketplace: {
      ...dual,
      website: {
        ...record(dual.website),
        status: "active",
        productId,
        reconciledAt: now,
        lastError: null,
      },
    },
  };
}

async function readSellableWebsiteProducts(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  storeId: string,
) {
  const products: WebsiteInventoryProduct[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id,title,player,price,quantity,archived_at,listing_status")
      .eq("store_id", storeId)
      .is("archived_at", null)
      .gt("quantity", 0)
      .gt("price", 0)
      .range(start, start + 999);
    if (error) throw error;
    const batch = (data || []) as WebsiteInventoryProduct[];
    products.push(...batch);
    if (batch.length < 1000) break;
  }
  return products;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.inventoryItemIds)
      ? Array.from(
          new Set(
            body.inventoryItemIds
              .map((value: unknown) => String(value || "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 500)
      : [];
    const dryRun = body.dryRun === true;
    if (!requestedIds.length) {
      return Response.json(
        { success: false, error: "Choose one or more Pending cards to reconcile." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: rows, error: rowsError } = await supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,status,quantity,price,title,sku,metadata,updated_at",
      )
      .eq("store_id", storeId)
      .in("id", requestedIds);
    if (rowsError) throw rowsError;

    const ownedRows = (rows || []).filter(
      (row: any) =>
        row.seller_account_id === account.id || row.seller_account_id === null,
    );
    const websiteProducts = await readSellableWebsiteProducts(supabase, storeId);
    const productsById = new Map(
      websiteProducts.map((product) => [Number(product.id), product]),
    );
    const productsByAnchor = new Map<string, WebsiteInventoryProduct[]>();
    for (const product of websiteProducts) {
      const anchor = websiteProductAnchorKey(product);
      if (!anchor) continue;
      const current = productsByAnchor.get(anchor) || [];
      current.push(product);
      productsByAnchor.set(anchor, current);
    }

    const results: any[] = [];
    for (const row of ownedRows) {
      const rowQuantity = wholeQuantity(row.quantity);
      const metadata = record(row.metadata);
      const prior = record(metadata.website_inventory_reconciliation);
      if (text(prior.status) === "completed") {
        results.push({
          inventoryItemId: row.id,
          status: "already_reconciled",
          productId: Number(prior.productId || 0) || null,
          addedQuantity: wholeQuantity(prior.addedQuantity),
          resultingQuantity: wholeQuantity(prior.resultingQuantity),
        });
        continue;
      }
      if (row.status !== "draft" || rowQuantity < 1) {
        results.push({ inventoryItemId: row.id, status: "skipped", reason: "not_pending_draft" });
        continue;
      }
      if (uniquePhysical(metadata)) {
        results.push({ inventoryItemId: row.id, status: "blocked", reason: "unique_physical_asset" });
        continue;
      }

      const anchor = websiteInventoryAnchorKey(metadata, row.title);
      const exactProducts = anchor
        ? (productsByAnchor.get(anchor) || []).filter(
            (product) =>
              classifyWebsiteProductIdentity({
                metadata,
                pendingTitle: row.title,
                product,
              }).status === "exact",
          )
        : [];
      if (exactProducts.length !== 1) {
        results.push({
          inventoryItemId: row.id,
          status: "blocked",
          reason: exactProducts.length > 1 ? "multiple_exact_live_products" : "no_single_exact_live_product",
          exactProductIds: exactProducts.map((product) => product.id),
        });
        continue;
      }

      const target = exactProducts[0];
      const linked = row.legacy_product_id
        ? productsById.get(Number(row.legacy_product_id)) || null
        : null;
      if (linked && isSellableWebsiteProduct(linked)) {
        const linkedMatch = classifyWebsiteProductIdentity({
          metadata,
          pendingTitle: row.title,
          product: linked,
        });
        if (linkedMatch.status !== "exact") {
          results.push({
            inventoryItemId: row.id,
            status: "blocked",
            reason: "conflicting_live_product_link",
            linkedProductId: linked.id,
            linkedProductTitle: linked.title || null,
            matchReason: linkedMatch.reason,
          });
          continue;
        }
      }

      const prepared = text(prior.status) === "prepared";
      const productId = prepared
        ? Number(prior.productId || 0)
        : Number(target.id);
      const targetQuantity = prepared
        ? wholeQuantity(prior.targetQuantity)
        : wholeQuantity(target.quantity) + rowQuantity;
      const baselineQuantity = prepared
        ? wholeQuantity(prior.baselineQuantity)
        : wholeQuantity(target.quantity);
      const addedQuantity = prepared
        ? wholeQuantity(prior.addedQuantity)
        : rowQuantity;
      if (!productId || targetQuantity < 1 || addedQuantity < 1) {
        results.push({ inventoryItemId: row.id, status: "blocked", reason: "invalid_reconciliation_quantity" });
        continue;
      }

      const { data: activeKeepers, error: keeperError } = await supabase
        .from("inventory_items")
        .select("id,quantity,metadata,seller_account_id")
        .eq("store_id", storeId)
        .eq("legacy_product_id", productId)
        .eq("status", "active");
      if (keeperError) throw keeperError;
      if ((activeKeepers || []).length > 1) {
        results.push({
          inventoryItemId: row.id,
          status: "blocked",
          reason: "multiple_active_inventory_keepers",
          keeperInventoryItemIds: (activeKeepers || []).map((keeper: any) => keeper.id),
        });
        continue;
      }
      const existingKeeper = (activeKeepers || [])[0] || null;
      const keeperId = text(prior.keeperInventoryItemId) || existingKeeper?.id || row.id;
      const now = new Date().toISOString();
      const preparedMetadata = {
        ...metadata,
        website_inventory_reconciliation: {
          status: "prepared",
          productId,
          keeperInventoryItemId: keeperId,
          baselineQuantity,
          addedQuantity,
          targetQuantity,
          preparedAt: text(prior.preparedAt) || now,
          sourceInventoryItemId: row.id,
        },
      };

      if (dryRun) {
        results.push({
          inventoryItemId: row.id,
          status: "ready",
          productId,
          keeperInventoryItemId: keeperId,
          baselineQuantity,
          addedQuantity,
          resultingQuantity: targetQuantity,
          promotedToKeeper: keeperId === row.id,
        });
        continue;
      }

      if (!prepared) {
        const { error: prepareError } = await supabase
          .from("inventory_items")
          .update({ metadata: preparedMetadata, updated_at: now })
          .eq("store_id", storeId)
          .eq("id", row.id)
          .eq("status", "draft");
        if (prepareError) throw prepareError;
      }

      const { error: productError } = await supabase
        .from("products")
        .update({ quantity: targetQuantity })
        .eq("store_id", storeId)
        .eq("id", productId);
      if (productError) throw productError;

      if (keeperId === row.id) {
        const completedMetadata = {
          ...withWebsiteActive(preparedMetadata, productId, now),
          website_inventory_reconciliation: {
            ...record(preparedMetadata.website_inventory_reconciliation),
            status: "completed",
            completedAt: now,
            resultingQuantity: targetQuantity,
          },
        };
        const { error: promoteError } = await supabase
          .from("inventory_items")
          .update({
            status: "active",
            quantity: targetQuantity,
            price: Number(target.price || row.price || 0),
            legacy_product_id: productId,
            metadata: completedMetadata,
            updated_at: now,
          })
          .eq("store_id", storeId)
          .eq("id", row.id);
        if (promoteError) throw promoteError;
      } else {
        const keeper = existingKeeper;
        if (!keeper || keeper.id !== keeperId) {
          throw new Error(`Prepared website reconciliation keeper ${keeperId} is no longer active.`);
        }
        const keeperMetadata = withWebsiteActive(keeper.metadata, productId, now);
        const { error: keeperSaveError } = await supabase
          .from("inventory_items")
          .update({ quantity: targetQuantity, metadata: keeperMetadata, updated_at: now })
          .eq("store_id", storeId)
          .eq("id", keeperId)
          .eq("status", "active");
        if (keeperSaveError) throw keeperSaveError;

        const completedMetadata = {
          ...preparedMetadata,
          commercial_merge: {
            keeper_inventory_item_id: keeperId,
            website_product_id: productId,
            merged_quantity: addedQuantity,
            merged_at: now,
            reason: "exact_current_website_inventory_quantity_merge",
          },
          website_inventory_reconciliation: {
            ...record(preparedMetadata.website_inventory_reconciliation),
            status: "completed",
            completedAt: now,
            resultingQuantity: targetQuantity,
          },
        };
        const { error: archiveError } = await supabase
          .from("inventory_items")
          .update({
            status: "archived",
            quantity: 0,
            legacy_product_id: productId,
            metadata: completedMetadata,
            updated_at: now,
          })
          .eq("store_id", storeId)
          .eq("id", row.id);
        if (archiveError) throw archiveError;
      }

      results.push({
        inventoryItemId: row.id,
        status: "reconciled",
        productId,
        keeperInventoryItemId: keeperId,
        baselineQuantity,
        addedQuantity,
        resultingQuantity: targetQuantity,
        promotedToKeeper: keeperId === row.id,
      });
    }

    const reconciled = results.filter((result) => result.status === "reconciled").length;
    const ready = results.filter((result) => result.status === "ready").length;
    const blocked = results.filter((result) => result.status === "blocked").length;
    return Response.json({
      success: true,
      dryRun,
      requested: requestedIds.length,
      found: ownedRows.length,
      reconciled,
      ready,
      blocked,
      results,
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Could not reconcile current website inventory." },
      { status: 500 },
    );
  }
}
