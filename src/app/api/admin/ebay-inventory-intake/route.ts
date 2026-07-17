import { inventoryEngine } from "../../../../modules/inventory";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type ProductRow = {
  id: number;
  sku: string | null;
  title: string | null;
  description: string | null;
  price: number | string | null;
  quantity: number | null;
  image_url: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
  created_at: string | null;
};

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  status: string | null;
  quantity: number | null;
  price: number | string | null;
  updated_at: string | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readinessProblems(product: ProductRow, inventory: InventoryRow | null) {
  const problems: string[] = [];

  if (!String(product.title || "").trim()) problems.push("missing title");
  if (moneyNumber(product.price) <= 0) problems.push("missing price");
  if (Number(product.quantity || 0) <= 0) problems.push("zero quantity");
  if (!String(product.image_url || "").trim()) problems.push("missing image");
  if (!String(product.sku || "").trim()) problems.push("missing sku");
  if (!String(product.ebay_item_id || "").trim()) problems.push("missing eBay link");
  if (!inventory) problems.push("missing V2 inventory row");

  return problems;
}

function mapIntakeRow(product: ProductRow, inventory: InventoryRow | null) {
  const problems = readinessProblems(product, inventory);
  const isReady = problems.length === 0;
  const isLive =
    isReady &&
    inventory?.status === "active" &&
    Number(product.quantity || 0) > 0 &&
    moneyNumber(product.price) > 0;

  return {
    productId: product.id,
    inventoryItemId: inventory?.id ?? null,
    sku: product.sku,
    title: product.title || "Untitled eBay listing",
    price: moneyNumber(product.price),
    quantity: Number(product.quantity || 0),
    imageUrl: product.image_url,
    ebayItemId: product.ebay_item_id,
    lastSeenAt: product.last_seen_at,
    createdAt: product.created_at,
    inventoryStatus: inventory?.status ?? "missing",
    inventoryQuantity: inventory?.quantity ?? null,
    inventoryPrice: inventory ? moneyNumber(inventory.price) : null,
    isReady,
    isLive,
    problems,
  };
}

export async function GET() {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(
      "id,sku,title,description,price,quantity,image_url,ebay_item_id,last_seen_at,created_at",
    )
    .eq("store_id", storeId)
    .not("ebay_item_id", "is", null)
    .gt("quantity", 0)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .range(0, 1999);

  if (productsError) {
    return Response.json(
      { success: false, error: productsError.message },
      { status: 500 },
    );
  }

  const productRows = (products || []) as ProductRow[];
  const productIds = productRows.map((product) => product.id);
  const { data: inventoryRows, error: inventoryError } =
    productIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("inventory_items")
          .select("id,legacy_product_id,status,quantity,price,updated_at")
          .eq("store_id", storeId)
          .in("legacy_product_id", productIds);

  if (inventoryError) {
    return Response.json(
      { success: false, error: inventoryError.message },
      { status: 500 },
    );
  }

  const inventoryByProductId = new Map<number, InventoryRow>();

  for (const row of (inventoryRows || []) as InventoryRow[]) {
    if (row.legacy_product_id) {
      inventoryByProductId.set(Number(row.legacy_product_id), row);
    }
  }

  const rows = productRows
    .map((product) => mapIntakeRow(product, inventoryByProductId.get(product.id) ?? null))
    .sort((left, right) => {
      if (left.isReady !== right.isReady) return left.isReady ? 1 : -1;
      if (left.isLive !== right.isLive) return left.isLive ? 1 : -1;
      return String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || ""));
    });

  return Response.json({
    success: true,
    rows,
    summary: {
      total: rows.length,
      ready: rows.filter((row) => row.isReady && !row.isLive).length,
      live: rows.filter((row) => row.isLive).length,
      needsHelp: rows.filter((row) => !row.isReady).length,
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      value: rows.reduce((sum, row) => sum + row.price * row.quantity, 0),
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const productIds = Array.isArray(body.productIds)
    ? body.productIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0)
        .slice(0, 1000)
    : [];

  if (action !== "push-live") {
    return Response.json(
      { success: false, error: "Unsupported intake action." },
      { status: 400 },
    );
  }

  if (productIds.length === 0) {
    return Response.json(
      { success: false, error: "Select at least one listing." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id,sku,title,price,quantity,image_url,ebay_item_id")
    .eq("store_id", storeId)
    .in("id", productIds);

  if (productsError) {
    return Response.json(
      { success: false, error: productsError.message },
      { status: 500 },
    );
  }

  const productRows = (products || []) as ProductRow[];
  const { data: inventoryRows, error: inventoryError } =
    productRows.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("inventory_items")
          .select("id,legacy_product_id,status,quantity,price,updated_at")
          .eq("store_id", storeId)
          .in("legacy_product_id", productRows.map((product) => product.id));

  if (inventoryError) {
    return Response.json(
      { success: false, error: inventoryError.message },
      { status: 500 },
    );
  }

  const inventoryByProductId = new Map<number, InventoryRow>();

  for (const row of (inventoryRows || []) as InventoryRow[]) {
    if (row.legacy_product_id) {
      inventoryByProductId.set(Number(row.legacy_product_id), row);
    }
  }

  let pushedLive = 0;
  const skipped: Array<{ productId: number; title: string; problems: string[] }> = [];

  for (const product of productRows) {
    const inventory = inventoryByProductId.get(product.id) ?? null;
    const problems = readinessProblems(product, inventory);

    if (problems.length > 0) {
      skipped.push({
        productId: product.id,
        title: product.title || "Untitled eBay listing",
        problems,
      });
      continue;
    }

    await inventoryEngine.setStatus({
      legacyProductId: product.id,
      status: "active",
    });
    pushedLive++;
  }

  return Response.json({
    success: true,
    pushedLive,
    skipped,
    message:
      skipped.length > 0
        ? `${pushedLive} pushed live. ${skipped.length} need help first.`
        : `${pushedLive} selected listing${pushedLive === 1 ? "" : "s"} pushed live.`,
  });
}
