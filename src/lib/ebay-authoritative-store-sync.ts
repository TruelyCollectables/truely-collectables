import type { SupabaseClient } from "@supabase/supabase-js";
import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import { getStoreSettings } from "./store-settings";
import { InventoryRepository } from "../modules/inventory";

const TRADING_API_VERSION = "1409";
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const APPLY_CONCURRENCY = 8;

export type EbayStoreSyncMode = "preview" | "apply";

export type EbayStoreRemoteListing = {
  itemId: string;
  sku: string;
  title: string;
  price: number;
  quantity: number;
  listingType: "FixedPriceItem" | "StoresFixedPrice";
  imageUrl: string;
  imageUrls: string[];
  condition: string | null;
  categoryId: string | null;
  categoryName: string | null;
  aspects: Record<string, string[]>;
  player: string | null;
  sport: string | null;
  mappedCategory: string;
  categoryConfidence: "high" | "medium" | "low";
  reviewRequired: boolean;
};

export type EbayStoreSyncAction = {
  itemId: string;
  title: string;
  action: "insert" | "update" | "unchanged" | "deactivate" | "skip" | "error";
  reason: string;
  legacyProductId: number | null;
  remoteQuantity: number | null;
  localQuantity: number | null;
  remotePrice: number | null;
  localPrice: number | null;
  sku: string | null;
  categoryName: string | null;
};

export type EbayStoreSyncResult = {
  mode: EbayStoreSyncMode;
  storeId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  remoteFixedPriceTotal: number;
  pagesRead: number;
  cycleComplete: boolean;
  eligibleSportsCards: number;
  skippedNonCards: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  localLinkedBefore: number;
  localLinkedAfter: number;
  actions: EbayStoreSyncAction[];
  errors: Array<{ itemId: string; title: string; error: string }>;
};

type ConnectionRow = {
  id: string;
  account_id: string;
  import_cursor: Record<string, unknown> | null;
  provider_metadata: Record<string, unknown> | null;
};

type LocalProduct = {
  id: number;
  seller_account_id: string | null;
  sku: string | null;
  title: string;
  description: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function positiveMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i",
    ).exec(xml)?.[1] || null
  );
}

