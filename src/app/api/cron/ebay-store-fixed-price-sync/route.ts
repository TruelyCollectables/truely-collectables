import { timingSafeEqual } from "node:crypto";
import { runEbayAuthoritativeStoreSync } from "../../../../lib/ebay-authoritative-store-sync";
import { syncEbayAllListingImages } from "../../../../lib/ebay-all-image-sync";
import { syncRecentLegacyEbayQuantities } from "../../../../lib/ebay-fixed-price-backfill";
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
  let authoritativeSync: Awaited<
    ReturnType<typeof runEbayAuthoritativeStoreSync>
  > | null = null;
  let imageSync: Awaited<ReturnType<typeof syncEbayAllListingImages>> | null =
    null;
  let quantitySync: Awaited<
    ReturnType<typeof syncRecentLegacyEbayQuantities>
  > | null = null;
  const errors: Array<{ step: string; error: string }> = [];

  try {
    authoritativeSync = await runEbayAuthoritativeStoreSync({
      supabase,
      storeId,
      mode: "apply",
      // Launch safety: import/update every active fixed-price collectible, but do
      // not automatically deactivate historical rows until an audit is reviewed.
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

  const durationMs = Date.now() - startedAt;
  const receipt = {
    event: "ebay_store_fixed_price_sync_completed",
    success: errors.length === 0,
    storeId,
    durationMs,
    authoritative: authoritativeSync
      ? {
          remoteFixedPriceTotal: authoritativeSync.remoteFixedPriceTotal,
          pagesRead: authoritativeSync.pagesRead,
          cycleComplete: authoritativeSync.cycleComplete,
          eligibleCollectibles: authoritativeSync.eligibleCollectibles,
          skippedNonCollectibles: authoritativeSync.skippedNonCollectibles,
          inserted: authoritativeSync.inserted,
          updated: authoritativeSync.updated,
          unchanged: authoritativeSync.unchanged,
          deactivated: authoritativeSync.deactivated,
          failed: authoritativeSync.failed,
          localLinkedBefore: authoritativeSync.localLinkedBefore,
          localLinkedAfter: authoritativeSync.localLinkedAfter,
          errorSample: authoritativeSync.errors.slice(0, 5).map((entry) => ({
            itemId: entry.itemId,
            error: entry.error,
          })),
        }
      : null,
    images: imageSync
      ? {
          checked: imageSync.checked,
          updated: imageSync.updated,
          imagesAdded: imageSync.imagesAdded,
          imagesRemoved: imageSync.imagesRemoved,
          pagesRead: imageSync.pagesRead,
          cycleComplete: imageSync.cycleComplete,
          remainingCandidates: imageSync.remainingCandidates,
          failed: imageSync.errors.length,
          errorSample: imageSync.errors.slice(0, 5),
        }
      : null,
    quantities: quantitySync
      ? {
          checked: quantitySync.checked,
          pushedToEbay: quantitySync.pushedToEbay,
          endedOnEbay: quantitySync.endedOnEbay,
          reducedLocally: quantitySync.reducedLocally,
          unchanged: quantitySync.unchanged,
          failed: quantitySync.failed,
          errorSample: quantitySync.errors.slice(0, 5),
        }
      : null,
    errors,
  };

  console.info(`[ebay-store-fixed-price-sync] ${JSON.stringify(receipt)}`);

  return Response.json(
    {
      success: errors.length === 0,
      storeId,
      durationMs,
      authoritativeSync,
      imageSync,
      quantitySync,
      errors,
    },
    { status: errors.length === 0 ? 200 : 207 },
  );
}
