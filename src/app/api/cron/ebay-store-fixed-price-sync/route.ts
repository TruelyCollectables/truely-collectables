import { timingSafeEqual } from "node:crypto";
import { runEbayAuthoritativeStoreSync } from "../../../../lib/ebay-authoritative-store-sync";
import { syncEbayAllListingImages } from "../../../../lib/ebay-all-image-sync";
import { syncRecentLegacyEbayQuantities } from "../../../../lib/ebay-fixed-price-backfill";
import { retryPendingEbayQuantitySyncs } from "../../../../lib/ebay-quantity-sync-outbox";
import { retryOrderNotifications } from "../../../../lib/order-notifications";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_PASSES = 5;
const MAX_CONVERGENCE_PASSES = 3;

type SyncError = { step: string; error: string };
type ImageSync = Awaited<ReturnType<typeof syncEbayAllListingImages>>;
type AuthoritativeSync = Awaited<
  ReturnType<typeof runEbayAuthoritativeStoreSync>
>;

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrorMessage(value: unknown, fallback: string) {
  const message =
    value instanceof Error ? value.message : String(value || fallback);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(refresh_token|access_token|client_secret|service_role_key|anon_key)[=:]\s*[^\s,}]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function summarizeAuthoritative(sync: AuthoritativeSync | null) {
  return sync
    ? {
        remoteFixedPriceTotal: sync.remoteFixedPriceTotal,
        pagesRead: sync.pagesRead,
        cycleComplete: sync.cycleComplete,
        eligibleCollectibles: sync.eligibleCollectibles,
        skippedNonCollectibles: sync.skippedNonCollectibles,
        mergedAliasListings: sync.mergedAliasListings,
        representedInventoryRows: sync.representedInventoryRows,
        inserted: sync.inserted,
        updated: sync.updated,
        unchanged: sync.unchanged,
        deactivated: sync.deactivated,
        failed: sync.failed,
        localLinkedBefore: sync.localLinkedBefore,
        localLinkedAfter: sync.localLinkedAfter,
        errorSample: sync.errors.slice(0, 5).map((entry) => ({
          itemId: entry.itemId,
          error: safeErrorMessage(entry.error, "Unknown listing sync error"),
        })),
        changedSample: sync.actions
          .filter((entry) =>
            ["insert", "update", "deactivate", "error"].includes(entry.action),
          )
          .slice(0, 10)
          .map((entry) => ({
            itemId: entry.itemId,
            title: entry.title.slice(0, 120),
            action: entry.action,
            reason: safeErrorMessage(entry.reason, "Listing changed"),
            remoteQuantity: entry.remoteQuantity,
            localQuantity: entry.localQuantity,
            remotePrice: entry.remotePrice,
            localPrice: entry.localPrice,
            sku: entry.sku,
            categoryName: entry.categoryName,
          })),
      }
    : null;
}

function summarizeImagePass(sync: ImageSync, pass: number) {
  return {
    pass,
    checked: sync.checked,
    updated: sync.updated,
    imagesAdded: sync.imagesAdded,
    imagesRemoved: sync.imagesRemoved,
    pagesRead: sync.pagesRead,
    cycleComplete: sync.cycleComplete,
    sourceCall: sync.sourceCall,
    getItemChecked: sync.getItemChecked,
    getItemHydrated: sync.getItemHydrated,
    getItemMultiPicture: sync.getItemMultiPicture,
    getItemFailed: sync.getItemFailed,
    remainingCandidates: sync.remainingCandidates,
    failed: sync.errors.length,
    errorSample: sync.errors.slice(0, 5).map((entry) => ({
      legacyProductId: entry.legacyProductId,
      error: safeErrorMessage(entry.error, "Unknown image sync error"),
    })),
  };
}

