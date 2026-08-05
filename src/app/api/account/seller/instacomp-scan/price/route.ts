import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function price(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    const selectedPrice = price(body.price);
    const source = String(body.source || "scanner_manual").slice(0, 80);
    if (!inventoryItemId || !selectedPrice) {
      return Response.json({ success: false, error: "A valid inventory item and price are required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: row, error: readError } = await supabase
      .from("inventory_items")
      .select("id,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .single();
    if (readError || !row) return Response.json({ success: false, error: "Pending item not found." }, { status: 404 });

    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const instaComp = (metadata as any).instacomp && typeof (metadata as any).instacomp === "object"
      ? (metadata as any).instacomp
      : {};
    const nextMetadata = {
      ...(metadata as Record<string, unknown>),
      instacomp: {
        ...instaComp,
        listingPrice: selectedPrice,
        listingPriceSource: source,
        pricingChosenAt: new Date().toISOString(),
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ price: selectedPrice, metadata: nextMetadata, updated_at: new Date().toISOString() })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id);
    if (updateError) throw updateError;

    return Response.json({ success: true, inventoryItemId, price: selectedPrice, source });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Could not save price." }, { status: 500 });
  }
}
