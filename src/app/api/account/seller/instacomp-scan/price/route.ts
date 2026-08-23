import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import {
  discountedListingPrice,
  listingPromotionFromMetadata,
} from "../../../../../../lib/listing-promotions";
import { instaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";

export const dynamic = "force-dynamic";

function price(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
      .select("id,legacy_product_id,seller_account_id,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .single();
    if (readError || !row) return Response.json({ success: false, error: "Pending item not found." }, { status: 404 });

    const groupKey = instaCompPricingGroupKey(row.metadata) || "";
    const applyGroup = body.applyGroup !== false && Boolean(groupKey);
    let candidates = [row];
    if (applyGroup) {
      const { data: ownedRows, error: groupReadError } = await supabase
        .from("inventory_items")
        .select("id,legacy_product_id,seller_account_id,metadata")
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id)
        .range(0, 4999);
      if (groupReadError) throw groupReadError;
      candidates = (ownedRows || []).filter(
        (candidate) => instaCompPricingGroupKey(candidate.metadata) === groupKey,
      );
    }

    const now = new Date().toISOString();
    let updatedCount = 0;
    for (const candidate of candidates) {
      const metadata = record(candidate.metadata);
      const instaComp = record(metadata.instacomp);
      const promotion = listingPromotionFromMetadata(metadata);
      const effectivePrice = promotion.onSale
        ? discountedListingPrice(selectedPrice, promotion.discountPercent) || selectedPrice
        : selectedPrice;
      const promo = record(metadata.tcos_promo);
      const nextMetadata = {
        ...metadata,
        ...(promotion.onSale
          ? {
              tcos_promo: {
                ...promo,
                original_price: selectedPrice,
                sale_price: effectivePrice,
              },
            }
          : {}),
        instacomp: {
          ...instaComp,
          listingPrice: effectivePrice,
          pricingGroupBasePrice: selectedPrice,
          listingPriceSource: source,
          pricingChosenAt: now,
          pricingGroupKey: groupKey || null,
        },
      };

      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ price: effectivePrice, metadata: nextMetadata, updated_at: now })
        .eq("id", candidate.id)
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id);
      if (updateError) throw updateError;

      if (candidate.legacy_product_id) {
        const { error: productError } = await supabase
          .from("products")
          .update({ price: effectivePrice })
          .eq("store_id", storeId)
          .eq("id", candidate.legacy_product_id);
        if (productError) throw productError;
      }
      updatedCount += 1;
    }

    return Response.json({
      success: true,
      inventoryItemId,
      price: selectedPrice,
      source,
      groupKey: groupKey || null,
      grouped: applyGroup,
      updatedCount,
    });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Could not save price." }, { status: 500 });
  }
}
