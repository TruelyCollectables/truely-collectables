import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoreSettings } from "./store-settings";

const TRADING_API_VERSION = "1409";
const ENRICH_CONCURRENCY = 6;
const SHIPPING_POLICY_VERSION = "truely-shipping-v1-2026-07";

export type EbayLaunchReadinessIssue = {
  productId: number;
  ebayItemId: string | null;
  sku: string | null;
  title: string;
  reasons: string[];
};

export type EbayLaunchReadyResult = {
  storeId: string;
  startedAt: string;
  completedAt: string;
  scanned: number;
  enriched: number;
  failedEnrichment: number;
  ready: number;
  notReady: number;
  issues: EbayLaunchReadinessIssue[];
  enrichmentErrors: Array<{
    productId: number;
    ebayItemId: string;
    title: string;
    error: string;
  }>;
  shippingPolicyVersion: string;
};

type ProductRow = {
  id: number;
  sku: string | null;
  title: string;
  description: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
  ebay_item_id: string | null;
};

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  sku: string | null;
  title: string;
  description: string | null;
  price: number;
  quantity: number;
  status: string;
  metadata: Record<string, unknown> | null;
};

function tradingEndpoint(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
}

function tokenEndpoint(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";
}

function decodeXml(value: string) {
  return value
    .trim()
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlBlock(xml: string, tag: string) {
  return (
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(
      xml,
    )?.[1] || null
  );
}

function xmlText(xml: string, tag: string) {
  const block = xmlBlock(xml, tag);
  return block === null ? null : decodeXml(block);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function booleanText(value: string | null) {
  return ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}

function singleItemShippingMethod(price: number) {
  return price <= 20 ? "STANDARD_ENVELOPE" : "GROUND_ADVANTAGE";
}

async function getTradingAccessToken(params: {
  supabase: SupabaseClient;
  storeId: string;
  environment: string;
}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials.");
  }

  const { data, error } = await params.supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) {
    throw new Error("No store eBay refresh token is available.");
  }

  const response = await fetch(tokenEndpoint(params.environment), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
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

async function getItemDetails(params: {
  environment: string;
  accessToken: string;
  itemId: string;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${params.itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`,
    signal: AbortSignal.timeout(30_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        `eBay GetItem failed with ${response.status}.`,
    );
  }

  const item = xmlBlock(xml, "Item") || "";
  const bestOfferDetails = xmlBlock(item, "BestOfferDetails") || "";
  const listingDetails = xmlBlock(item, "ListingDetails") || "";
  const sellingStatus = xmlBlock(item, "SellingStatus") || "";
  return {
    description: xmlText(item, "Description")?.trim() || null,
    bestOfferEnabled: booleanText(xmlText(bestOfferDetails, "BestOfferEnabled")),
    bestOfferCount: Number(xmlText(bestOfferDetails, "BestOfferCount") || 0),
    autoAcceptPrice: money(
      xmlText(listingDetails, "BestOfferAutoAcceptPrice") ||
        xmlText(item, "BestOfferAutoAcceptPrice"),
    ),
    minimumBestOfferPrice: money(
      xmlText(listingDetails, "MinimumBestOfferPrice") ||
        xmlText(item, "MinimumBestOfferPrice"),
    ),
    currentPrice: money(xmlText(sellingStatus, "CurrentPrice")),
  };
}

async function runWorkers<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(ENRICH_CONCURRENCY, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}

export async function enrichAndAuditEbayLaunchCatalog(params: {
  supabase: SupabaseClient;
  storeId: string;
}): Promise<EbayLaunchReadyResult> {
  const startedAt = new Date().toISOString();
  const settings = await getStoreSettings(params.supabase, params.storeId);
  const accessToken = await getTradingAccessToken({
    supabase: params.supabase,
    storeId: params.storeId,
    environment: settings.ebayEnvironment,
  });

  const { data: products, error: productsError } = await params.supabase
    .from("products")
    .select("id,sku,title,description,price,quantity,image_url,ebay_item_id")
    .eq("store_id", params.storeId)
    .not("ebay_item_id", "is", null)
    .gt("quantity", 0)
    .gt("price", 0)
    .order("id");
  if (productsError) throw productsError;
  const activeProducts = (products || []) as ProductRow[];

  const { data: inventoryRows, error: inventoryError } = await params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,sku,title,description,price,quantity,status,metadata")
    .eq("store_id", params.storeId)
    .in("legacy_product_id", activeProducts.map((product) => product.id));
  if (inventoryError) throw inventoryError;
  const inventoryByProduct = new Map(
    ((inventoryRows || []) as InventoryRow[]).map((row) => [
      Number(row.legacy_product_id),
      row,
    ]),
  );

  let enriched = 0;
  const enrichmentErrors: EbayLaunchReadyResult["enrichmentErrors"] = [];

  await runWorkers(activeProducts, async (product) => {
    const itemId = String(product.ebay_item_id || "").trim();
    if (!itemId) return;
    try {
      const details = await getItemDetails({
        environment: settings.ebayEnvironment,
        accessToken,
        itemId,
      });
      const inventory = inventoryByProduct.get(product.id);
      const description = details.description || product.description || null;
      const effectivePrice = details.currentPrice || Number(product.price);
      const metadata = {
        ...recordValue(inventory?.metadata),
        source_marketplace: "ebay",
        ebay_listing_id: itemId,
        ebay_best_offer_enabled: details.bestOfferEnabled,
        ebay_best_offer_count: details.bestOfferCount,
        ebay_best_offer_auto_accept_price: details.autoAcceptPrice,
        ebay_best_offer_minimum_price: details.minimumBestOfferPrice,
        website_best_offer_enabled: true,
        website_offer_policy: "truely_best_offer_v1",
        website_shipping_policy_version: SHIPPING_POLICY_VERSION,
        website_single_item_minimum_shipping_method:
          singleItemShippingMethod(effectivePrice),
        website_shipping_uses_listing_price_basis: true,
        ebay_launch_enriched_at: new Date().toISOString(),
      };

      const { error: productUpdateError } = await params.supabase
        .from("products")
        .update({
          description: description || "",
          price: effectivePrice,
          last_seen_at: new Date().toISOString(),
        })
        .eq("store_id", params.storeId)
        .eq("id", product.id);
      if (productUpdateError) throw productUpdateError;

      if (inventory) {
        const { error: inventoryUpdateError } = await params.supabase
          .from("inventory_items")
          .update({
            description,
            price: effectivePrice,
            metadata,
            updated_at: new Date().toISOString(),
          })
          .eq("store_id", params.storeId)
          .eq("id", inventory.id);
        if (inventoryUpdateError) throw inventoryUpdateError;
        inventory.description = description;
        inventory.price = effectivePrice;
        inventory.metadata = metadata;
      }
      product.description = description;
      product.price = effectivePrice;
      enriched += 1;
    } catch (error) {
      enrichmentErrors.push({
        productId: product.id,
        ebayItemId: itemId,
        title: product.title,
        error: error instanceof Error ? error.message : "Unknown enrichment error",
      });
    }
  });

  const productIds = activeProducts.map((product) => product.id);
  const { data: imageRows, error: imageError } = await params.supabase
    .from("inventory_images")
    .select("inventory_item_id,image_url,is_primary")
    .in(
      "inventory_item_id",
      Array.from(inventoryByProduct.values()).map((row) => row.id),
    );
  if (imageError) throw imageError;
  const imageCounts = new Map<string, number>();
  const primaryCounts = new Map<string, number>();
  for (const image of imageRows || []) {
    const id = String(image.inventory_item_id);
    imageCounts.set(id, (imageCounts.get(id) || 0) + 1);
    if (image.is_primary) {
      primaryCounts.set(id, (primaryCounts.get(id) || 0) + 1);
    }
  }

  const issues: EbayLaunchReadinessIssue[] = [];
  for (const product of activeProducts) {
    const reasons: string[] = [];
    const inventory = inventoryByProduct.get(product.id);
    const metadata = recordValue(inventory?.metadata);
    if (!product.title.trim()) reasons.push("missing_title");
    if (!product.description?.trim()) reasons.push("missing_description");
    if (!(Number(product.price) > 0)) reasons.push("invalid_price");
    if (!(Number(product.quantity) > 0)) reasons.push("invalid_quantity");
    if (!product.image_url) reasons.push("missing_primary_product_image");
    if (!inventory) reasons.push("missing_inventory_row");
    if (inventory && inventory.status !== "active") reasons.push("inventory_not_active");
    if (inventory && (imageCounts.get(inventory.id) || 0) < 1) {
      reasons.push("missing_inventory_images");
    }
    if (inventory && (primaryCounts.get(inventory.id) || 0) !== 1) {
      reasons.push("invalid_primary_image_count");
    }
    if (metadata.website_best_offer_enabled !== true) {
      reasons.push("website_best_offer_not_enabled");
    }
    if (metadata.website_shipping_policy_version !== SHIPPING_POLICY_VERSION) {
      reasons.push("website_shipping_policy_not_stamped");
    }
    if (
      !["STANDARD_ENVELOPE", "GROUND_ADVANTAGE"].includes(
        String(metadata.website_single_item_minimum_shipping_method || ""),
      )
    ) {
      reasons.push("invalid_single_item_shipping_method");
    }
    if (reasons.length) {
      issues.push({
        productId: product.id,
        ebayItemId: product.ebay_item_id,
        sku: product.sku,
        title: product.title,
        reasons,
      });
    }
  }

  return {
    storeId: params.storeId,
    startedAt,
    completedAt: new Date().toISOString(),
    scanned: productIds.length,
    enriched,
    failedEnrichment: enrichmentErrors.length,
    ready: activeProducts.length - issues.length,
    notReady: issues.length,
    issues,
    enrichmentErrors,
    shippingPolicyVersion: SHIPPING_POLICY_VERSION,
  };
}
