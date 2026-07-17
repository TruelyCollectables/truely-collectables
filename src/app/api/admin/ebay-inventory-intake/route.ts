import { createServerInventoryEngine } from "../../../../lib/server-inventory-engine";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  category: string | null;
  status: string | null;
  quantity: number | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type InstaCompRepriceComp = {
  title: string;
  price: number;
  url: string | null;
  itemId: string | null;
};

let ebayAppTokenCache:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;
let ebayStoreTokenCache:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function median(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (sorted.length === 0) return 0;

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function clampDiscountPercent(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 95);
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function generatedSku(product: ProductRow) {
  const existingSku = cleanText(product.sku);
  if (existingSku) return existingSku;

  const ebayItemId = cleanText(product.ebay_item_id);
  if (ebayItemId) return `EBAY-${ebayItemId}`;

  return `TCOS-${product.id}`;
}

function canRepairForLive(product: ProductRow) {
  return (
    cleanText(product.title) !== null &&
    cleanText(product.ebay_item_id) !== null &&
    moneyNumber(product.price) > 0 &&
    Number(product.quantity || 0) > 0
  );
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

async function getEbayAppToken() {
  if (ebayAppTokenCache && ebayAppTokenCache.expiresAt > Date.now()) {
    return ebayAppTokenCache.token;
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return null;
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    ebayAppTokenCache = null;
    return null;
  }

  const expiresInSeconds = Number(data.expires_in || 0);
  const safeTtlMs =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 120
      ? (expiresInSeconds - 60) * 1000
      : 30 * 60 * 1000;
  ebayAppTokenCache = {
    token: String(data.access_token),
    expiresAt: Date.now() + safeTtlMs,
  };

  return ebayAppTokenCache.token;
}

async function getEbayStoreAccessToken(storeId: string) {
  if (ebayStoreTokenCache && ebayStoreTokenCache.expiresAt > Date.now()) {
    return ebayStoreTokenCache.token;
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.refresh_token) {
    return null;
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(data.refresh_token),
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });
  const tokenData = await response.json().catch(() => ({}));

  if (!response.ok || !tokenData.access_token) {
    ebayStoreTokenCache = null;
    return null;
  }

  const expiresInSeconds = Number(tokenData.expires_in || 0);
  ebayStoreTokenCache = {
    token: String(tokenData.access_token),
    expiresAt:
      Date.now() +
      (Number.isFinite(expiresInSeconds) && expiresInSeconds > 120
        ? (expiresInSeconds - 60) * 1000
        : 30 * 60 * 1000),
  };

  return ebayStoreTokenCache.token;
}

async function fetchEbaySnapshot(ebayItemId: string) {
  const token = await getEbayAppToken();

  if (token) {
    const browseUrl = new URL(
      "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id",
    );
    browseUrl.searchParams.set("legacy_item_id", ebayItemId);

    const response = await fetch(browseUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Accept-Language": "en-US",
      },
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      const availability = Array.isArray(data.estimatedAvailabilities)
        ? data.estimatedAvailabilities[0]
        : null;
      const availableQuantity = Math.max(
        0,
        Math.floor(
          Number(
            availability?.estimatedAvailableQuantity ??
              availability?.estimatedRemainingQuantity ??
              0,
          ),
        ),
      );

      return {
        title: cleanText(data.title),
        imageUrl:
          cleanText(data.image?.imageUrl) ||
          cleanText(data.thumbnailImages?.[0]?.imageUrl),
        price: moneyNumber(data.price?.value),
        availabilityStatus: cleanText(availability?.estimatedAvailabilityStatus),
        availableQuantity,
        soldQuantity: moneyNumber(availability?.estimatedSoldQuantity),
        itemEndDate: cleanText(data.itemEndDate),
      };
    }
  }

  if (!process.env.EBAY_CLIENT_ID) {
    return null;
  }

  const shoppingUrl = new URL("https://open.api.ebay.com/shopping");
  shoppingUrl.searchParams.set("callname", "GetSingleItem");
  shoppingUrl.searchParams.set("responseencoding", "JSON");
  shoppingUrl.searchParams.set("appid", process.env.EBAY_CLIENT_ID);
  shoppingUrl.searchParams.set("siteid", "0");
  shoppingUrl.searchParams.set("version", "967");
  shoppingUrl.searchParams.set("ItemID", ebayItemId);
  shoppingUrl.searchParams.set("IncludeSelector", "Details");

  const response = await fetch(shoppingUrl, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  const item = data.Item || {};
  const picture = Array.isArray(item.PictureURL)
    ? item.PictureURL[0]
    : item.PictureURL;
  const quantity = Math.max(
    0,
    Math.floor(
      Number(item.Quantity || 0) - Math.max(0, Math.floor(Number(item.QuantitySold || 0))),
    ),
  );

  if (!response.ok || !item.ItemID) {
    return null;
  }

  return {
    title: cleanText(item.Title),
    imageUrl: cleanText(picture),
    price: moneyNumber(
      item.ConvertedCurrentPrice?.Value ?? item.CurrentPrice?.Value,
    ),
    availabilityStatus:
      cleanText(item.ListingStatus) === "Active" && quantity > 0
        ? "IN_STOCK"
        : cleanText(item.ListingStatus),
    availableQuantity: quantity,
    soldQuantity: moneyNumber(item.QuantitySold),
    itemEndDate: cleanText(item.EndTime),
  };
}

type EbaySaleability = {
  saleable: boolean;
  quantity: number | null;
  price: number | null;
  source: "seller_inventory" | "browse";
  reasons: string[];
  offerStatus?: string | null;
  listingStatus?: string | null;
};

function saleabilityFromSnapshot(
  snapshot: Awaited<ReturnType<typeof fetchEbaySnapshot>> | null,
): EbaySaleability | null {
  if (!snapshot) return null;

  const quantity = Math.max(0, Math.floor(Number(snapshot.availableQuantity || 0)));
  const saleable = snapshot.availabilityStatus === "IN_STOCK" && quantity > 0;
  const reasons: string[] = [];

  if (!saleable) {
    reasons.push(
      snapshot.availabilityStatus
        ? `browse_${snapshot.availabilityStatus.toLowerCase()}`
        : "browse_not_confirmed_in_stock",
    );
    if (quantity <= 0) reasons.push("sold_or_zero_quantity");
  }

  return {
    saleable,
    quantity: saleable ? quantity : 0,
    price: snapshot.price > 0 ? snapshot.price : null,
    source: "browse",
    reasons,
  };
}

async function fetchSellerInventorySaleability(params: {
  storeId: string;
  sku: string;
  ebayItemId: string | null;
}): Promise<EbaySaleability | null> {
  const accessToken = await getEbayStoreAccessToken(params.storeId);

  if (!accessToken || !params.sku) return null;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
  const itemResponse = await fetch(
    `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(params.sku)}`,
    { headers },
  );

  if (itemResponse.status === 404) {
    return {
      saleable: false,
      quantity: 0,
      price: null,
      source: "seller_inventory",
      reasons: ["seller_inventory_item_not_found"],
    };
  }

  const itemData = await itemResponse.json().catch(() => ({}));

  if (!itemResponse.ok) return null;

  const quantityNumber = Number(
    itemData?.availability?.shipToLocationAvailability?.quantity,
  );
  const quantity =
    Number.isFinite(quantityNumber) && quantityNumber >= 0
      ? Math.floor(quantityNumber)
      : null;
  const offerResponse = await fetch(
    `https://api.ebay.com/sell/inventory/v1/offer?sku=${encodeURIComponent(params.sku)}`,
    { headers },
  );
  const offerData = await offerResponse.json().catch(() => ({}));

  if (!offerResponse.ok) {
    return {
      saleable: false,
      quantity,
      price: null,
      source: "seller_inventory",
      reasons: [`offer_lookup_failed_${offerResponse.status}`],
    };
  }

  const offers = Array.isArray(offerData?.offers) ? offerData.offers : [];
  const matchingOffer = params.ebayItemId
    ? offers.find(
        (offer: any) =>
          String(offer?.listing?.listingId || "") === params.ebayItemId,
      )
    : null;
  const offer = matchingOffer || offers[0] || null;
  const offerStatus = offer?.status ? String(offer.status) : null;
  const listingStatus = offer?.listing?.listingStatus
    ? String(offer.listing.listingStatus)
    : null;
  const listingId = offer?.listing?.listingId
    ? String(offer.listing.listingId)
    : null;
  const listingOnHold = offer?.listing?.listingOnHold === true;
  const listingMismatch = Boolean(
    listingId && params.ebayItemId && listingId !== params.ebayItemId,
  );
  const saleable =
    quantity !== null &&
    quantity > 0 &&
    offerStatus === "PUBLISHED" &&
    listingStatus === "ACTIVE" &&
    !listingOnHold &&
    !listingMismatch;
  const reasons: string[] = [];

  if (offers.length === 0) reasons.push("offer_not_found");
  if (quantity !== null && quantity <= 0) reasons.push("sold_or_zero_quantity");
  if (offerStatus && offerStatus !== "PUBLISHED") {
    reasons.push(`offer_${offerStatus.toLowerCase()}`);
  }
  if (listingStatus && listingStatus !== "ACTIVE") {
    reasons.push(`listing_${listingStatus.toLowerCase()}`);
  }
  if (listingOnHold) reasons.push("listing_on_hold");
  if (listingMismatch) reasons.push("listing_id_mismatch");

  return {
    saleable,
    quantity,
    price: moneyNumber(offer?.pricingSummary?.price?.value) || null,
    source: "seller_inventory",
    reasons,
    offerStatus,
    listingStatus,
  };
}

async function resolveEbaySaleability(params: {
  storeId: string;
  sku: string;
  ebayItemId: string | null;
  snapshot: Awaited<ReturnType<typeof fetchEbaySnapshot>> | null;
}) {
  const sellerSaleability = await fetchSellerInventorySaleability({
    storeId: params.storeId,
    sku: params.sku,
    ebayItemId: params.ebayItemId,
  });

  if (sellerSaleability) return sellerSaleability;

  return {
    saleable: false,
    quantity: 0,
    price: null,
    source: "seller_inventory",
    reasons: ["seller_active_listing_not_confirmed"],
  } satisfies EbaySaleability;
}

async function markProductInactiveFromEbay(params: {
  product: ProductRow;
  storeId: string;
}) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  await supabase
    .from("products")
    .update({
      quantity: 0,
      last_seen_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("id", params.product.id);

  await supabase
    .from("inventory_items")
    .update({
      quantity: 0,
      status: "sold",
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("legacy_product_id", params.product.id);
}

function buildInstaCompRepriceQuery(product: ProductRow) {
  const title = (cleanText(product.title) || "").slice(0, 180);

  return title
    .replace(/\bPSA\s*(?:10|9|8|7|6|5|4|3|2|1)\b/gi, " ")
    .replace(/\bBGS\s*(?:10|9\.5|9|8\.5|8|7\.5|7|6\.5|6)\b/gi, " ")
    .replace(/\bHGA\s*(?:10|9\.5|9|8\.5|8|7\.5|7)\b/gi, " ")
    .replace(/\bSGC\s*(?:10|9\.5|9|8\.5|8|7\.5|7)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function titleOverlapScore(left: string, right: string) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "card",
    "cards",
    "new",
    "box",
  ]);
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9#/-]+/g, " ")
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 1 && !stopWords.has(part));
  const leftParts = normalize(left);
  const rightSet = new Set(normalize(right));

  if (leftParts.length === 0 || rightSet.size === 0) return 0;

  const matches = leftParts.filter((part) => rightSet.has(part)).length;

  return matches / Math.max(leftParts.length, 1);
}

async function fetchInstaCompMarketplaceComps(product: ProductRow) {
  const token = await getEbayAppToken();
  const query = buildInstaCompRepriceQuery(product);
  const ownEbayItemId = cleanText(product.ebay_item_id);

  if (!token || !query) return [];

  const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", "25");
  searchUrl.searchParams.set("filter", "buyingOptions:{FIXED_PRICE|AUCTION}");

  const response = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Accept-Language": "en-US",
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) return [];

  const summaries = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

  return (summaries as any[])
    .map((item: any): InstaCompRepriceComp | null => {
      const price = moneyNumber(item?.price?.value);
      const title = cleanText(item?.title)?.slice(0, 240) || null;
      const itemId = cleanText(item?.legacyItemId) || cleanText(item?.itemId);

      if (!title || price <= 0) return null;
      if (ownEbayItemId && itemId && itemId.includes(ownEbayItemId)) return null;
      if (titleOverlapScore(product.title || "", title) < 0.45) return null;

      return {
        title,
        price,
        url: cleanText(item?.itemWebUrl)?.slice(0, 1000) || null,
        itemId,
      };
    })
    .filter(
      (item: InstaCompRepriceComp | null): item is InstaCompRepriceComp =>
        Boolean(item),
    )
    .sort((left, right) => left.price - right.price)
    .slice(0, 12);
}

async function instacompRepriceProduct(params: {
  product: ProductRow;
  inventory: InventoryRow | null;
}) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const comps = await fetchInstaCompMarketplaceComps(params.product);
  const prices = comps.map((comp) => comp.price);
  const marketMedian = median(prices);

  if (comps.length < 2 || marketMedian <= 0) {
    return {
      productId: params.product.id,
      title: params.product.title || "Untitled eBay listing",
      updated: false,
      previousPrice: moneyNumber(params.product.price),
      suggestedPrice: null,
      compCount: comps.length,
      message: "No reliable active marketplace comp set found.",
    };
  }

  const previousPrice = moneyNumber(params.product.price);
  const suggestedPrice = Math.max(0.99, roundMoney(marketMedian * 0.95));
  const now = new Date().toISOString();
  const metadata =
    params.inventory?.metadata && typeof params.inventory.metadata === "object"
      ? { ...params.inventory.metadata }
      : {};
  const nextMetadata = {
    ...metadata,
    instacomp_single_reprice: {
      source: "admin_ebay_inventory_intake",
      strategy: "active_marketplace_median_minus_5_percent",
      previous_price: previousPrice,
      suggested_price: suggestedPrice,
      market_median: roundMoney(marketMedian),
      comp_count: comps.length,
      repriced_at: now,
      comps: comps.slice(0, 8),
    },
  };

  const { error: productError } = await supabase
    .from("products")
    .update({
      price: suggestedPrice,
      last_seen_at: now,
    })
    .eq("store_id", storeId)
    .eq("id", params.product.id);

  if (productError) throw productError;

  if (params.inventory?.id) {
    const { error: inventoryError } = await supabase
      .from("inventory_items")
      .update({
        price: suggestedPrice,
        metadata: nextMetadata,
        updated_at: now,
      })
      .eq("store_id", storeId)
      .eq("id", params.inventory.id);

    if (inventoryError) throw inventoryError;
  }

  return {
    productId: params.product.id,
    title: params.product.title || "Untitled eBay listing",
    updated: true,
    previousPrice,
    suggestedPrice,
    compCount: comps.length,
    message: `InstaComp™ repriced from $${previousPrice.toFixed(2)} to $${suggestedPrice.toFixed(2)} from ${comps.length} active comps.`,
  };
}

