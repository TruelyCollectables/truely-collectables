import { timingSafeEqual } from "node:crypto";
import { runEbayAuthoritativeStoreSync } from "../../../../lib/ebay-authoritative-store-sync";
import { syncRecentLegacyEbayQuantities } from "../../../../lib/ebay-fixed-price-backfill";
import { repairEbayListingImages } from "../../../../lib/ebay-image-repair";
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
  let imageRepair: Awaited<ReturnType<typeof repairEbayListingImages>> | null =
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

  try {
    imageRepair = await repairEbayListingImages({ supabase, storeId });
    if (imageRepair.errors.length > 0) {
      errors.push({
        step: "ebay_front_back_image_repair",
        error: `${imageRepair.errors.length} listing${
          imageRepair.errors.length === 1 ? "" : "s"
        } could not complete front/back image repair.`,
      });
    }
  } catch (error: any) {
    errors.push({
      step: "ebay_front_back_image_repair",
      error: String(error?.message || "eBay image repair failed").slice(0, 500),
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

  return Response.json(
    {
      success: errors.length === 0,
      storeId,
      durationMs: Date.now() - startedAt,
      authoritativeSync,
      imageRepair,
      quantitySync,
      errors,
    },
    { status: errors.length === 0 ? 200 : 207 },
  );
}
