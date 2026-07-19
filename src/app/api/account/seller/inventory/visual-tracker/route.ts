import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
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

type OrderItemRow = {
  order_id: number;
  product_id: number | null;
  price: number | string | null;
  quantity: number | null;
};

type OrderRow = {
  id: number;
  status: string | null;
  fulfillment_status: string | null;
  created_at: string | null;
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

function quickListSummary(metadata: Record<string, unknown> | null) {
  const root = recordValue(metadata);
  const instaComp = recordValue(root.instacomp);
  const quickList = recordValue(root.quick_list);

  return {
    createdWithInstaComp:
      Boolean(instaComp.source || instaComp.scanId) ||
      root.source === "seller_ai_quick_list" ||
      quickList.schema === "truely.sellerQuickListDraft.v1",
    originalScanId:
      typeof instaComp.scanId === "string"
        ? instaComp.scanId
        : typeof quickList.scan_id === "string"
          ? quickList.scan_id
          : null,
  };
}

function isCardItem(category: string, title: string) {
  const value = `${category} ${title}`.toLowerCase();
  return (
    value.includes("sports_card") ||
    value.includes("trading_card") ||
    value.includes(" card") ||
    value.startsWith("card")
  );
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
    const status = String(searchParams.get("status") || "all").toLowerCase();
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
      .order("updated_at", { ascending: false, nullsFirst: false });

    query = owner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    if (["draft", "active", "archived", "sold", "reserved"].includes(status)) {
      query = query.eq("status", status);
    }

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

    const [productResult, imageResult, orderItemResult] = await Promise.all([
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
      productIds.length
        ? supabase
            .from("order_items")
            .select("order_id,product_id,price,quantity")
            .in("product_id", productIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (productResult.error) throw productResult.error;
    if (imageResult.error) throw imageResult.error;

    const products = (productResult.data || []) as ProductRow[];
    const images = (imageResult.data || []) as InventoryImageRow[];
    const orderItems = orderItemResult.error
      ? []
      : ((orderItemResult.data || []) as OrderItemRow[]);
    const orderIds = Array.from(new Set(orderItems.map((row) => row.order_id)));
    const orderResult = orderIds.length
      ? await supabase
          .from("orders")
          .select("id,status,fulfillment_status,created_at")
          .in("id", orderIds)
      : { data: [], error: null };
    const orders = orderResult.error ? [] : ((orderResult.data || []) as OrderRow[]);

    const productById = new Map(products.map((row) => [row.id, row]));
    const imagesByInventoryId = new Map<string, InventoryImageRow[]>();
    for (const image of images) {
      imagesByInventoryId.set(image.inventory_item_id, [
        ...(imagesByInventoryId.get(image.inventory_item_id) || []),
        image,
      ]);
    }
    const orderById = new Map(orders.map((row) => [row.id, row]));
    const orderItemsByProductId = new Map<number, OrderItemRow[]>();
    for (const row of orderItems) {
      if (!row.product_id) continue;
      orderItemsByProductId.set(row.product_id, [
        ...(orderItemsByProductId.get(row.product_id) || []),
        row,
      ]);
    }

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
      const imageUrls = uniqueImages([
        ...inventoryImages.map((image) => image.image_url),
        product?.image_url,
        ...stringList(metadata.ebay_image_urls),
        ...stringList(metadata.image_urls),
        ...stringList(metadata.source_image_urls),
      ]);
      const linkedOrderItems = row.legacy_product_id
        ? orderItemsByProductId.get(row.legacy_product_id) || []
        : [];
      const validSales = linkedOrderItems.filter((orderItem) => {
        const order = orderById.get(orderItem.order_id);
        const orderStatus = String(order?.status || "").toLowerCase();
        return !["cancelled", "canceled", "refunded", "failed", "void"].includes(
          orderStatus,
        );
      });
      const unitsSold = validSales.reduce(
        (total, sale) => total + Math.max(1, Number(sale.quantity || 1)),
        0,
      );
      const revenue = validSales.reduce(
        (total, sale) =>
          total + moneyNumber(sale.price) * Math.max(1, Number(sale.quantity || 1)),
        0,
      );
      const lastSoldAt = validSales
        .map((sale) => orderById.get(sale.order_id)?.created_at || null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null;
      const title = row.title || product?.title || "Untitled inventory item";
      const category = row.category || "other_collectable";

      return {
        inventoryItemId: row.id,
        legacyProductId: row.legacy_product_id,
        ownershipScope: row.seller_account_id === account.id ? "seller" : "store",
        title,
        sku: row.sku,
        category,
        condition: row.condition || "unknown",
        status: row.status || "draft",
        quantity: Number(row.quantity || 0),
        price: moneyNumber(row.price),
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        ebayItemId: product?.ebay_item_id || null,
        player: product?.player || null,
        sport: product?.sport || null,
        imageUrl: imageUrls[0] || null,
        imageUrls,
        isCard: isCardItem(category, title),
        tracking: currentTracking(row.metadata),
        quickList: quickListSummary(row.metadata),
        ownSales: {
          unitsSold,
          revenue: Math.round(revenue * 100) / 100,
          lastSoldAt,
        },
      };
    });

    return Response.json({
      success: true,
      total: count ?? items.length,
      offset,
      limit,
      hasMore: offset + items.length < (count ?? items.length),
      items,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load the visual seller inventory." },
      { status: 500 },
    );
  }
}