function isConverged(sync: AuthoritativeSync) {
  return (
    sync.cycleComplete &&
    sync.failed === 0 &&
    sync.inserted === 0 &&
    sync.updated === 0 &&
    sync.deactivated === 0 &&
    sync.unchanged === sync.representedInventoryRows
  );
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Scheduled eBay fixed-price sync is not configured." },
      { status: 503 },
    );
  }

  if (!validCronAuthorization(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const errors: SyncError[] = [];
  const warnings: SyncError[] = [];
  let firstAuthoritative: AuthoritativeSync | null = null;
  const convergencePasses: AuthoritativeSync[] = [];
  const imagePasses: Array<ReturnType<typeof summarizeImagePass>> = [];
  let quantitySync: Awaited<
    ReturnType<typeof syncRecentLegacyEbayQuantities>
  > | null = null;
  let activeLinkedProducts: number | null = null;
  let postSaleProtectionAvailable = true;
  let postSaleQuantitySync: Awaited<
    ReturnType<typeof retryPendingEbayQuantitySyncs>
  > | null = null;
  let notificationRetry: Awaited<
    ReturnType<typeof retryOrderNotifications>
  > | null = null;

  try {
    postSaleQuantitySync = await retryPendingEbayQuantitySyncs({
      supabase,
      storeId,
      limit: 100,
    });
    if (postSaleQuantitySync.deferredProducts > 0) {
      warnings.push({
        step: "post_sale_ebay_quantity_retry",
        error:
          String(postSaleQuantitySync.deferredProducts) +
          " sold product" +
          (postSaleQuantitySync.deferredProducts === 1 ? "" : "s") +
          " remain protected locally and queued for another outbound eBay quantity retry.",
      });
    }
  } catch (error) {
    postSaleProtectionAvailable = false;
    errors.push({
      step: "post_sale_ebay_quantity_retry",
      error: safeErrorMessage(
        error,
        "Durable post-sale eBay quantity protection is unavailable",
      ),
    });
  }

  try {
    notificationRetry = await retryOrderNotifications({
      supabase,
      storeId,
      limit: 25,
    });
    if (notificationRetry.failed > 0) {
      warnings.push({
        step: "order_notification_retry",
        error:
          String(notificationRetry.failed) +
          " customer notification" +
          (notificationRetry.failed === 1 ? "" : "s") +
          " remain queued after this retry pass.",
      });
    }
  } catch (error) {
    warnings.push({
      step: "order_notification_retry",
      error: safeErrorMessage(error, "Order notification retry failed"),
    });
  }

  if (postSaleProtectionAvailable) {
    try {
      firstAuthoritative = await runEbayAuthoritativeStoreSync({
        supabase,
        storeId,
        mode: "apply",
        // Current eBay is authoritative: active eligible listings are inserted or
        // updated and eBay-linked rows absent from a complete result are set to zero.
        deactivateEnded: true,
      });

      if (!firstAuthoritative.cycleComplete) {
        errors.push({
          step: "authoritative_full_store_sync",
          error: "The complete active eBay page cycle was not read.",
        });
      }
      if (firstAuthoritative.failed > 0) {
        errors.push({
          step: "authoritative_full_store_sync",
          error: `${firstAuthoritative.failed} listing${
            firstAuthoritative.failed === 1 ? "" : "s"
          } failed during the full-store sync.`,
        });
      }
      if (
        firstAuthoritative.cycleComplete &&
        firstAuthoritative.eligibleCollectibles +
          firstAuthoritative.skippedNonCollectibles !==
          firstAuthoritative.remoteFixedPriceTotal
      ) {
        errors.push({
          step: "authoritative_full_store_sync",
          error:
            "The active eBay total did not reconcile to eligible plus intentionally excluded listings.",
        });
      }

      if (
        firstAuthoritative.cycleComplete &&
        firstAuthoritative.representedInventoryRows +
          firstAuthoritative.mergedAliasListings !==
          firstAuthoritative.eligibleCollectibles
      ) {
        errors.push({
          step: "authoritative_full_store_sync",
          error:
            "Represented inventory rows plus merged aliases did not reconcile to eligible eBay listings.",
        });
      }
    } catch (error) {
      errors.push({
        step: "authoritative_full_store_sync",
        error: safeErrorMessage(error, "Full eBay store sync failed"),
      });
    }
  } else {
    errors.push({
      step: "authoritative_full_store_sync",
      error:
        "Inbound eBay reconciliation was skipped because durable post-sale quantity protection could not be verified.",
    });
  }

  if (errors.length === 0) {
    for (let pass = 1; pass <= MAX_IMAGE_PASSES; pass += 1) {
      try {
        const imageSync = await syncEbayAllListingImages({ supabase, storeId });
        imagePasses.push(summarizeImagePass(imageSync, pass));

        if (!imageSync.cycleComplete) {
          errors.push({
            step: "ebay_all_image_sync",
            error: `Image pass ${pass} did not read every active eBay page.`,
          });
          break;
        }
        if (imageSync.errors.length > 0) {
          errors.push({
            step: "ebay_all_image_sync",
            error: `${imageSync.errors.length} listing${
              imageSync.errors.length === 1 ? "" : "s"
            } failed image reconciliation on pass ${pass}.`,
          });
          break;
        }
        if (imageSync.remainingCandidates === 0) break;
      } catch (error) {
        errors.push({
          step: "ebay_all_image_sync",
          error: safeErrorMessage(error, "Full eBay image sync failed"),
        });
        break;
      }
    }

    if (
      imagePasses.length === 0 ||
      imagePasses[imagePasses.length - 1].remainingCandidates !== 0
    ) {
      errors.push({
        step: "ebay_all_image_sync",
        error:
          "Image reconciliation did not converge to zero remaining candidates.",
      });
    }
  }

  if (errors.length === 0) {
    try {
      quantitySync = await syncRecentLegacyEbayQuantities({
        supabase,
        storeId,
      });
      if (quantitySync.failed > 0) {
        errors.push({
          step: "legacy_quantity_reconciliation",
          error: `${quantitySync.failed} listing${
            quantitySync.failed === 1 ? "" : "s"
          } failed quantity reconciliation.`,
        });
      }
    } catch (error) {
      errors.push({
        step: "legacy_quantity_reconciliation",
        error: safeErrorMessage(error, "Quantity reconciliation failed"),
      });
    }
  }

  if (errors.length === 0) {
    for (let pass = 1; pass <= MAX_CONVERGENCE_PASSES; pass += 1) {
      try {
        const convergence = await runEbayAuthoritativeStoreSync({
          supabase,
          storeId,
          mode: "apply",
          deactivateEnded: true,
        });
        convergencePasses.push(convergence);

        if (!convergence.cycleComplete || convergence.failed > 0) {
          errors.push({
            step: "authoritative_convergence",
            error: `Convergence pass ${pass} was incomplete or had ${convergence.failed} failures.`,
          });
          break;
        }
        if (isConverged(convergence)) break;
        if (pass === MAX_CONVERGENCE_PASSES) {
          errors.push({
            step: "authoritative_convergence",
            error: `Inventory did not converge after ${MAX_CONVERGENCE_PASSES} complete eBay reads.`,
          });
        }
      } catch (error) {
        errors.push({
          step: "authoritative_convergence",
          error: safeErrorMessage(error, "Final eBay convergence failed"),
        });
        break;
      }
    }
  }

  const finalAuthoritative =
    convergencePasses[convergencePasses.length - 1] || firstAuthoritative;

  if (errors.length === 0 && finalAuthoritative) {
    try {
      const { count, error } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .gt("quantity", 0)
        .not("ebay_item_id", "is", null);
      if (error) throw error;
      activeLinkedProducts = Number(count || 0);
      if (
        activeLinkedProducts !== finalAuthoritative.representedInventoryRows
      ) {
        errors.push({
          step: "database_inventory_audit",
          error: `Active linked database count ${activeLinkedProducts} does not equal represented eBay inventory ${finalAuthoritative.representedInventoryRows}.`,
        });
      }
    } catch (error) {
      errors.push({
        step: "database_inventory_audit",
        error: safeErrorMessage(error, "Database inventory audit failed"),
      });
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const receipt = {
    schema: "truelycollectables.ebayStoreFixedPriceSyncReceipt.v3",
    event: "ebay_store_fixed_price_sync_completed",
    startedAt,
    completedAt,
    success: errors.length === 0,
    storeId,
    durationMs,
    postSaleProtectionAvailable,
    postSaleQuantitySync,
    notificationRetry,
    warnings,
    authoritative: summarizeAuthoritative(firstAuthoritative),
    imagePasses,
    quantities: quantitySync
      ? {
          checked: quantitySync.checked,
          pushedToEbay: quantitySync.pushedToEbay,
          endedOnEbay: quantitySync.endedOnEbay,
          reducedLocally: quantitySync.reducedLocally,
          unchanged: quantitySync.unchanged,
          failed: quantitySync.failed,
          errorSample: quantitySync.errors.slice(0, 5).map((entry) => ({
            itemId: entry.itemId,
            error: safeErrorMessage(entry.error, "Unknown quantity error"),
          })),
        }
      : null,
    convergencePasses: convergencePasses.map((sync, index) => ({
      pass: index + 1,
      ...summarizeAuthoritative(sync),
    })),
    finalAuthoritative: summarizeAuthoritative(finalAuthoritative),
    databaseAudit: {
      activeLinkedProducts,
      expectedActiveLinkedProducts:
        finalAuthoritative?.representedInventoryRows ?? null,
      matchesEligibleEbayInventory:
        finalAuthoritative !== null &&
        activeLinkedProducts === finalAuthoritative.representedInventoryRows,
    },
    errors,
  };

  try {
    const connectionResult = await supabase
      .from("seller_marketplace_connections")
      .select("id,provider_metadata")
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .eq("connection_status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (connectionResult.error || !connectionResult.data?.id) {
      throw (
        connectionResult.error ||
        new Error("Connected eBay account was not found.")
      );
    }
    const providerMetadata = recordValue(
      connectionResult.data.provider_metadata,
    );
    const updateResult = await supabase
      .from("seller_marketplace_connections")
      .update({
        provider_metadata: {
          ...providerMetadata,
          ebay_store_fixed_price_sync_receipt: receipt,
        },
        updated_at: completedAt,
      })
      .eq("id", connectionResult.data.id)
      .eq("store_id", storeId);
    if (updateResult.error) throw updateResult.error;
  } catch (error) {
    errors.push({
      step: "persist_sync_receipt",
      error: safeErrorMessage(error, "Could not persist the sync receipt"),
    });
    receipt.success = false;
  }

  console.info(`[ebay-store-fixed-price-sync] ${JSON.stringify(receipt)}`);

  return Response.json(receipt, {
    status: receipt.success ? 200 : 207,
    headers: { "Cache-Control": "no-store" },
  });
}
