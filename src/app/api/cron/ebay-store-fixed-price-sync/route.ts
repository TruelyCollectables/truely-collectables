import { timingSafeEqual } from "node:crypto";
import {
  importSellerEbayFixedPricePage,
  syncRecentLegacyEbayQuantities,
} from "../../../../lib/ebay-fixed-price-backfill";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BACKFILL_PAGES_PER_RUN = 10;
const STOP_BACKFILL_AFTER_MS = 225_000;

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
  const backfillPages: Array<
    Awaited<ReturnType<typeof importSellerEbayFixedPricePage>>
  > = [];
  let quantitySync: Awaited<
    ReturnType<typeof syncRecentLegacyEbayQuantities>
  > | null = null;
  const errors: Array<{ step: string; error: string }> = [];

  try {
    for (let page = 0; page < MAX_BACKFILL_PAGES_PER_RUN; page += 1) {
      const result = await importSellerEbayFixedPricePage({ supabase, storeId });
      backfillPages.push(result);

      const completedFullCycle = result.nextPage === 1;
      const approachingTimeout = Date.now() - startedAt >= STOP_BACKFILL_AFTER_MS;

      if (completedFullCycle || approachingTimeout) break;
    }
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

  const backfill = {
    pagesProcessed: backfillPages.length,
    inserted: backfillPages.reduce((total, page) => total + page.inserted, 0),
    existing: backfillPages.reduce((total, page) => total + page.existing, 0),
    failed: backfillPages.reduce((total, page) => total + page.failed, 0),
    eligibleCardsSeen: backfillPages.reduce(
      (total, page) => total + page.eligibleCardsSeen,
      0,
    ),
    totalEntries: backfillPages.at(-1)?.totalEntries || 0,
    totalPages: backfillPages.at(-1)?.totalPages || 0,
    nextPage: backfillPages.at(-1)?.nextPage || 1,
    completedFullCycle: backfillPages.at(-1)?.nextPage === 1,
    pageResults: backfillPages,
  };

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
