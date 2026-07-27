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

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
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

  const startedAt = Date.now();
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  let postSaleQuantitySync: Awaited<
    ReturnType<typeof retryPendingEbayQuantitySyncs>
  > | null = null;
  let notificationRetry: Awaited<
    ReturnType<typeof retryOrderNotifications>
  > | null = null;
  let authoritativeSync: Awaited<
    ReturnType<typeof runEbayAuthoritativeStoreSync>
  > | null = null;
  let imageSync: Awaited<ReturnType<typeof syncEbayAllListingImages>> | null =
    null;
  let quantitySync: Awaited<
    ReturnType<typeof syncRecentLegacyEbayQuantities>
  > | null = null;
  const errors: Array<{ step: string; error: string }> = [];
  let postSaleProtectionAvailable = true;

  try {
    postSaleQuantitySync = await retryPendingEbayQuantitySyncs({
      supabase,
      storeId,
      limit: 100,
    });

    if (postSaleQuantitySync.deferredProducts > 0) {
      errors.push({
        step: "post_sale_ebay_quantity_retry",
        error: `${postSaleQuantitySync.deferredProducts} sold product${
          postSaleQuantitySync.deferredProducts === 1 ? "" : "s"
        } still require an outbound eBay quantity retry. Local sold quantities remain protected from inbound increases.`,
      });
    }
  } catch (error: any) {
    postSaleProtectionAvailable = false;
    errors.push({
      step: "post_sale_ebay_quantity_retry",
      error: String(
        error?.message || "Post-sale eBay quantity protection is unavailable",
      ).slice(0, 500),
    });
  }

  try {
    notificationRetry = await retryOrderNotifications({
      supabase,
      storeId,
      limit: 25,
    });

    if (notificationRetry.failed > 0) {
      errors.push({
        step: "order_notification_retry",
        error: `${notificationRetry.failed} customer notification${
          notificationRetry.failed === 1 ? "" : "s"
        } still failed delivery.`,
      });
    }
  } catch (error: any) {
    errors.push({
      step: "order_notification_retry",
      error: String(
        error?.message || "Order notification retry failed",
      ).slice(0, 500),
    });
  }

  if (postSaleProtectionAvailable) {
    try {
      authoritativeSync = await runEbayAuthoritativeStoreSync({
        supabase,
        storeId,
        mode: "apply",
        // Launch safety: import/update every active fixed-price sports card, but do
        // not automatically deactivate historical rows until the first audit is reviewed.
        deactivateEnded: false,
      });

      if (authoritativeSync.failed > 0) {
        errors.push({
          step: "authoritative_full_store_sync",
          error: `${authoritativeSync.failed} listing${
            authoritativeSync.failed === 1 ? "" : "s"
          } failed during the full-store sync.`,
        });
      }
    } catch (error: any) {
      errors.push({
        step: "authoritative_full_store_sync",
        error: String(
          error?.message || "Full eBay store sync failed",
        ).slice(0, 500),
      });
    }
  } else {
    errors.push({
      step: "authoritative_full_store_sync",
      error:
        "Inbound eBay quantity reconciliation was skipped because durable post-sale quantity protection could not be verified.",
    });
  }

  try {
    imageSync = await syncEbayAllListingImages({
      supabase,
      storeId,
    });

    if (imageSync.errors.length > 0) {
      errors.push({
        step: "ebay_all_image_sync",
        error: `${imageSync.errors.length} listing${
          imageSync.errors.length === 1 ? "" : "s"
        } could not complete 1-20 image synchronization.`,
      });
    }
  } catch (error: any) {
    errors.push({
      step: "ebay_all_image_sync",
      error: String(error?.message || "Full eBay image sync failed").slice(
        0,
        500,
      ),
    });
  }

  if (postSaleProtectionAvailable) {
    try {
      quantitySync = await syncRecentLegacyEbayQuantities({
        supabase,
        storeId,
      });
    } catch (error: any) {
      errors.push({
        step: "legacy_quantity_reconciliation",
        error: String(
          error?.message || "Quantity reconciliation failed",
        ).slice(0, 500),
      });
    }
  }

  return Response.json(
    {
      success: errors.length === 0,
      storeId,
      durationMs: Date.now() - startedAt,
      postSaleProtectionAvailable,
      postSaleQuantitySync,
      notificationRetry,
      authoritativeSync,
      imageSync,
      quantitySync,
      errors,
    },
    { status: errors.length === 0 ? 200 : 207 },
  );
}
