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

function mercariMergeStatus(statusValue: unknown) {
  return String(statusValue || "").trim().toLowerCase();
}

function withExactMergeChannelPolicy(
  metadataValue: unknown,
  params: {
    now: string;
    sourceInventoryItemId: string;
    sourceScanId: string | null;
    keeperInventoryItemId: string;
    productId: number;
    quantityBefore: number;
    quantityAdded: number;
    quantityAfter: number;
    pricePreserved: number;
  },
) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const dual = record(metadata.dual_marketplace);
  const mercari = record(dual.mercari);
  const mercariStatusBefore = mercariMergeStatus(mercari.status) || "draft";
  const mercariWasSold = /^(sold|ended|inactive|completed|out[_ -]?of[_ -]?stock)$/.test(
    mercariStatusBefore,
  );
  const nextMercari = mercariWasSold
    ? {
        ...mercari,
        status: "eligible_to_relist",
        relistEligible: true,
        relistReason: "exact_inventory_quantity_added",
        relistEligibleAt: params.now,
      }
    : mercari;
  const history = Array.isArray(instaComp.exactMergeHistory)
    ? instaComp.exactMergeHistory
    : [];
  const receipt = {
    mergeId: `website-${params.sourceInventoryItemId}-${params.productId}`,
    sourceInventoryItemId: params.sourceInventoryItemId,
    sourceScanId: params.sourceScanId,
    keeperInventoryItemId: params.keeperInventoryItemId,
    websiteProductId: params.productId,
    quantityBefore: params.quantityBefore,
    quantityAdded: params.quantityAdded,
    quantityAfter: params.quantityAfter,
    pricePreserved: params.pricePreserved,
    mergedAt: params.now,
    channels: {
      website: {
        action: "increment_quantity",
        quantityBefore: params.quantityBefore,
        quantityAfter: params.quantityAfter,
      },
      ebay: { action: "unchanged", quantityDelta: 0 },
      mercari: {
        action: mercariWasSold
          ? "mark_eligible_to_relist"
          : "leave_existing_listing_unchanged",
        statusBefore: mercariStatusBefore,
        statusAfter: mercariWasSold ? "eligible_to_relist" : mercariStatusBefore,
        quantityDelta: 0,
      },
    },
  };
  return {
    metadata: {
      ...metadata,
      instacomp: {
        ...instaComp,
        exactMergeHistory: [...history.slice(-99), receipt],
      },
      dual_marketplace: {
        ...dual,
        mercari: nextMercari,
      },
    },
    receipt,
  };
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
      .select("id,title,description,player,sport,sku,ebay_item_id,price,quantity,archived_at,listing_status")
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
        "id,legacy_product_id,seller_account_id,status,quantity,price,title,description,sku,metadata,updated_at",
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
      let exactProducts = anchor
        ? (productsByAnchor.get(anchor) || []).filter(
            (product) =>
              classifyWebsiteProductIdentity({
                metadata,
                pendingTitle: row.title,
                product,
              }).status === "exact",
          )
        : [];
      const linked = row.legacy_product_id
        ? productsById.get(Number(row.legacy_product_id)) || null
        : null;
      const linkedSkuMatches = Boolean(
        linked &&
          isSellableWebsiteProduct(linked) &&
          text(row.sku) &&
          text(linked.sku) &&
          text(row.sku) === text(linked.sku),
      );
      if (exactProducts.length === 0 && linkedSkuMatches && linked) {
        exactProducts = [linked];
      }
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

      const priorStatus = text(prior.status);
      const prepared = priorStatus === "prepared" || priorStatus === "quantity_applied";
      const quantityAlreadyApplied = priorStatus === "quantity_applied";
      const productId = prepared
        ? Number(prior.productId || 0)
        : Number(target.id);
      const { data: currentProduct, error: currentProductError } = await supabase
        .from("products")
        .select("quantity")
        .eq("store_id", storeId)
        .eq("id", productId)
        .single();
      if (currentProductError) throw currentProductError;
      const liveProductQuantity = wholeQuantity(currentProduct?.quantity);
      const baselineQuantity = prepared
        ? wholeQuantity(prior.baselineQuantity)
        : liveProductQuantity;
      const addedQuantity = prepared
        ? wholeQuantity(prior.addedQuantity)
        : rowQuantity;
      let targetQuantity = liveProductQuantity + addedQuantity;
      let shouldWriteProductQuantity = !quantityAlreadyApplied;
      if (quantityAlreadyApplied) {
        targetQuantity = liveProductQuantity;
      } else if (prepared) {
        const preparedTarget = wholeQuantity(prior.targetQuantity);
        if (liveProductQuantity < baselineQuantity) {
          results.push({
            inventoryItemId: row.id,
            status: "blocked",
            reason: "prepared_quantity_changed_downward",
            productId,
            baselineQuantity,
            currentQuantity: liveProductQuantity,
            preparedTarget,
          });
          continue;
        }
        if (liveProductQuantity >= preparedTarget) {
          targetQuantity = liveProductQuantity;
          shouldWriteProductQuantity = false;
        } else if (liveProductQuantity === baselineQuantity) {
          targetQuantity = preparedTarget;
        } else {
          results.push({
            inventoryItemId: row.id,
            status: "blocked",
            reason: "prepared_quantity_state_ambiguous",
            productId,
            baselineQuantity,
            currentQuantity: liveProductQuantity,
            preparedTarget,
          });
          continue;
        }
      }
      if (!productId || targetQuantity < 1 || addedQuantity < 1) {
        results.push({ inventoryItemId: row.id, status: "blocked", reason: "invalid_reconciliation_quantity" });
        continue;
      }

      const { data: activeKeepers, error: keeperError } = await supabase
        .from("inventory_items")
        .select("id,quantity,price,title,description,metadata,seller_account_id")
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
      const sourceScanId = text(record(metadata.instacomp).scanId);
      const pricePreserved = Number(existingKeeper?.price || target.price || row.price || 0);
      let mergeReceipt: UnknownRecord | null = null;
      const sourceLegacyProductId = prepared
        ? Number(prior.sourceLegacyProductId || row.legacy_product_id || 0) || null
        : Number(row.legacy_product_id || 0) || null;
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
          sourceLegacyProductId,
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

      if (shouldWriteProductQuantity) {
        const { data: updatedProducts, error: productError } = await supabase
          .from("products")
          .update({
            quantity: targetQuantity,
            title: row.title,
            description: row.description || target.description || null,
          })
          .eq("store_id", storeId)
          .eq("id", productId)
          .eq("quantity", liveProductQuantity)
          .select("id,quantity");
        if (productError) throw productError;
        if (!updatedProducts?.length) {
          throw new Error(`Website product ${productId} quantity changed concurrently; retry reconciliation.`);
        }
      }

      const quantityAppliedMetadata = {
        ...preparedMetadata,
        website_inventory_reconciliation: {
          ...record(preparedMetadata.website_inventory_reconciliation),
          status: "quantity_applied",
          quantityAppliedAt: text(prior.quantityAppliedAt) || now,
          appliedQuantity: targetQuantity,
        },
      };
      if (!quantityAlreadyApplied) {
        const { error: appliedMarkerError } = await supabase
          .from("inventory_items")
          .update({ metadata: quantityAppliedMetadata, updated_at: now })
          .eq("store_id", storeId)
          .eq("id", row.id)
          .eq("status", "draft");
        if (appliedMarkerError) throw appliedMarkerError;
      }

      if (keeperId === row.id) {
        const mergePolicy = withExactMergeChannelPolicy(
          quantityAppliedMetadata,
          {
            now,
            sourceInventoryItemId: row.id,
            sourceScanId,
            keeperInventoryItemId: keeperId,
            productId,
            quantityBefore: baselineQuantity,
            quantityAdded: addedQuantity,
            quantityAfter: targetQuantity,
            pricePreserved,
          },
        );
        mergeReceipt = mergePolicy.receipt;
        const completedMetadata = {
          ...withWebsiteActive(mergePolicy.metadata, productId, now),
          website_inventory_reconciliation: {
            ...record(quantityAppliedMetadata.website_inventory_reconciliation),
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
        const mergePolicy = withExactMergeChannelPolicy(
          keeper.metadata,
          {
            now,
            sourceInventoryItemId: row.id,
            sourceScanId,
            keeperInventoryItemId: keeperId,
            productId,
            quantityBefore: baselineQuantity,
            quantityAdded: addedQuantity,
            quantityAfter: targetQuantity,
            pricePreserved,
          },
        );
        mergeReceipt = mergePolicy.receipt;
        const keeperMetadata = withWebsiteActive(
          mergePolicy.metadata,
          productId,
          now,
        );
        const { error: keeperSaveError } = await supabase
          .from("inventory_items")
          .update({
            quantity: targetQuantity,
            title: row.title,
            description: row.description || keeper.description || null,
            metadata: keeperMetadata,
            updated_at: now,
          })
          .eq("store_id", storeId)
          .eq("id", keeperId)
          .eq("status", "active");
        if (keeperSaveError) throw keeperSaveError;

        const completedMetadata = {
          ...quantityAppliedMetadata,
          commercial_merge: {
            merge_id: text(mergeReceipt?.mergeId),
            keeper_inventory_item_id: keeperId,
            website_product_id: productId,
            source_scan_id: sourceScanId,
            merged_quantity: addedQuantity,
            price_preserved: pricePreserved,
            channel_actions: record(mergeReceipt?.channels),
            merged_at: now,
            reason: "exact_current_website_inventory_quantity_merge",
            reversible: true,
          },
          website_inventory_reconciliation: {
            ...record(quantityAppliedMetadata.website_inventory_reconciliation),
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
            // One canonical inventory row owns each website product. Preserve the
            // target product in reconciliation metadata instead of violating the
            // (store_id, legacy_product_id) uniqueness constraint on the archived source.
            legacy_product_id: null,
            metadata: completedMetadata,
            updated_at: now,
          })
          .eq("store_id", storeId)
          .eq("id", row.id);
        if (archiveError) throw archiveError;

        if (sourceLegacyProductId && sourceLegacyProductId !== productId) {
          const { data: sourceProduct, error: sourceProductError } = await supabase
            .from("products")
            .select("id,quantity,price,archived_at,ebay_item_id")
            .eq("store_id", storeId)
            .eq("id", sourceLegacyProductId)
            .maybeSingle();
          if (sourceProductError) throw sourceProductError;
          const sourceIsSellable =
            sourceProduct &&
            !sourceProduct.archived_at &&
            Number(sourceProduct.quantity || 0) > 0 &&
            Number(sourceProduct.price || 0) > 0;
          const sourceHasEbay = Boolean(text(sourceProduct?.ebay_item_id));
          if (sourceProduct && !sourceIsSellable && !sourceHasEbay) {
            const { error: sourceArchiveError } = await supabase
              .from("products")
              .update({ quantity: 0, archived_at: now, listing_status: "draft" })
              .eq("store_id", storeId)
              .eq("id", sourceLegacyProductId);
            if (sourceArchiveError) throw sourceArchiveError;
          }
        }
      }

      results.push({
        inventoryItemId: row.id,
        status: "reconciled",
        productId,
        keeperInventoryItemId: keeperId,
        baselineQuantity,
        addedQuantity,
        resultingQuantity: targetQuantity,
        pricePreserved,
        mercariAction: text(
          record(record(mergeReceipt?.channels).mercari).action,
        ),
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
