import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positivePrice(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    const mode = body?.mode === "manual" ? "manual" : "suggested";
    if (!inventoryItemId) {
      return Response.json(
        { error: "Choose an InstaComp pending listing." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let itemQuery = supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,status,price,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    itemQuery = isStoreOwnerAccount
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);

    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return Response.json(
        { error: "The InstaComp pending listing was not found." },
        { status: 404 },
      );
    }
    if (item.status !== "draft") {
      return Response.json(
        { error: "Only private draft listings can be priced here." },
        { status: 409 },
      );
    }

    const metadata = recordValue(item.metadata);
    const instaComp = recordValue(metadata.instacomp);
    if (!instaComp.source && !instaComp.scanId) {
      return Response.json(
        { error: "This draft is not an InstaComp listing." },
        { status: 409 },
      );
    }

    let nextPrice: number | null = null;
    let priceSource = "seller_manual";

    if (mode === "manual") {
      nextPrice = positivePrice(body?.price);
      if (!nextPrice) {
        return Response.json(
          { error: "Enter a seller price greater than $0.00." },
          { status: 400 },
        );
      }
    } else {
      const suggestedPrice = positivePrice(
        instaComp.suggestedPrice ?? instaComp.marketPrice,
      );
      const trusted =
        instaComp.pricingStatus === "suggested_from_reliable_sold_comps" &&
        instaComp.trustedForPricing === true &&
        Number(instaComp.reliableSoldCompCount || 0) > 0;
      if (!suggestedPrice || !trusted) {
        return Response.json(
          {
            error:
              "No reliable InstaComp market suggestion is available. Enter the seller price manually.",
          },
          { status: 409 },
        );
      }
      nextPrice = suggestedPrice;
      priceSource = "instacomp_market_sweet_spot";
    }

    const now = new Date().toISOString();
    const collectibleAsset = recordValue(metadata.collectible_asset);
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        listingPrice: nextPrice,
        listingPriceSource: priceSource,
        listingPriceSetAt: now,
      },
      collectible_asset: {
        ...collectibleAsset,
        price_pending: false,
      },
    };

    const updates = await Promise.all([
      supabase
        .from("inventory_items")
        .update({ price: nextPrice, metadata: nextMetadata, updated_at: now })
        .eq("id", item.id)
        .eq("store_id", storeId),
      item.legacy_product_id
        ? supabase
            .from("products")
            .update({ price: nextPrice, updated_at: now })
            .eq("id", item.legacy_product_id)
            .eq("store_id", storeId)
        : Promise.resolve({ error: null }),
    ]);

    if (updates[0].error) throw updates[0].error;
    if (updates[1].error) throw updates[1].error;

    return Response.json({
      success: true,
      inventoryItemId: item.id,
      price: nextPrice,
      priceSource,
      status: "draft",
      published: false,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not set the InstaComp listing price." },
      { status: 500 },
    );
  }
}
