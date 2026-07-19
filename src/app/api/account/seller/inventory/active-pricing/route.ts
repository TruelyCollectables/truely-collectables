import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  classifyCollectibleCategory,
  tradingCardCategoryMetadata,
} from "../../../../../../lib/collectible-category-policy";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  sku: string | null;
  title: string | null;
  category: string | null;
  condition: string | null;
  status: string | null;
  quantity: number | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
  created_at: string | null;
};

type ProductRow = {
  id: number;
  title: string | null;
  image_url: string | null;
  ebay_item_id: string | null;
  player: string | null;
  sport: string | null;
};

type InventoryImageRow = {
  inventory_item_id: string;
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 0), maximum);
}

function cleanSearch(value: string | null) {
  return String(value || "")
    .trim()
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function currentTracking(metadata: Record<string, unknown> | null) {
  const root = recordValue(recordValue(metadata).instacomp_tracking);
  const current = recordValue(root.current);
  return Object.keys(current).length > 0 ? current : null;
}

function uniqueImages(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const limit = positiveInteger(searchParams.get("limit"), 48, 60) || 48;
    const offset = positiveInteger(searchParams.get("offset"), 0, 100000);
    const search = cleanSearch(searchParams.get("search"));
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

    let query = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,category,condition,status,quantity,price,metadata,updated_at,created_at",
        { count: "exact" },
      )
      .eq("store_id", storeId)
      .eq("status", "active")
      .gt("quantity", 0)
      .order("updated_at", { ascending: false, nullsFirst: false });

    query = owner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    const { data: inventoryData, error: inventoryError, count } = await query.range(
      offset,
      offset + limit - 1,
    );
    if (inventoryError) throw inventoryError;

    const inventoryRows = (inventoryData || []) as InventoryRow[];
    const inventoryIds = inventoryRows.map((row) => row.id);
    const productIds = Array.from(
      new Set(
        inventoryRows
          .map((row) => row.legacy_product_id)
          .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
      ),
    );

    const [productResult, imageResult] = await Promise.all([
      productIds.length
        ? supabase
            .from("products")
            .select("id,title,image_url,ebay_item_id,player,sport")
            .eq("store_id", storeId)
            .in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
      inventoryIds.length
        ? supabase
            .from("inventory_images")
            .select("inventory_item_id,image_url,sort_order,is_primary")
            .in("inventory_item_id", inventoryIds)
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (productResult.error) throw productResult.error;
    if (imageResult.error) throw imageResult.error;

    const products = (productResult.data || []) as ProductRow[];
    const images = (imageResult.data || []) as InventoryImageRow[];
    const productById = new Map(products.map((row) => [row.id, row]));
    const imagesByInventoryId = new Map<string, InventoryImageRow[]>();

    for (const image of images) {
      imagesByInventoryId.set(image.inventory_item_id, [
        ...(imagesByInventoryId.get(image.inventory_item_id) || []),
        image,
      ]);
    }

    const repairJobs: Promise<unknown>[] = [];
    const items = inventoryRows.map((row) => {
      const product = row.legacy_product_id
        ? productById.get(row.legacy_product_id)
        : null;
      const inventoryImages = (imagesByInventoryId.get(row.id) || []).sort(
        (left, right) =>
          Number(right.is_primary || false) - Number(left.is_primary || false) ||
          Number(left.sort_order || 0) - Number(right.sort_order || 0),
      );
      const metadata = recordValue(row.metadata);
      const title = row.title || product?.title || "Untitled inventory item";
      const decision = classifyCollectibleCategory({
        title,
        category: row.category,
        sport: product?.sport,
        metadata,
      });
      const category = decision.isTradingCard ? decision.category : row.category || decision.category;

      if (decision.isTradingCard && category !== row.category) {
        repairJobs.push(
          Promise.resolve(
            supabase
              .from("inventory_items")
              .update({
                category,
                metadata: tradingCardCategoryMetadata({
                  metadata,
                  previousCategory: row.category,
                  decision,
                }),
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id)
              .eq("store_id", storeId),
          ),
        );
      }

      const imageUrls = uniqueImages([
        ...inventoryImages.map((image) => image.image_url),
        product?.image_url,
        ...stringList(metadata.ebay_image_urls),
        ...stringList(metadata.image_urls),
        ...stringList(metadata.source_image_urls),
      ]);

      return {
        inventoryItemId: row.id,
        legacyProductId: row.legacy_product_id,
        ownershipScope: row.seller_account_id === account.id ? "seller" : "store",
        title,
        sku: row.sku,
        category,
        condition: row.condition || "unknown",
        status: "active",
        quantity: Number(row.quantity || 0),
        price: moneyNumber(row.price),
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        ebayItemId: product?.ebay_item_id || null,
        player: product?.player || null,
        sport: product?.sport || null,
        imageUrl: imageUrls[0] || null,
        imageUrls,
        isCard: decision.isTradingCard,
        tracking: currentTracking(row.metadata),
      };
    });

    if (repairJobs.length) {
      await Promise.allSettled(repairJobs);
    }

    return Response.json({
      success: true,
      scope: "active_inventory_only",
      soldInventoryVisible: false,
      soldInventoryRetainedForCompEvidence: true,
      total: count ?? items.length,
      offset,
      limit,
      hasMore: offset + items.length < (count ?? items.length),
      items,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load active seller inventory." },
      { status: 500 },
    );
  }
}