async function repairProductForLive(product: ProductRow) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const ebayItemId = cleanText(product.ebay_item_id);
  const snapshot = ebayItemId ? await fetchEbaySnapshot(ebayItemId) : null;
  const sku = generatedSku(product);
  const saleability = await resolveEbaySaleability({
    storeId,
    sku,
    ebayItemId,
    snapshot,
  });

  if (!saleability?.saleable) {
    const reasons = saleability?.reasons?.length
      ? saleability.reasons
      : ["ebay_not_confirmed_for_sale"];
    await markProductInactiveFromEbay({
      product,
      storeId,
    });
    throw new Error(`eBay listing is not currently for sale: ${reasons.join(", ")}`);
  }

  const title = snapshot?.title || product.title || "Untitled eBay listing";
  const snapshotPrice = moneyNumber(snapshot?.price);
  const saleabilityPrice = moneyNumber(saleability.price);
  const price =
    saleabilityPrice > 0
      ? saleabilityPrice
      : snapshotPrice > 0
        ? snapshotPrice
        : moneyNumber(product.price);
  const imageUrl = snapshot?.imageUrl || cleanText(product.image_url);
  const quantity = Math.max(
    0,
    Math.floor(Number(saleability.quantity ?? product.quantity ?? 0)),
  );
  const now = new Date().toISOString();

  if (!imageUrl) {
    throw new Error("No eBay image found yet; refresh/import images before listing live.");
  }

  const { error: productError } = await supabase
    .from("products")
    .update({
      sku,
      title,
      price,
      quantity,
      image_url: imageUrl,
      last_seen_at: now,
    })
    .eq("store_id", storeId)
    .eq("id", product.id);

  if (productError) throw productError;

  const engine = createServerInventoryEngine();
  const item = await engine.upsertFromEbayListing({
    sku,
    title,
    description: product.description || `Imported from eBay listing ${ebayItemId || product.id}.`,
    price,
    quantity,
    imageUrl,
    ebayItemId,
    category: "sports cards",
    categoryConfidence: imageUrl ? "medium" : "needs_image",
    reviewRequired: !imageUrl,
    attributes: {
      ebay_item_id: ebayItemId,
      tcos_import_source: "admin_ebay_inventory_intake",
    },
  });

  await engine.setStatus({
    legacyProductId: item.legacyProductId,
    status: "active",
  });

  return {
    productId: product.id,
    legacyProductId: item.legacyProductId,
    inventoryItemId: item.inventoryItemId,
    imageRefreshed: Boolean(snapshot?.imageUrl),
    priceRefreshed: saleabilityPrice > 0 || snapshotPrice > 0,
  };
}

