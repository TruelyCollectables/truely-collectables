import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  boundedPromotionPercent,
  discountedListingPrice,
  listingPromotionFromMetadata,
  normalizeListingCouponCode,
  roundedMoney,
} from "../../../../../../lib/listing-promotions";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommerceAction =
  | "apply-sale"
  | "clear-sale"
  | "set-discount-coupon"
  | "clear-discount-coupon"
  | "set-free-shipping-coupon"
  | "clear-free-shipping-coupon";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inventoryIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((entry) => String(entry || "").trim())
        .filter((entry) => /^[0-9a-f-]{36}$/i.test(entry)),
    ),
  ].slice(0, 100);
}

function commerceAction(value: unknown): CommerceAction | null {
  const action = String(value || "");
  return [
    "apply-sale",
    "clear-sale",
    "set-discount-coupon",
    "clear-discount-coupon",
    "set-free-shipping-coupon",
    "clear-free-shipping-coupon",
  ].includes(action)
    ? (action as CommerceAction)
    : null;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const action = commerceAction(body.action);
    const ids = inventoryIds(body.inventoryItemIds);
    if (!action) {
      return Response.json({ error: "Choose a valid sale or coupon action." }, { status: 400 });
    }
    if (!ids.length) {
      return Response.json({ error: "Select at least one inventory item." }, { status: 400 });
    }

    const discountPercent = action === "apply-sale" || action === "set-discount-coupon"
      ? boundedPromotionPercent(body.discountPercent)
      : null;
    if (
      (action === "apply-sale" || action === "set-discount-coupon") &&
      discountPercent === null
    ) {
      return Response.json(
        { error: "Discount percentage must be between 1% and 25%." },
        { status: 400 },
      );
    }

    const couponCode = action === "set-discount-coupon" || action === "set-free-shipping-coupon"
      ? normalizeListingCouponCode(body.couponCode)
      : null;
    if (
      (action === "set-discount-coupon" || action === "set-free-shipping-coupon") &&
      !couponCode
    ) {
      return Response.json(
        { error: "Coupon codes need 3–32 letters, numbers, dashes, or underscores." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let query = supabase
      .from("inventory_items")
      .select("id,legacy_product_id,title,status,price,metadata")
      .eq("store_id", storeId)
      .in("id", ids);
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: rows, error: readError } = await query;
    if (readError) throw readError;

    const results: Array<{
      inventoryItemId: string;
      title: string;
      success: boolean;
      message: string;
    }> = [];
    const now = new Date().toISOString();

    for (const row of rows || []) {
      const metadata = record(row.metadata);
      const currentPromo = record(metadata.tcos_promo);
      const parsedPromo = listingPromotionFromMetadata(metadata);
      let nextPrice = roundedMoney(row.price);
      let nextPromo: Record<string, unknown> = { ...currentPromo };
      let productPriceChanged = false;

      if (action === "apply-sale") {
        const originalPrice = parsedPromo.originalPrice || nextPrice;
        const salePrice = discountedListingPrice(originalPrice, discountPercent);
        if (!salePrice || originalPrice <= 0) {
          results.push({
            inventoryItemId: row.id,
            title: row.title || "Untitled item",
            success: false,
            message: "Set a selling price before putting this item on sale.",
          });
          continue;
        }
        nextPrice = salePrice;
        nextPromo = {
          ...nextPromo,
          on_sale: true,
          original_price: originalPrice,
          sale_price: salePrice,
          discount_percent: discountPercent,
          applied_at: now,
          applied_by: account.id,
          source: "kingmaker_bulk_commerce",
        };
      } else if (action === "clear-sale") {
        nextPrice = parsedPromo.originalPrice || nextPrice;
        nextPromo = {
          ...nextPromo,
          on_sale: false,
          sale_price: null,
          discount_percent: 0,
          cleared_at: now,
          cleared_by: account.id,
        };
      } else if (action === "set-discount-coupon") {
        nextPromo = {
          ...nextPromo,
          discount_coupon: {
            code: couponCode,
            discount_percent: discountPercent,
            applied_at: now,
            applied_by: account.id,
          },
        };
      } else if (action === "clear-discount-coupon") {
        nextPromo = {
          ...nextPromo,
          discount_coupon: null,
          discount_coupon_cleared_at: now,
        };
      } else if (action === "set-free-shipping-coupon") {
        nextPromo = {
          ...nextPromo,
          free_shipping_coupon: {
            code: couponCode,
            applied_at: now,
            applied_by: account.id,
          },
        };
      } else {
        nextPromo = {
          ...nextPromo,
          free_shipping_coupon: null,
          free_shipping_coupon_cleared_at: now,
        };
      }

      if (action === "apply-sale" || action === "clear-sale") {
        if (!row.legacy_product_id) {
          results.push({
            inventoryItemId: row.id,
            title: row.title || "Untitled item",
            success: false,
            message: "The website product link is missing.",
          });
          continue;
        }
        const productUpdate = await supabase
          .from("products")
          .update({ price: nextPrice })
          .eq("store_id", storeId)
          .eq("id", row.legacy_product_id)
          .select("id")
          .maybeSingle();
        if (productUpdate.error || !productUpdate.data) {
          results.push({
            inventoryItemId: row.id,
            title: row.title || "Untitled item",
            success: false,
            message: productUpdate.error?.message || "The website product could not be repriced.",
          });
          continue;
        }
        productPriceChanged = true;
      }

      const inventoryUpdate = await supabase
        .from("inventory_items")
        .update({
          price: nextPrice,
          metadata: { ...metadata, tcos_promo: nextPromo },
          updated_at: now,
        })
        .eq("store_id", storeId)
        .eq("id", row.id)
        .select("id")
        .maybeSingle();
      if (
        productPriceChanged &&
        (inventoryUpdate.error || !inventoryUpdate.data) &&
        row.legacy_product_id
      ) {
        await supabase
          .from("products")
          .update({ price: roundedMoney(row.price) })
          .eq("store_id", storeId)
          .eq("id", row.legacy_product_id);
      }
      results.push({
        inventoryItemId: row.id,
        title: row.title || "Untitled item",
        success: !inventoryUpdate.error && Boolean(inventoryUpdate.data),
        message:
          inventoryUpdate.error?.message ||
          (inventoryUpdate.data ? "Updated." : "The inventory item was not eligible."),
      });
    }

    for (const id of ids) {
      if (!results.some((result) => result.inventoryItemId === id)) {
        results.push({
          inventoryItemId: id,
          title: "Unavailable item",
          success: false,
          message: "This item was not found in your inventory.",
        });
      }
    }

    const updatedCount = results.filter((result) => result.success).length;
    return Response.json(
      {
        success: updatedCount > 0,
        action,
        updatedCount,
        failedCount: results.length - updatedCount,
        results,
      },
      { status: updatedCount > 0 ? 200 : 409 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update the selected sale or coupon settings.",
      },
      { status: 500 },
    );
  }
}
