import { timingSafeEqual } from "node:crypto";
import {
  importSellerEbayFixedPricePage,
  syncRecentLegacyEbayQuantities,
} from "../../../../lib/ebay-fixed-price-backfill";
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
  let backfill: Awaited<ReturnType<typeof importSellerEbayFixedPricePage>> | null =
    null;
  let quantitySync: Awaited<ReturnType<typeof syncRecentLegacyEbayQuantities>> | null =
    null;
  const errors: Array<{ step: string; error: string }> = [];

  try {
    backfill = await importSellerEbayFixedPricePage({ supabase, storeId });
  } catch (error: any) {
    errors.push({
      step: "fixed_price_backfill",
      error: String(error.message || "Backfill failed").slice(0, 500),
    });
  }

  try {
    quantitySync = await syncRecentLegacyEbayQuantities({ supabase, storeId });
  } catch (error: any) {
    errors.push({
      step: "legacy_quantity_sync",
      error: String(error.message || "Quantity sync failed").slice(0, 500),
    });
  }

  return Response.json(
    {
      success: errors.length === 0,
      storeId,
      durationMs: Date.now() - startedAt,
      backfill,
      quantitySync,
      errors,
    },
    { status: errors.length === 0 ? 200 : 207 },
  );
}