function mapIntakeRow(product: ProductRow, inventory: InventoryRow | null) {
  const problems = readinessProblems(product, inventory);
  const isReady = problems.length === 0;
  const metadata =
    inventory?.metadata && typeof inventory.metadata === "object"
      ? inventory.metadata
      : {};
  const promo =
    metadata.tcos_promo && typeof metadata.tcos_promo === "object"
      ? (metadata.tcos_promo as Record<string, unknown>)
      : {};
  const singleReprice =
    metadata.instacomp_single_reprice &&
    typeof metadata.instacomp_single_reprice === "object"
      ? (metadata.instacomp_single_reprice as Record<string, unknown>)
      : {};
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
    category: inventory?.category ?? null,
    promoDiscountPercent: moneyNumber(
      promo.discount_percent as number | string | null | undefined,
    ),
    promoOriginalPrice: moneyNumber(
      promo.original_price as number | string | null | undefined,
    ),
    promoFreeShipping: promo.free_shipping === true,
    instaCompSuggestedPrice: moneyNumber(
      singleReprice.suggested_price as number | string | null | undefined,
    ),
    instaCompPreviousPrice: moneyNumber(
      singleReprice.previous_price as number | string | null | undefined,
    ),
    instaCompCompCount: Math.max(
      0,
      Math.floor(Number(singleReprice.comp_count || 0)),
    ),
    instaCompRepricedAt:
      cleanText(singleReprice.repriced_at)?.slice(0, 80) || null,
    isReady,
    isLive,
    problems,
  };
}

