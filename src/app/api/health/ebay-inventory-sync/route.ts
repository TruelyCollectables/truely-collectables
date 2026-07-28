import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET() {
  try {
    const storeId = getActiveStoreId();
    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("seller_marketplace_connections")
      .select("provider_metadata,updated_at")
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .eq("connection_status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const metadata = recordValue(data?.provider_metadata);
    const receipt = recordValue(
      metadata.ebay_store_fixed_price_sync_receipt,
    );

    if (!receipt.event) {
      return Response.json(
        {
          available: false,
          storeId,
          message: "No complete eBay inventory sync receipt has been recorded yet.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return Response.json(
      {
        available: true,
        storeId,
        receipt,
      },
      {
        status: receipt.success === true ? 200 : 207,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      {
        available: false,
        message: "The eBay inventory synchronization status is temporarily unavailable.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
