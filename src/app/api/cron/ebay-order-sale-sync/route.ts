import { timingSafeEqual } from "node:crypto";
import { syncRecentEbayOrderSales } from "../../../../lib/ebay-order-sale-sync";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Scheduled eBay order sale sync is not configured." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncRecentEbayOrderSales({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      lookbackDays: 90,
    });
    return Response.json(
      {
        success: result.failed === 0,
        event: "ebay_order_sale_sync_completed",
        ...result,
      },
      { status: result.failed === 0 ? 200 : 207 },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        event: "ebay_order_sale_sync_failed",
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown eBay order sale sync failure",
      },
      { status: 500 },
    );
  }
}
