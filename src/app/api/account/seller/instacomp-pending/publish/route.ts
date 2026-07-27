import {
  ensureAccountStoreMembership,
  getAuthenticatedSellerAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getInventoryActivationBlockers } from "../../../../../../lib/inventory-activation";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { inventoryEngine } from "../../../../../../modules/inventory";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestedIds(body: any) {
  const values = Array.isArray(body?.itemIds)
    ? body.itemIds
    : body?.inventoryItemId
      ? [body.inventoryItemId]
      : [];
  return Array.from(
    new Set(values.map((value: unknown) => String(value || "").trim()).filter(Boolean)),
  ).slice(0, 500);
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedSellerAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const itemIds = requestedIds(body);
    if (!itemIds.length) {
      return Response.json(
        { error: "Choose one or more InstaComp pending listings." },
        { status: 400 },
      );
    }
    if (body?.confirmIdentity !== true) {
      return Response.json(
        {
          error:
            "Confirm that you reviewed the card identity, images, condition, variation, serial, grade, cert, quantity, and price before publishing.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let inventoryQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,category,status,quantity,price,metadata",
      )
      .eq("store_id", storeId)
      .in("id", itemIds);
    inventoryQuery = isStoreOwnerAccount
      ? inventoryQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : inventoryQuery.eq("seller_account_id", account.id);

    const { data: rows, error: rowsError } = await inventoryQuery;
    if (rowsError) throw rowsError;

    const productIds = (rows || [])
      .map((row: any) => row.legacy_product_id)
      .filter((value: unknown): value is number => typeof value === "number");
    const { data: products, error: productError } =
      productIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,image_url")
            .eq("store_id", storeId)
            .in("id", productIds);
    if (productError) throw productError;
    const productMap = new Map((products || []).map((row: any) => [row.id, row]));

    const { data: payoutAccount, error: payoutError } = await supabase
      .from("seller_payout_accounts")
      .select("onboarding_status,payouts_enabled,details_submitted")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "stripe_connect")
      .maybeSingle();
    if (payoutError) throw payoutError;
    const payoutReady =
      payoutAccount?.onboarding_status === "active" &&
      payoutAccount?.payouts_enabled === true &&
      payoutAccount?.details_submitted === true;

    const results: Array<Record<string, unknown>> = [];
    const returnedIds = new Set((rows || []).map((row: any) => row.id));
    for (const missingId of itemIds.filter((id) => !returnedIds.has(id))) {
      results.push({ inventoryItemId: missingId, success: false, error: "Not found or not owned by this seller." });
    }

    for (const row of rows || []) {
      try {
        if (row.status !== "draft") {
          throw new Error("Only private draft listings can be published here.");
        }
        if (!row.legacy_product_id) {
          throw new Error("This draft is missing its linked product record.");
        }

        const metadata = recordValue(row.metadata);
        const instaComp = recordValue(metadata.instacomp);
        if (!instaComp.source && !instaComp.scanId) {
          throw new Error("This draft is not an InstaComp pending listing.");
        }

        const product = productMap.get(row.legacy_product_id);
        if (!product) throw new Error("The linked product record was not found.");

        const blockers = getInventoryActivationBlockers({
          sku: row.sku || null,
          price: Number(row.price || 0),
          quantity: Number(row.quantity || 0),
          imageUrl: product.image_url || null,
          title: row.title || null,
          category: row.category || null,
          metadata,
        });
        if (blockers.length) {
          throw new Error(`Listing blockers: ${blockers.join(", ")}.`);
        }

        const storeOwned = row.seller_account_id === null;
        if (!storeOwned && !payoutReady) {
          throw new Error(
            "Seller payout verification must be active before this listing can go live.",
          );
        }
        if (storeOwned && !isStoreOwnerAccount) {
          throw new Error("Only the store owner account can publish store-owned inventory.");
        }

        const now = new Date().toISOString();
        const nextMetadata = {
          ...metadata,
          seller_review: {
            identity_confirmed: true,
            confirmed_at: now,
            confirmed_by: account.email,
            confirmed_account_id: account.id,
            confirmation_scope:
              "images_identity_condition_variation_serial_grade_cert_quantity_price",
          },
        };

        const { error: metadataError } = await supabase
          .from("inventory_items")
          .update({ metadata: nextMetadata, updated_at: now })
          .eq("id", row.id)
          .eq("store_id", storeId);
        if (metadataError) throw metadataError;

        const updatedItem = await inventoryEngine.setStatus({
          legacyProductId: row.legacy_product_id,
          status: "active",
        });

        results.push({
          inventoryItemId: row.id,
          legacyProductId: row.legacy_product_id,
          success: true,
          status: "active",
          item: updatedItem,
        });
      } catch (error: any) {
        results.push({
          inventoryItemId: row.id,
          success: false,
          error: error?.message || "Could not publish this listing.",
        });
      }
    }

    return Response.json({
      success: results.every((result) => result.success === true),
      published: results.filter((result) => result.success === true).length,
      failed: results.filter((result) => result.success !== true).length,
      results,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not publish InstaComp pending listings." },
      { status: 500 },
    );
  }
}
