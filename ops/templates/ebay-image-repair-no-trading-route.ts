import { timingSafeEqual } from "node:crypto";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_IDS = [
  1682,1692,1709,1723,1779,1863,1976,1983,1988,1992,
  2003,2019,2036,2052,2094,2103,2117,2183,2210,2211,
  2213,2228,2240,2241,2260,2273,2286,2291,2313,2315,
  2336,2366,2373,2386,2391,2411,2413,2419,2448,10650,
  10658,10664,10665,10666,10684,10685,10688,10689,10692,10699,
];
const MAX_IMAGES = 20;
const CONCURRENCY = 4;

type ProductRow = {
  id: number;
  title: string;
  ebay_item_id: string | null;
  sku: string | null;
  image_url: string | null;
};
type InventoryRow = {
  id: string;
  legacy_product_id: number;
  title: string;
  sku: string | null;
  metadata: Record<string, unknown> | null;
};
type ImageRow = {
  id: string;
  inventory_item_id: string;
  image_url: string;
  sort_order: number;
  is_primary: boolean;
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function highResolution(value: unknown) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned.replace(
    /\/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i,
    "/s-l1600.$1$2",
  );
}

function imageIdentity(value: unknown) {
  const normalized = highResolution(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() === "i.ebayimg.com") {
      const modern = /^\/images\/g\/([^/]+)\//i.exec(url.pathname)?.[1];
      const legacy = /\/z\/([^/]+)\/\$_\d+\.(?:jpe?g|png|webp)$/i.exec(
        url.pathname,
      )?.[1];
      const key = modern || legacy;
      if (key) return `ebay:${key}`;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return normalized;
  }
}

function normalize(values: unknown[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = highResolution(value);
    const identity = imageIdentity(url);
    if (!url || !identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(url);
    if (result.length >= MAX_IMAGES) break;
  }
  return result;
}

function decodeHtml(value: string) {
  return value
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function trustedImage(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "i.ebayimg.com" ||
      host === "storage.googleapis.com" ||
      host.endsWith(".googleusercontent.com") ||
      host.endsWith(".cloudfront.net");
    const imagePath =
      host === "i.ebayimg.com" ||
      /\.(?:jpe?g|png|webp)$/i.test(url.pathname);
    return allowed && imagePath ? raw : "";
  } catch {
    return "";
  }
}

function collectImageValues(value: unknown, target: string[]) {
  if (typeof value === "string") {
    const image = trustedImage(value);
    if (image) target.push(image);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectImageValues(entry, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (["image", "images", "imageUrl", "imageUrls", "additionalImages"].includes(key)) {
      collectImageValues(entry, target);
    }
  }
}

async function verifyImage(url: string) {
  const request = async (method: "HEAD" | "GET") =>
    fetch(url, {
      method,
      redirect: "follow",
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  try {
    let response = await request("HEAD");
    if (response.status === 405 || response.status === 501) {
      response = await request("GET");
    }
    const contentType = response.headers.get("content-type") || "";
    return (
      (response.status === 200 || response.status === 206) &&
      contentType.toLowerCase().startsWith("image/")
    );
  } catch {
    return false;
  }
}

async function runWorkers<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}

async function refreshAccessToken(
  supabase: ReturnType<typeof createSupabaseServerClient>,
) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing eBay credentials.");
  const { data, error } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", STORE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) throw new Error("No eBay refresh token is available.");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(data.refresh_token),
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
      ].join(" "),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "eBay token refresh failed.",
    );
  }
  return String(payload.access_token);
}