function xmlBlocks(xml: string, tag: string) {
  return Array.from(
    xml.matchAll(
      new RegExp(
        `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
        "gi",
      ),
    ),
    (match) => match[1],
  );
}

function xmlText(xml: string, tag: string) {
  const block = xmlBlock(xml, tag);
  return block === null ? null : decodeXml(block);
}

function parseAspects(itemXml: string) {
  const aspects: Record<string, string[]> = {};
  const itemSpecifics = xmlBlock(itemXml, "ItemSpecifics");
  if (!itemSpecifics) return aspects;

  for (const pair of xmlBlocks(itemSpecifics, "NameValueList")) {
    const name = xmlText(pair, "Name")?.trim();
    const values = xmlBlocks(pair, "Value")
      .map(decodeXml)
      .map((value) => value.trim())
      .filter(Boolean);
    if (name && values.length) aspects[name] = values;
  }

  return aspects;
}

function firstAspect(aspects: Record<string, string[]>, names: string[]) {
  for (const name of names) {
    const value = aspects[name]?.[0]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizedText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSportsCardListing(input: {
  title: string;
  categoryName: string | null;
  mappedCategory: string;
  aspects: Record<string, string[]>;
}) {
  const categoryName = normalizedText(input.categoryName);
  const sport = firstAspect(input.aspects, ["Sport", "League"]);
  const searchable = normalizedText(
    [
      input.title,
      input.categoryName,
      sport,
      firstAspect(input.aspects, ["Type", "Card Type", "Product"]),
      firstAspect(input.aspects, ["Set"]),
      firstAspect(input.aspects, ["Manufacturer", "Card Manufacturer"]),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (
    /\b(clothing|shoes|sneakers|pants|shorts|shirt|watch|watches|auto parts|automotive|fuel sensor|air intake)\b/.test(
      categoryName,
    )
  ) {
    return false;
  }

  if (/\bsports trading card(s| singles| lots| boxes)?\b/.test(categoryName)) {
    return true;
  }

  const sportSignal = Boolean(
    sport ||
      /\b(baseball|basketball|football|hockey|soccer|golf|tennis|wrestling|racing|nascar|formula 1|f1|ufc|mma|wnba|nba|nfl|nhl|mlb|mls|ncaa)\b/.test(
        searchable,
      ),
  );
  const cardSignal =
    /\b(card|rookie|rc|auto|autograph|relic|patch|prizm|refractor|chrome|bowman|topps|panini|upper deck|donruss|select|optic|mosaic)\b/.test(
      searchable,
    );

  if (
    ["sports_cards", "trading_cards", "sealed_wax"].includes(
      input.mappedCategory,
    ) && sportSignal
  ) {
    return true;
  }

  if (/\btrading card(s| singles| lots| boxes)?\b/.test(categoryName)) {
    return sportSignal;
  }

  return sportSignal && cardSignal;
}

function parseRemoteListing(itemXml: string): EbayStoreRemoteListing | null {
  const itemId = xmlText(itemXml, "ItemID")?.trim() || "";
  const listingType = xmlText(itemXml, "ListingType")?.trim() || "";
  if (
    !itemId ||
    !["FixedPriceItem", "StoresFixedPrice"].includes(listingType)
  ) {
    return null;
  }

  const title = xmlText(itemXml, "Title")?.trim() || "Untitled";
  const sellingStatus = xmlBlock(itemXml, "SellingStatus") || "";
  const price = positiveMoney(
    xmlText(sellingStatus, "CurrentPrice") || xmlText(itemXml, "StartPrice"),
  );
  const available = xmlText(itemXml, "QuantityAvailable");
  const quantity =
    available === null
      ? Math.max(
          nonNegativeInteger(xmlText(itemXml, "Quantity")) -
            nonNegativeInteger(xmlText(sellingStatus, "QuantitySold")),
          0,
        )
      : nonNegativeInteger(available);
  const pictureDetails = xmlBlock(itemXml, "PictureDetails") || "";
  const imageUrls = Array.from(
    new Set(
      [
        xmlText(pictureDetails, "GalleryURL"),
        ...xmlBlocks(pictureDetails, "PictureURL").map(decodeXml),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const aspects = parseAspects(itemXml);
  const primaryCategory = xmlBlock(itemXml, "PrimaryCategory") || "";
  const categoryId = xmlText(primaryCategory, "CategoryID")?.trim() || null;
  const categoryName =
    xmlText(primaryCategory, "CategoryName")?.trim() || null;
  const mapping = mapEbayInventoryCategory({ title, aspects });

  if (
    price <= 0 ||
    quantity <= 0 ||
    !imageUrls[0] ||
    !isSportsCardListing({
      title,
      categoryName,
      mappedCategory: mapping.category,
      aspects,
    })
  ) {
    return null;
  }

  return {
    itemId,
    sku: xmlText(itemXml, "SKU")?.trim() || `legacy-ebay-${itemId}`,
    title,
    price,
    quantity,
    listingType: listingType as "FixedPriceItem" | "StoresFixedPrice",
    imageUrl: imageUrls[0],
    imageUrls,
    condition:
      xmlText(itemXml, "ConditionDisplayName") ||
      firstAspect(aspects, ["Condition"]),
    categoryId,
    categoryName,
    aspects,
    player: firstAspect(aspects, ["Player/Athlete", "Player", "Athlete"]),
    sport: firstAspect(aspects, ["Sport"]),
    mappedCategory: mapping.category,
    categoryConfidence: mapping.confidence,
    reviewRequired: mapping.reviewRequired,
  };
}

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

async function getConnectedSeller(params: {
  supabase: SupabaseClient;
  storeId: string;
}): Promise<ConnectionRow> {
  const { data, error } = await params.supabase
    .from("seller_marketplace_connections")
    .select("id,account_id,import_cursor,provider_metadata")
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .eq("connection_status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.account_id) {
    throw new Error("No connected seller eBay account is available.");
  }
  return data as ConnectionRow;
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
      payload.error_description ||
        payload.error ||
        "eBay token refresh failed.",
    );
  }
  return String(payload.access_token);
}

async function getTradingPage(params: {
  environment: string;
  accessToken: string;
  page: number;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <HideVariations>true</HideVariations>
  <ActiveList>
    <Include>true</Include>
    <ListingType>FixedPriceItem</ListingType>
    <Pagination>
      <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${params.page}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`,
    signal: AbortSignal.timeout(35_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        `eBay GetMyeBaySelling failed with ${response.status}.`,
    );
  }

  const activeList = xmlBlock(xml, "ActiveList") || "";
  const itemBlocks = xmlBlocks(
    xmlBlock(activeList, "ItemArray") || "",
    "Item",
  );
  return {
    totalPages: Math.max(
      nonNegativeInteger(xmlText(activeList, "TotalNumberOfPages")),
      1,
    ),
    totalEntries: nonNegativeInteger(
      xmlText(activeList, "TotalNumberOfEntries"),
    ),
    totalItemsOnPage: itemBlocks.length,
    listings: itemBlocks
      .map(parseRemoteListing)
      .filter(
        (listing): listing is EbayStoreRemoteListing => Boolean(listing),
      ),
  };
}

async function readAllRemoteListings(params: {
  environment: string;
  accessToken: string;
}) {
  const listings: EbayStoreRemoteListing[] = [];
  let totalPages = 1;
  let totalEntries = 0;
  let pagesRead = 0;
  let remoteItemsRead = 0;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await getTradingPage({ ...params, page });
    totalPages = result.totalPages;
    totalEntries = result.totalEntries;
    pagesRead = page;
    remoteItemsRead += result.totalItemsOnPage;
    listings.push(...result.listings);
  }

  return {
    listings,
    totalEntries,
    pagesRead,
    remoteItemsRead,
    cycleComplete: pagesRead >= totalPages,
  };
}

function listingChanged(
  local: LocalProduct,
  remote: EbayStoreRemoteListing,
) {
  return (
    local.title !== remote.title ||
    Number(local.quantity) !== remote.quantity ||
    Math.round(Number(local.price) * 100) !==
      Math.round(remote.price * 100) ||
    local.image_url !== remote.imageUrl ||
    (!local.sku && Boolean(remote.sku))
  );
}

async function safeSku(params: {
  supabase: SupabaseClient;
  storeId: string;
  remote: EbayStoreRemoteListing;
  localProductId?: number | null;
}) {
  const preferred = params.remote.sku || `legacy-ebay-${params.remote.itemId}`;
  const { data, error } = await params.supabase
    .from("products")
    .select("id,ebay_item_id")
    .eq("store_id", params.storeId)
    .eq("sku", preferred)
    .limit(2);
  if (error) throw error;

  const conflict = (data || []).some(
    (row: any) =>
      Number(row.id) !== Number(params.localProductId || 0) &&
      String(row.ebay_item_id || "") !== params.remote.itemId,
  );
  return conflict ? `legacy-ebay-${params.remote.itemId}` : preferred;
}

async function upsertRemoteListing(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId: string;
  remote: EbayStoreRemoteListing;
  local: LocalProduct | null;
}) {
  const now = new Date().toISOString();
  const sku = await safeSku({
    supabase: params.supabase,
    storeId: params.storeId,
    remote: params.remote,
    localProductId: params.local?.id || null,
  });

  const productPayload = {
    seller_account_id:
      params.local?.seller_account_id || params.accountId,
    sku: params.local?.sku || sku,
    title: params.remote.title,
    price: params.remote.price,
    quantity: params.remote.quantity,
    image_url: params.remote.imageUrl,
    ebay_item_id: params.remote.itemId,
    player: params.remote.player,
    sport: params.remote.sport,
    last_seen_at: now,
  };

  const productResult = params.local
    ? await params.supabase
        .from("products")
        .update(productPayload)
        .eq("id", params.local.id)
        .eq("store_id", params.storeId)
        .select("id")
        .single()
    : await params.supabase
        .from("products")
        .insert({
          store_id: params.storeId,
          description: "",
          ...productPayload,
        })
        .select("id")
        .single();
  if (productResult.error || !productResult.data?.id) {
    throw productResult.error || new Error("Could not save local eBay product.");
  }
  const productId = Number(productResult.data.id);

  const repository = new InventoryRepository(
    params.storeId,
    params.supabase,
  );
  const existingInventory =
    (await repository.getByLegacyProductId(productId)) ||
    (await repository.getBySku(sku));
  const inventoryPayload = {
    seller_account_id: params.accountId,
    legacy_product_id: productId,
    sku: existingInventory?.sku || sku,
    title: params.remote.title,
    description:
      existingInventory?.description || params.local?.description || null,
    category: params.remote.mappedCategory || "sports_cards",
    condition:
      params.remote.condition || existingInventory?.condition || "unknown",
    status: "active" as const,
    quantity: params.remote.quantity,
    price: params.remote.price,
    currency: "USD",
    notes: `Authoritatively synced from active eBay listing ${params.remote.itemId}`,
    metadata: {
      ...recordValue(existingInventory?.metadata),
      source_marketplace: "ebay",
      ebay_listing_model: "trading",
      ebay_listing_type: params.remote.listingType,
      ebay_listing_id: params.remote.itemId,
      ebay_category_id: params.remote.categoryId,
      ebay_category_name: params.remote.categoryName,
      ebay_image_urls: params.remote.imageUrls,
      source_aspects: params.remote.aspects,
      category_confidence: params.remote.categoryConfidence,
      review_required: params.remote.reviewRequired,
      authoritative_store_sync_at: now,
    },
  };
  const inventoryItem = existingInventory
    ? await repository.update(existingInventory.id, inventoryPayload)
    : await repository.create(inventoryPayload);

  const images = await repository.getImages(inventoryItem.id);
  const currentPrimary =
    images.find((image) => image.is_primary)?.image_url || null;
  if (currentPrimary !== params.remote.imageUrl) {
    await repository.replacePrimaryImage({
      inventoryItemId: inventoryItem.id,
      imageUrl: params.remote.imageUrl,
      altText: params.remote.title,
    });
  }

  await repository.replaceGeneratedAttributes(
    inventoryItem.id,
    [
      ["ebay_listing_model", "trading"],
      ["ebay_listing_type", params.remote.listingType],
      ["ebay_source_item_id", params.remote.itemId],
      ["ebay_category_id", params.remote.categoryId],
      ["ebay_category_name", params.remote.categoryName],
      ...Object.entries(params.remote.aspects).map(([name, values]) => [
        `ebay_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        values.join(" | "),
      ]),
    ].map(([attribute_name, attribute_value]) => ({
      attribute_name: String(attribute_name),
      attribute_value: attribute_value ? String(attribute_value) : null,
    })),
  );
}

async function touchUnchanged(params: {
  supabase: SupabaseClient;
  storeId: string;
  productIds: number[];
}) {
  const now = new Date().toISOString();
  for (let index = 0; index < params.productIds.length; index += 200) {
    const ids = params.productIds.slice(index, index + 200);
    if (!ids.length) continue;
    const { error } = await params.supabase
      .from("products")
      .update({ last_seen_at: now })
      .eq("store_id", params.storeId)
      .in("id", ids);
    if (error) throw error;
  }
}

async function deactivateLocalProduct(params: {
  supabase: SupabaseClient;
  storeId: string;
  local: LocalProduct;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("products")
    .update({ quantity: 0, last_seen_at: now })
    .eq("id", params.local.id)
    .eq("store_id", params.storeId);
  if (error) throw error;

  const repository = new InventoryRepository(
    params.storeId,
    params.supabase,
  );
  const inventory = await repository.getByLegacyProductId(params.local.id);
  if (inventory) {
    await repository.update(inventory.id, {
      quantity: 0,
      status: "sold",
      metadata: {
        ...recordValue(inventory.metadata),
        ebay_not_active_at_last_full_sync: now,
      },
    });
  }
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
      {
        length: Math.min(
          APPLY_CONCURRENCY,
          Math.max(items.length, 1),
        ),
      },
      () => run(),
    ),
  );
}

export const ebayAuthoritativeStoreSyncTestHelpers = {
  parseRemoteListing,
  isSportsCardListing,
  normalizedText,
};

export async function runEbayAuthoritativeStoreSync(params: {
  supabase: SupabaseClient;
  storeId: string;
  mode?: EbayStoreSyncMode;
  deactivateEnded?: boolean;
}): Promise<EbayStoreSyncResult> {
  const mode = params.mode || "preview";
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const connection = await getConnectedSeller(params);
  const settings = await getStoreSettings(
    params.supabase,
    params.storeId,
  );
  if (!settings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store.");
  }

  const accessToken = await getTradingAccessToken({
    ...params,
    environment: settings.ebayEnvironment,
  });
  const remote = await readAllRemoteListings({
    environment: settings.ebayEnvironment,
    accessToken,
  });
  const { data: localRows, error: localError } = await params.supabase
    .from("products")
    .select(
      "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,last_seen_at",
    )
    .eq("store_id", params.storeId)
    .not("ebay_item_id", "is", null);
  if (localError) throw localError;

  const locals = (localRows || []) as LocalProduct[];
  const localByItemId = new Map(
    locals.map(
      (row) => [String(row.ebay_item_id || ""), row] as const,
    ),
  );
  const remoteByItemId = new Map(
    remote.listings.map((row) => [row.itemId, row] as const),
  );
  const actions: EbayStoreSyncAction[] = remote.listings.map(
    (listing) => {
      const local = localByItemId.get(listing.itemId) || null;
      const action = !local
        ? "insert"
        : listingChanged(local, listing)
          ? "update"
          : "unchanged";
      return {
        itemId: listing.itemId,
        title: listing.title,
        action,
        reason:
          action === "insert"
            ? "Active eBay sports-card listing is missing locally."
            : action === "update"
              ? "Local title, quantity, price, image, or SKU differs from eBay."
              : "Local listing matches active eBay inventory.",
        legacyProductId: local?.id || null,
        remoteQuantity: listing.quantity,
        localQuantity: local ? Number(local.quantity) : null,
        remotePrice: listing.price,
        localPrice: local ? Number(local.price) : null,
        sku: local?.sku || listing.sku,
        categoryName: listing.categoryName,
      };
    },
  );

  if (remote.cycleComplete) {
    for (const local of locals) {
      const itemId = String(local.ebay_item_id || "");
      if (!itemId || remoteByItemId.has(itemId)) continue;
      actions.push({
        itemId,
        title: local.title,
        action: params.deactivateEnded ? "deactivate" : "skip",
        reason: params.deactivateEnded
          ? "Local eBay-linked product is not active in the complete eBay result."
          : "Not active on eBay; left unchanged because ended-listing deactivation is off.",
        legacyProductId: local.id,
        remoteQuantity: null,
        localQuantity: Number(local.quantity),
        remotePrice: null,
        localPrice: Number(local.price),
        sku: local.sku,
        categoryName: null,
      });
    }
  }

  const errors: EbayStoreSyncResult["errors"] = [];
  let inserted = actions.filter((row) => row.action === "insert").length;
  let updated = actions.filter((row) => row.action === "update").length;
  let unchanged = actions.filter(
    (row) => row.action === "unchanged",
  ).length;
  let deactivated = actions.filter(
    (row) => row.action === "deactivate",
  ).length;

  if (mode === "apply") {
    inserted = 0;
    updated = 0;
    unchanged = 0;
    deactivated = 0;
    const changedListings = remote.listings.filter((listing) => {
      const local = localByItemId.get(listing.itemId) || null;
      return !local || listingChanged(local, listing);
    });

    await runWorkers(changedListings, async (listing) => {
      const local = localByItemId.get(listing.itemId) || null;
      try {
        await upsertRemoteListing({
          ...params,
          accountId: connection.account_id,
          remote: listing,
          local,
        });
        if (local) updated += 1;
        else inserted += 1;
      } catch (error) {
        errors.push({
          itemId: listing.itemId,
          title: listing.title,
          error:
            error instanceof Error
              ? error.message
              : "Unknown sync failure.",
        });
      }
    });

    const unchangedIds = remote.listings
      .map((listing) => localByItemId.get(listing.itemId) || null)
      .filter(
        (local): local is LocalProduct =>
          Boolean(
            local &&
              !listingChanged(
                local,
                remoteByItemId.get(String(local.ebay_item_id))!,
              ),
          ),
      )
      .map((local) => local.id);
    try {
      await touchUnchanged({
        supabase: params.supabase,
        storeId: params.storeId,
        productIds: unchangedIds,
      });
      unchanged = unchangedIds.length;
    } catch (error) {
      errors.push({
        itemId: "bulk-touch",
        title: "Unchanged eBay listings",
        error:
          error instanceof Error
            ? error.message
            : "Could not refresh sync timestamps.",
      });
    }

    if (params.deactivateEnded && remote.cycleComplete) {
      const endedLocals = locals.filter(
        (local) =>
          !remoteByItemId.has(String(local.ebay_item_id || "")),
      );
      await runWorkers(endedLocals, async (local) => {
        try {
          await deactivateLocalProduct({ ...params, local });
          deactivated += 1;
        } catch (error) {
          errors.push({
            itemId: String(local.ebay_item_id || ""),
            title: local.title,
            error:
              error instanceof Error
                ? error.message
                : "Unknown deactivate failure.",
          });
        }
      });
    }

    const completedAt = new Date().toISOString();
    await params.supabase
      .from("seller_marketplace_connections")
      .update({
        import_cursor: {
          ...recordValue(connection.import_cursor),
          authoritative_store_sync_last_completed_at: completedAt,
          authoritative_store_sync_last_remote_total: remote.totalEntries,
          authoritative_store_sync_last_eligible_cards:
            remote.listings.length,
          authoritative_store_sync_last_inserted: inserted,
          authoritative_store_sync_last_updated: updated,
          authoritative_store_sync_last_failed: errors.length,
        },
        provider_metadata: {
          ...recordValue(connection.provider_metadata),
          authoritative_store_sync: {
            completed_at: completedAt,
            cycle_complete: remote.cycleComplete,
            pages_read: remote.pagesRead,
            remote_total: remote.totalEntries,
            eligible_cards: remote.listings.length,
            inserted,
            updated,
            unchanged,
            deactivated,
            failed: errors.length,
          },
        },
        updated_at: completedAt,
      })
      .eq("id", connection.id);
  }

  let localLinkedAfter = locals.length;
  if (mode === "apply") {
    const { count } = await params.supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", params.storeId)
      .not("ebay_item_id", "is", null);
    localLinkedAfter = Number(count || 0);
  }

  return {
    mode,
    storeId: params.storeId,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    remoteFixedPriceTotal: remote.totalEntries,
    pagesRead: remote.pagesRead,
    cycleComplete: remote.cycleComplete,
    eligibleSportsCards: remote.listings.length,
    skippedNonCards: Math.max(
      remote.remoteItemsRead - remote.listings.length,
      0,
    ),
    inserted,
    updated,
    unchanged,
    deactivated,
    failed: errors.length,
    localLinkedBefore: locals.length,
    localLinkedAfter,
    actions: actions.map((action) => {
      if (mode !== "apply") return action;
      const failed = errors.find(
        (error) => error.itemId === action.itemId,
      );
      return failed
        ? { ...action, action: "error" as const, reason: failed.error }
        : action;
    }),
    errors,
  };
}