async function fetchInventoryRowsForProductIds(
  supabase: ReturnType<typeof getSupabaseClient>,
  storeId: string,
  productIds: number[],
) {
  const rows: InventoryRow[] = [];

  for (let index = 0; index < productIds.length; index += 100) {
    const batch = productIds.slice(index, index + 100);

    if (batch.length === 0) continue;

    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,category,status,quantity,price,metadata,updated_at")
      .eq("store_id", storeId)
      .in("legacy_product_id", batch)
      .range(0, 4999);

    if (error) throw error;
    rows.push(...((data || []) as InventoryRow[]));
  }

  return rows;
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
  let inventoryRows: InventoryRow[] = [];

  try {
    inventoryRows =
      productIds.length === 0
        ? []
        : await fetchInventoryRowsForProductIds(supabase, storeId, productIds);
  } catch (inventoryError: any) {
    return Response.json(
      { success: false, error: inventoryError.message || "Inventory lookup failed." },
      { status: 500 },
    );
  }

  const inventoryByProductId = new Map<number, InventoryRow>();

  for (const row of inventoryRows) {
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

  if (
    ![
      "push-live",
      "refresh-ebay-data",
      "instacomp-reprice",
      "apply-promo",
      "clear-promo",
    ].includes(
      action,
    )
  ) {
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
    .select("id,sku,title,description,price,quantity,image_url,ebay_item_id")
    .eq("store_id", storeId)
    .in("id", productIds);

  if (productsError) {
    return Response.json(
      { success: false, error: productsError.message },
      { status: 500 },
    );
  }

  const productRows = (products || []) as ProductRow[];
  let inventoryRows: InventoryRow[] = [];

  try {
    inventoryRows =
      productRows.length === 0
        ? []
        : await fetchInventoryRowsForProductIds(
            supabase,
            storeId,
            productRows.map((product) => product.id),
          );
  } catch (inventoryError: any) {
    return Response.json(
      { success: false, error: inventoryError.message || "Inventory lookup failed." },
      { status: 500 },
    );
  }

  const inventoryByProductId = new Map<number, InventoryRow>();

  for (const row of inventoryRows) {
    if (row.legacy_product_id) {
      inventoryByProductId.set(Number(row.legacy_product_id), row);
    }
  }

  if (action === "refresh-ebay-data") {
    let refreshed = 0;
    let priceRefreshed = 0;
    let imageRefreshed = 0;
    const refreshErrors: Array<{
      productId: number;
      title: string;
      error: string;
    }> = [];

    for (const product of productRows) {
      try {
        const result = await repairProductForLive(product);
        refreshed++;
        if (result.priceRefreshed) priceRefreshed++;
        if (result.imageRefreshed) imageRefreshed++;
      } catch (refreshError: any) {
        refreshErrors.push({
          productId: product.id,
          title: product.title || "Untitled eBay listing",
          error: refreshError.message || "Refresh failed",
        });
      }
    }

    return Response.json({
      success: true,
      refreshed,
      priceRefreshed,
      imageRefreshed,
      refreshErrors,
      message:
        refreshErrors.length > 0
          ? `${refreshed} refreshed from current eBay data. ${refreshErrors.length} still need help.`
          : `${refreshed} selected listing${
              refreshed === 1 ? "" : "s"
            } refreshed from current eBay price + pictures.`,
    });
  }

  if (action === "instacomp-reprice") {
    let updated = 0;
    const repriced: Array<Awaited<ReturnType<typeof instacompRepriceProduct>>> = [];
    const repriceErrors: Array<{ productId: number; title: string; error: string }> = [];

    for (const product of productRows) {
      try {
        const result = await instacompRepriceProduct({
          product,
          inventory: inventoryByProductId.get(product.id) ?? null,
        });

        if (result.updated) updated++;
        repriced.push(result);
      } catch (repriceError: any) {
        repriceErrors.push({
          productId: product.id,
          title: product.title || "Untitled eBay listing",
          error: repriceError.message || "InstaComp™ reprice failed",
        });
      }
    }

    return Response.json({
      success: true,
      updated,
      repriced,
      repriceErrors,
      message:
        updated > 0
          ? `InstaComp™ repriced ${updated} selected listing${
              updated === 1 ? "" : "s"
            }.`
          : "InstaComp™ did not find enough reliable comps to reprice the selected listing.",
    });
  }

  if (action === "apply-promo" || action === "clear-promo") {
    const discountPercent =
      action === "apply-promo" ? clampDiscountPercent(body.discountPercent) : 0;
    const freeShipping =
      action === "apply-promo" ? body.freeShipping === true : false;
    let updated = 0;
    const skipped: Array<{ productId: number; title: string; problems: string[] }> = [];

    for (const product of productRows) {
      const inventory = inventoryByProductId.get(product.id) ?? null;

      if (!inventory) {
        skipped.push({
          productId: product.id,
          title: product.title || "Untitled eBay listing",
          problems: ["missing V2 inventory row"],
        });
        continue;
      }

      const metadata =
        inventory.metadata && typeof inventory.metadata === "object"
          ? { ...inventory.metadata }
          : {};
      const promo =
        metadata.tcos_promo && typeof metadata.tcos_promo === "object"
          ? { ...(metadata.tcos_promo as Record<string, unknown>) }
          : {};
      const storedOriginalPrice = moneyNumber(
        promo.original_price as number | string | null | undefined,
      );
      const currentProductPrice = moneyNumber(product.price);
      const originalPrice =
        storedOriginalPrice > 0 ? storedOriginalPrice : currentProductPrice;
      const nextPrice =
        action === "clear-promo"
          ? originalPrice
          : roundMoney(originalPrice * (1 - discountPercent / 100));
      const nextMetadata =
        action === "clear-promo"
          ? {
              ...metadata,
              tcos_promo: {
                original_price: originalPrice,
                discount_percent: 0,
                free_shipping: false,
                cleared_at: new Date().toISOString(),
              },
            }
          : {
              ...metadata,
              tcos_promo: {
                original_price: originalPrice,
                discount_percent: discountPercent,
                free_shipping: freeShipping,
                applied_at: new Date().toISOString(),
                source: "admin_ebay_inventory_intake",
              },
            };

      const { error: productUpdateError } = await supabase
        .from("products")
        .update({ price: nextPrice })
        .eq("store_id", storeId)
        .eq("id", product.id);

      if (productUpdateError) throw productUpdateError;

      const { error: inventoryUpdateError } = await supabase
        .from("inventory_items")
        .update({
          price: nextPrice,
          metadata: nextMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("store_id", storeId)
        .eq("id", inventory.id);

      if (inventoryUpdateError) throw inventoryUpdateError;

      updated++;
    }

    return Response.json({
      success: true,
      updated,
      skipped,
      message:
        action === "clear-promo"
          ? `${updated} selected listing${updated === 1 ? "" : "s"} restored to original pricing.`
          : `${updated} selected listing${updated === 1 ? "" : "s"} updated: ${discountPercent}% off${freeShipping ? " + free shipping flag" : ""}.`,
    });
  }

  let pushedLive = 0;
  let repaired = 0;
  const skipped: Array<{ productId: number; title: string; problems: string[] }> = [];
  const repairErrors: Array<{ productId: number; title: string; error: string }> = [];

  for (const product of productRows) {
    const inventory = inventoryByProductId.get(product.id) ?? null;
    const initialProblems = readinessProblems(product, inventory);

    if (initialProblems.length > 0 && canRepairForLive(product)) {
      try {
        await repairProductForLive(product);
        repaired++;
        pushedLive++;
        continue;
      } catch (repairError: any) {
        repairErrors.push({
          productId: product.id,
          title: product.title || "Untitled eBay listing",
          error: repairError.message || "Repair failed",
        });
      }
    }

    const problems = initialProblems;

    if (problems.length > 0) {
      skipped.push({
        productId: product.id,
        title: product.title || "Untitled eBay listing",
        problems,
      });
      continue;
    }

    try {
      await repairProductForLive(product);
      pushedLive++;
    } catch (repairError: any) {
      repairErrors.push({
        productId: product.id,
        title: product.title || "Untitled eBay listing",
        error: repairError.message || "Push-live refresh failed",
      });
    }
  }

  return Response.json({
    success: true,
    pushedLive,
    repaired,
    skipped,
    repairErrors,
    message:
      skipped.length > 0 || repairErrors.length > 0
        ? `${pushedLive} pushed live (${repaired} repaired). ${skipped.length + repairErrors.length} still need help.`
        : `${pushedLive} selected listing${pushedLive === 1 ? "" : "s"} pushed live (${repaired} repaired).`,
  });
}