function metadataSku(metadata: Record<string, unknown> | null) {
  if (!metadata) return [];
  return [metadata.ebay_sku, metadata.sku, metadata.inventory_sku]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

async function getInventoryImages(accessToken: string, skus: string[]) {
  const images: string[] = [];
  const attempts: Array<{ sku: string; status: number }> = [];
  for (const sku of Array.from(new Set(skus.filter(Boolean)))) {
    try {
      const response = await fetch(
        `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Language": "en-US",
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
      attempts.push({ sku, status: response.status });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => ({}));
      const urls = Array.isArray(payload?.product?.imageUrls)
        ? payload.product.imageUrls
        : [];
      images.push(...urls);
    } catch {
      attempts.push({ sku, status: 0 });
    }
  }
  return { images: normalize(images), attempts };
}

async function getPublicListingImages(itemId: string) {
  const images: string[] = [];
  const statuses: Array<{ source: string; status: number }> = [];
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  };

  try {
    const response = await fetch(
      `https://www.ebay.com/itm/${encodeURIComponent(itemId)}`,
      { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) },
    );
    statuses.push({ source: "item_page", status: response.status });
    const html = decodeHtml(await response.text());
    for (const match of html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        const payload = JSON.parse(match[1].trim());
        const candidates = Array.isArray(payload) ? payload : [payload];
        for (const candidate of candidates) {
          const type = candidate?.["@type"];
          const isProduct =
            type === "Product" ||
            (Array.isArray(type) && type.includes("Product"));
          if (isProduct) collectImageValues(candidate, images);
        }
      } catch {
        // Ignore malformed structured data.
      }
    }
    for (const match of html.matchAll(
      /"(?:imageUrl|zoomUrl|originalImageUrl|largeImageUrl)"\s*:\s*"(https:\/\/i\.ebayimg\.com\/images\/g\/[^"\\]+)"/gi,
    )) {
      const image = trustedImage(match[1]);
      if (image) images.push(image);
    }
  } catch {
    statuses.push({ source: "item_page", status: 0 });
  }

  try {
    const response = await fetch(
      `https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=${encodeURIComponent(itemId)}`,
      { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) },
    );
    statuses.push({ source: "description_page", status: response.status });
    const html = decodeHtml(await response.text());
    for (const match of html.matchAll(
      /(?:src|data-src|href)\s*=\s*["']([^"']+)["']/gi,
    )) {
      const image = trustedImage(match[1]);
      if (image) images.push(image);
    }
  } catch {
    statuses.push({ source: "description_page", status: 0 });
  }

  return { images: normalize(images), statuses };
}

async function reconcileImages(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  inventory: InventoryRow,
  existing: ImageRow[],
  remote: string[],
) {
  const current = normalize(
    existing
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((row) => row.image_url),
  );
  const finalImages = normalize([...remote, ...current]);
  const changed =
    current.length !== finalImages.length ||
    current.some(
      (url, index) => imageIdentity(url) !== imageIdentity(finalImages[index]),
    );
  if (!changed || !finalImages.length) return { finalImages, changed: false };

  const { error: deleteError } = await supabase
    .from("inventory_images")
    .delete()
    .eq("inventory_item_id", inventory.id);
  if (deleteError) throw deleteError;
  const { error: insertError } = await supabase.from("inventory_images").insert(
    finalImages.map((imageUrl, index) => ({
      inventory_item_id: inventory.id,
      image_url: imageUrl,
      alt_text: `${inventory.title} ${index === 0 ? "front" : index === 1 ? "back" : `detail ${index + 1}`}`,
      sort_order: index,
      is_primary: index === 0,
    })),
  );
  if (insertError) throw insertError;
  return { finalImages, changed: true };
}

export async function POST(request: Request) {
  const expected = process.env.EBAY_NO_TRADING_IMAGE_REPAIR_TOKEN_V2_20260730 || "";
  const supplied = request.headers.get("x-tcos-repair-token") || "";
  if (!expected || !safeEqual(expected, supplied)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const supabase = createSupabaseServerClient({ admin: true });
  const accessToken = await refreshAccessToken(supabase);

  const { data: productData, error: productError } = await supabase
    .from("products")
    .select("id,title,ebay_item_id,sku,image_url")
    .eq("store_id", STORE_ID)
    .in("id", TARGET_IDS)
    .order("id", { ascending: true });
  if (productError) throw productError;
  const products = (productData || []) as ProductRow[];

  const { data: inventoryData, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id,title,sku,metadata")
    .eq("store_id", STORE_ID)
    .in("legacy_product_id", TARGET_IDS)
    .order("legacy_product_id", { ascending: true });
  if (inventoryError) throw inventoryError;
  const inventories = (inventoryData || []) as InventoryRow[];

  const imageRows: ImageRow[] = [];
  const inventoryIds = inventories.map((row) => row.id);
  for (let index = 0; index < inventoryIds.length; index += 20) {
    const { data, error } = await supabase
      .from("inventory_images")
      .select("id,inventory_item_id,image_url,sort_order,is_primary")
      .in("inventory_item_id", inventoryIds.slice(index, index + 20))
      .order("inventory_item_id", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) throw error;
    imageRows.push(...((data || []) as ImageRow[]));
  }

  const inventoriesByProduct = new Map<number, InventoryRow[]>();
  for (const row of inventories) {
    const rows = inventoriesByProduct.get(Number(row.legacy_product_id)) || [];
    rows.push(row);
    inventoriesByProduct.set(Number(row.legacy_product_id), rows);
  }
  const imagesByInventory = new Map<string, ImageRow[]>();
  for (const row of imageRows) {
    const rows = imagesByInventory.get(row.inventory_item_id) || [];
    rows.push(row);
    imagesByInventory.set(row.inventory_item_id, rows);
  }

  const results: Array<Record<string, unknown>> = [];
  await runWorkers(products, async (product) => {
    const linked = inventoriesByProduct.get(Number(product.id)) || [];
    const skus = [
      product.sku,
      ...linked.map((row) => row.sku),
      ...linked.flatMap((row) => metadataSku(row.metadata)),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    try {
      const inventoryApi = await getInventoryImages(accessToken, skus);
      const publicListing = product.ebay_item_id
        ? await getPublicListingImages(String(product.ebay_item_id))
        : { images: [], statuses: [] };
      const candidates = normalize([
        ...inventoryApi.images,
        ...publicListing.images,
      ]);
      const verified: string[] = [];
      for (const image of candidates) {
        if (await verifyImage(image)) verified.push(image);
      }

      const finalSets: string[][] = [];
      let changedInventoryRows = 0;
      for (const inventory of linked) {
        const reconciliation = await reconcileImages(
          supabase,
          inventory,
          imagesByInventory.get(inventory.id) || [],
          verified,
        );
        finalSets.push(reconciliation.finalImages);
        if (reconciliation.changed) changedInventoryRows += 1;
      }
      const combined = normalize([...verified, ...finalSets.flat()]);
      if (combined[0]) {
        const { error } = await supabase
          .from("products")
          .update({ image_url: combined[0] })
          .eq("store_id", STORE_ID)
          .eq("id", product.id);
        if (error) throw error;
      }
      results.push({
        productId: product.id,
        title: product.title,
        ebayItemId: product.ebay_item_id,
        linkedInventoryRows: linked.length,
        skuCandidates: skus,
        inventoryApiAttempts: inventoryApi.attempts,
        inventoryApiImages: inventoryApi.images,
        publicListingStatuses: publicListing.statuses,
        publicListingImages: publicListing.images,
        verifiedImages: verified,
        finalImages: combined,
        finalImageCount: combined.length,
        changedInventoryRows,
        hasBack: combined.length >= 2,
      });
    } catch (error) {
      results.push({
        productId: product.id,
        title: product.title,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        hasBack: false,
      });
    }
  });

  results.sort((a, b) => Number(a.productId) - Number(b.productId));
  const stillMissing = results
    .filter((row) => row.hasBack !== true)
    .map((row) => ({
      productId: row.productId,
      title: row.title,
      error: row.error || null,
    }));
  return Response.json(
    {
      success: true,
      event: "ebay_no_trading_image_repair_v2_completed",
      startedAt,
      completedAt: new Date().toISOString(),
      requestedProducts: TARGET_IDS.length,
      foundProducts: products.length,
      productsWithFrontBack: results.filter((row) => row.hasBack === true).length,
      stillMissingCount: stillMissing.length,
      stillMissing,
      results,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
