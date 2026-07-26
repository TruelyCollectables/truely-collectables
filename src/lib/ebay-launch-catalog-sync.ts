import type { SupabaseClient } from "@supabase/supabase-js";
import { InventoryRepository } from "../modules/inventory";
import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import {
  listingImageAltText,
  normalizeListingImageUrls,
} from "./listing-image-utils";
import { getStoreSettings } from "./store-settings";
import {
  evaluateTruelyEbayLaunchListing,
  TRUELY_EBAY_LAUNCH_POLICY_VERSION,
  TRUELY_WEBSITE_SHIPPING_RULES_VERSION,
} from "./truely-ebay-launch-policy";

const TRADING_API_VERSION = "1409";
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const APPLY_CONCURRENCY = 6;

export type EbayLaunchCatalogMode = "preview" | "apply";

type RemoteListing = {
  itemId: string;
  sku: string;
  title: string;
  description: string;
  price: number;
  quantity: number;
  listingType: string;
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
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number | null;
  bestOfferAutoDeclinePrice: number | null;
  shippingService: string | null;
  sourceShippingCost: number | null;
  allowed: boolean;
  policyReason: string;
  shippingProfile: "card_letter_eligible" | "parcel_only";
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
};

export type EbayLaunchCatalogAuditRow = {
  itemId: string;
  sku: string;
  title: string;
  allowed: boolean;
  reason: string;
  action: "insert" | "update" | "unchanged" | "blocked" | "deactivate" | "error";
  localProductId: number | null;
  price: number;
  quantity: number;
  imageCount: number;
  bestOfferEnabled: boolean;
  mappedCategory: string;
  shippingProfile: "card_letter_eligible" | "parcel_only";
  minimumWebsiteShippingMethod: "STANDARD_ENVELOPE" | "GROUND_ADVANTAGE" | "PRIORITY_MAIL";
  minimumWebsiteShippingAmount: number;
  error?: string;
};

export type EbayLaunchCatalogResult = {
  mode: EbayLaunchCatalogMode;
  storeId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pagesRead: number;
  remoteActiveTotal: number;
  cycleComplete: boolean;
  allowedRemote: number;
  blockedRemote: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  launchReady: boolean;
  rows: EbayLaunchCatalogAuditRow[];
  blockers: string[];
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function xmlBlocks(xml: string, tag: string) {
  return Array.from(
    xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"),
    ),
    (match) => match[1],
  );
}

function xmlText(xml: string, tag: string) {
  const block = xmlBlock(xml, tag);
  return block === null ? null : decodeXml(block);
}

function booleanValue(value: unknown) {
  return ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}

function moneyValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function positiveMoney(value: unknown) {
  const amount = moneyValue(value);
  return amount !== null && amount > 0 ? amount : 0;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function parseAspects(itemXml: string) {
  const aspects: Record<string, string[]> = {};
  const specifics = xmlBlock(itemXml, "ItemSpecifics");
  if (!specifics) return aspects;

  for (const pair of xmlBlocks(specifics, "NameValueList")) {
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

function minimumShippingFor(listing: RemoteListing) {
  if (listing.price > 250) {
    return { method: "PRIORITY_MAIL" as const, amount: 0 };
  }
  if (listing.shippingProfile === "card_letter_eligible" && listing.price <= 20) {
    return { method: "STANDARD_ENVELOPE" as const, amount: 1.99 };
  }
  return { method: "GROUND_ADVANTAGE" as const, amount: 6.99 };
}

function parseRemoteListing(itemXml: string): RemoteListing | null {
  const itemId = xmlText(itemXml, "ItemID")?.trim() || "";
  if (!itemId) return null;

  const title = xmlText(itemXml, "Title")?.trim() || "Untitled";
  const description = xmlText(itemXml, "Description")?.trim() || "";
  const listingType = xmlText(itemXml, "ListingType")?.trim() || "Unknown";
  const sellingStatus = xmlBlock(itemXml, "SellingStatus") || "";
  const price = positiveMoney(
    xmlText(sellingStatus, "CurrentPrice") ||
      xmlText(itemXml, "BuyItNowPrice") ||
      xmlText(itemXml, "StartPrice"),
  );
  const quantityAvailable = xmlText(itemXml, "QuantityAvailable");
  const quantity =
    quantityAvailable === null
      ? Math.max(
          nonNegativeInteger(xmlText(itemXml, "Quantity")) -
            nonNegativeInteger(xmlText(sellingStatus, "QuantitySold")),
          0,
        )
      : nonNegativeInteger(quantityAvailable);
  const pictureDetails = xmlBlock(itemXml, "PictureDetails") || "";
  const imageUrls = normalizeListingImageUrls([
    xmlText(pictureDetails, "GalleryURL"),
    ...xmlBlocks(pictureDetails, "PictureURL").map(decodeXml),
  ]);
  const primaryCategory = xmlBlock(itemXml, "PrimaryCategory") || "";
  const categoryId = xmlText(primaryCategory, "CategoryID")?.trim() || null;
  const categoryName = xmlText(primaryCategory, "CategoryName")?.trim() || null;
  const aspects = parseAspects(itemXml);
  const mapping = mapEbayInventoryCategory({ title, description, aspects });
  const bestOfferDetails = xmlBlock(itemXml, "BestOfferDetails") || "";
  const bestOfferEnabled = booleanValue(
    xmlText(bestOfferDetails, "BestOfferEnabled") ||
      xmlText(itemXml, "BestOfferEnabled"),
  );
  const bestOfferAutoAcceptPrice = moneyValue(
    xmlText(bestOfferDetails, "BestOfferAutoAcceptPrice") ||
      xmlText(itemXml, "BestOfferAutoAcceptPrice"),
  );
  const bestOfferAutoDeclinePrice = moneyValue(
    xmlText(bestOfferDetails, "MinimumBestOfferPrice") ||
      xmlText(bestOfferDetails, "BestOfferAutoDeclinePrice") ||
      xmlText(itemXml, "MinimumBestOfferPrice"),
  );
  const shippingDetails = xmlBlock(itemXml, "ShippingDetails") || "";
  const firstShippingOption = xmlBlock(shippingDetails, "ShippingServiceOptions") || "";
  const shippingService =
    xmlText(firstShippingOption, "ShippingService")?.trim() || null;
  const sourceShippingCost = moneyValue(
    xmlText(firstShippingOption, "ShippingServiceCost"),
  );
  const decision = evaluateTruelyEbayLaunchListing({
    title,
    categoryName,
    mappedCategory: mapping.category,
    listingType,
    price,
    quantity,
    imageCount: imageUrls.length,
  });

  return {
    itemId,
    sku: xmlText(itemXml, "SKU")?.trim() || `legacy-ebay-${itemId}`,
    title,
    description,
    price,
    quantity,
    listingType,
    imageUrls,
    condition:
      xmlText(itemXml, "ConditionDisplayName")?.trim() ||
      firstAspect(aspects, ["Condition"]),
    categoryId,
    categoryName,
    aspects,
    player: firstAspect(aspects, ["Player/Athlete", "Player", "Athlete"]),
    sport: firstAspect(aspects, ["Sport"]),
    mappedCategory: mapping.category,
    categoryConfidence: mapping.confidence,
    reviewRequired: mapping.reviewRequired,
    bestOfferEnabled,
    bestOfferAutoAcceptPrice,
    bestOfferAutoDeclinePrice,
    shippingService,
    sourceShippingCost,
    allowed: decision.allowed,
    policyReason: decision.reason,
    shippingProfile: decision.shippingProfile,
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

async function accessToken(params: {
  supabase: SupabaseClient;
  storeId: string;
  environment: string;
}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing eBay client credentials.");

  const { data, error } = await params.supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) throw new Error("No eBay refresh token is available.");

  const response = await fetch(tokenEndpoint(params.environment), {
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

async function readPage(params: {
  environment: string;
  token: string;
  page: number;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.token,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <HideVariations>false</HideVariations>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${params.page}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`,
    signal: AbortSignal.timeout(40_000),
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
  const itemBlocks = xmlBlocks(xmlBlock(activeList, "ItemArray") || "", "Item");
  return {
    totalPages: Math.max(
      nonNegativeInteger(xmlText(activeList, "TotalNumberOfPages")),
      1,
    ),
    totalEntries: nonNegativeInteger(
      xmlText(activeList, "TotalNumberOfEntries"),
    ),
    listings: itemBlocks.map(parseRemoteListing).filter(Boolean) as RemoteListing[],
  };
}

async function readAllListings(params: {
  environment: string;
  token: string;
}) {
  const listings: RemoteListing[] = [];
  let totalPages = 1;
  let totalEntries = 0;
  let pagesRead = 0;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await readPage({ ...params, page });
    totalPages = result.totalPages;
    totalEntries = result.totalEntries;
    pagesRead = page;
    listings.push(...result.listings);
  }

  return {
    listings,
    totalEntries,
    pagesRead,
    cycleComplete: pagesRead >= totalPages,
  };
}

function listingChanged(local: LocalProduct, remote: RemoteListing) {
  return (
    local.title !== remote.title ||
    String(local.description || "") !== remote.description ||
    Number(local.quantity) !== remote.quantity ||
    Math.round(Number(local.price) * 100) !== Math.round(remote.price * 100) ||
    local.image_url !== remote.imageUrls[0] ||
    (!local.sku && Boolean(remote.sku))
  );
}

async function connectedSellerAccountId(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const { data } = await params.supabase
    .from("seller_marketplace_connections")
    .select("account_id")
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .eq("connection_status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.account_id ? String(data.account_id) : null;
}

async function synchronizeImages(params: {
  supabase: SupabaseClient;
  inventoryItemId: string;
  title: string;
  imageUrls: string[];
}) {
  const { error: deleteError } = await params.supabase
    .from("inventory_images")
    .delete()
    .eq("inventory_item_id", params.inventoryItemId);
  if (deleteError) throw deleteError;

  if (!params.imageUrls.length) return;
  const { error: insertError } = await params.supabase
    .from("inventory_images")
    .insert(
      params.imageUrls.map((imageUrl, index) => ({
        inventory_item_id: params.inventoryItemId,
        image_url: imageUrl,
        alt_text: listingImageAltText(params.title, index),
        sort_order: index,
        is_primary: index === 0,
      })),
    );
  if (insertError) throw insertError;
}

async function recordDecision(params: {
  supabase: SupabaseClient;
  storeId: string;
  runId: string;
  listing: RemoteListing;
}) {
  const shipping = minimumShippingFor(params.listing);
  const { error } = await params.supabase
    .from("ebay_sync_decision_events")
    .insert({
      store_id: params.storeId,
      run_id: params.runId,
      source: "truely_launch_catalog_sync",
      action: params.listing.allowed ? "import_listing" : "skip",
      decision: params.listing.allowed ? "allowed" : "blocked_by_tcos_policy",
      reason: params.listing.policyReason,
      sku: params.listing.sku,
      ebay_item_id: params.listing.itemId,
      product_title: params.listing.title,
      quantity: params.listing.quantity,
      price: params.listing.price,
      category: params.listing.mappedCategory,
      category_confidence: params.listing.categoryConfidence,
      review_required: false,
      policy_metadata: {
        policy_version: TRUELY_EBAY_LAUNCH_POLICY_VERSION,
        image_count: params.listing.imageUrls.length,
        best_offer_enabled: params.listing.bestOfferEnabled,
        shipping_profile: params.listing.shippingProfile,
        minimum_website_shipping_method: shipping.method,
        minimum_website_shipping_amount: shipping.amount,
      },
    });
  if (error && !["42P01", "42703"].includes(String(error.code || ""))) {
    console.error("Could not record eBay launch decision", error.message);
  }
}

async function upsertAllowedListing(params: {
  supabase: SupabaseClient;
  storeId: string;
  sellerAccountId: string | null;
  remote: RemoteListing;
  local: LocalProduct | null;
}) {
  const now = new Date().toISOString();
  const shipping = minimumShippingFor(params.remote);
  const productPayload = {
    seller_account_id: params.local?.seller_account_id || params.sellerAccountId,
    sku: params.local?.sku || params.remote.sku,
    title: params.remote.title,
    description: params.remote.description,
    price: params.remote.price,
    quantity: params.remote.quantity,
    image_url: params.remote.imageUrls[0],
    ebay_item_id: params.remote.itemId,
    player: params.remote.player,
    sport: params.remote.sport || params.remote.mappedCategory,
    status: "active",
    archived_at: null,
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
        .insert({ store_id: params.storeId, ...productPayload })
        .select("id")
        .single();
  if (productResult.error || !productResult.data?.id) {
    throw productResult.error || new Error("Could not save eBay product.");
  }
  const productId = Number(productResult.data.id);
  const repository = new InventoryRepository(params.storeId, params.supabase);
  const existingInventory =
    (await repository.getByLegacyProductId(productId)) ||
    (await repository.getBySku(params.remote.sku));
  const existingMetadata = recordValue(existingInventory?.metadata);
  const metadata = {
    ...existingMetadata,
    source_marketplace: "ebay",
    ebay_listing_id: params.remote.itemId,
    ebay_listing_type: params.remote.listingType,
    ebay_category_id: params.remote.categoryId,
    ebay_category_name: params.remote.categoryName,
    ebay_image_urls: params.remote.imageUrls,
    ebay_image_count: params.remote.imageUrls.length,
    source_aspects: params.remote.aspects,
    category_confidence: params.remote.categoryConfidence,
    review_required: false,
    website_best_offer_enabled: params.remote.bestOfferEnabled,
    ebay_best_offer_terms: {
      enabled: params.remote.bestOfferEnabled,
      auto_accept_price: params.remote.bestOfferAutoAcceptPrice,
      auto_decline_price: params.remote.bestOfferAutoDeclinePrice,
    },
    website_shipping_profile: params.remote.shippingProfile,
    website_shipping_rules_version: TRUELY_WEBSITE_SHIPPING_RULES_VERSION,
    minimum_website_shipping_method: shipping.method,
    minimum_website_shipping_amount: shipping.amount,
    source_shipping_service: params.remote.shippingService,
    source_shipping_cost: params.remote.sourceShippingCost,
    truely_ebay_launch: {
      allowed: true,
      reason: params.remote.policyReason,
      policy_version: TRUELY_EBAY_LAUNCH_POLICY_VERSION,
      synced_at: now,
    },
  };
  const inventoryPayload = {
    seller_account_id: params.local?.seller_account_id || params.sellerAccountId,
    legacy_product_id: productId,
    sku: existingInventory?.sku || params.remote.sku,
    title: params.remote.title,
    description: params.remote.description || null,
    category: params.remote.mappedCategory,
    condition: params.remote.condition || existingInventory?.condition || "unknown",
    status: "active" as const,
    quantity: params.remote.quantity,
    price: params.remote.price,
    currency: "USD",
    notes: `Synced from eBay listing ${params.remote.itemId}`,
    metadata,
  };
  const inventoryItem = existingInventory
    ? await repository.update(existingInventory.id, inventoryPayload)
    : await repository.create(inventoryPayload);

  await synchronizeImages({
    supabase: params.supabase,
    inventoryItemId: inventoryItem.id,
    title: params.remote.title,
    imageUrls: params.remote.imageUrls,
  });
  await repository.replaceGeneratedAttributes(
    inventoryItem.id,
    [
      ["ebay_source_item_id", params.remote.itemId],
      ["ebay_listing_type", params.remote.listingType],
      ["ebay_category_id", params.remote.categoryId],
      ["ebay_category_name", params.remote.categoryName],
      ["ebay_best_offer_enabled", String(params.remote.bestOfferEnabled)],
      ["truely_shipping_profile", params.remote.shippingProfile],
      ...Object.entries(params.remote.aspects).map(([name, values]) => [
        `ebay_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        values.join(" | "),
      ]),
    ].map(([attribute_name, attribute_value]) => ({
      attribute_name: String(attribute_name),
      attribute_value: attribute_value ? String(attribute_value) : null,
    })),
  );
  return productId;
}

async function blockExistingListing(params: {
  supabase: SupabaseClient;
  storeId: string;
  remote: RemoteListing;
  local: LocalProduct | null;
}) {
  if (!params.local) return;
  const repository = new InventoryRepository(params.storeId, params.supabase);
  const inventory = await repository.getByLegacyProductId(params.local.id);
  if (!inventory) return;
  await repository.update(inventory.id, {
    status: "draft",
    metadata: {
      ...recordValue(inventory.metadata),
      truely_ebay_launch: {
        allowed: false,
        reason: params.remote.policyReason,
        policy_version: TRUELY_EBAY_LAUNCH_POLICY_VERSION,
        checked_at: new Date().toISOString(),
      },
    },
  });
}

async function deactivateEndedListing(params: {
  supabase: SupabaseClient;
  storeId: string;
  local: LocalProduct;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("products")
    .update({ quantity: 0, status: "sold", last_seen_at: now })
    .eq("id", params.local.id)
    .eq("store_id", params.storeId);
  if (error) throw error;
  const repository = new InventoryRepository(params.storeId, params.supabase);
  const inventory = await repository.getByLegacyProductId(params.local.id);
  if (inventory) {
    await repository.update(inventory.id, {
      quantity: 0,
      status: "sold",
      metadata: {
        ...recordValue(inventory.metadata),
        ebay_not_active_at_last_complete_sync: now,
      },
    });
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
      { length: Math.min(APPLY_CONCURRENCY, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}

export async function runEbayLaunchCatalogSync(params: {
  supabase: SupabaseClient;
  storeId: string;
  mode?: EbayLaunchCatalogMode;
  deactivateEnded?: boolean;
}): Promise<EbayLaunchCatalogResult> {
  const mode = params.mode || "preview";
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const settings = await getStoreSettings(params.supabase, params.storeId);
  if (!settings.ebaySyncEnabled) throw new Error("eBay sync is disabled.");
  const token = await accessToken({
    ...params,
    environment: settings.ebayEnvironment,
  });
  const remote = await readAllListings({
    environment: settings.ebayEnvironment,
    token,
  });
  const sellerAccountId = await connectedSellerAccountId(params);
  const { data: localRows, error: localError } = await params.supabase
    .from("products")
    .select(
      "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id",
    )
    .eq("store_id", params.storeId)
    .not("ebay_item_id", "is", null);
  if (localError) throw localError;
  const locals = (localRows || []) as LocalProduct[];
  const localByItemId = new Map(
    locals.map((row) => [String(row.ebay_item_id || ""), row] as const),
  );
  const remoteByItemId = new Map(
    remote.listings.map((row) => [row.itemId, row] as const),
  );
  const runId = `truely-launch-${Date.now()}`;
  const rows: EbayLaunchCatalogAuditRow[] = remote.listings.map((listing) => {
    const local = localByItemId.get(listing.itemId) || null;
    const shipping = minimumShippingFor(listing);
    return {
      itemId: listing.itemId,
      sku: listing.sku,
      title: listing.title,
      allowed: listing.allowed,
      reason: listing.policyReason,
      action: !listing.allowed
        ? "blocked"
        : !local
          ? "insert"
          : listingChanged(local, listing)
            ? "update"
            : "unchanged",
      localProductId: local?.id || null,
      price: listing.price,
      quantity: listing.quantity,
      imageCount: listing.imageUrls.length,
      bestOfferEnabled: listing.bestOfferEnabled,
      mappedCategory: listing.mappedCategory,
      shippingProfile: listing.shippingProfile,
      minimumWebsiteShippingMethod: shipping.method,
      minimumWebsiteShippingAmount: shipping.amount,
    };
  });

  if (remote.cycleComplete) {
    for (const local of locals) {
      const itemId = String(local.ebay_item_id || "");
      if (!itemId || remoteByItemId.has(itemId)) continue;
      rows.push({
        itemId,
        sku: local.sku || "",
        title: local.title,
        allowed: false,
        reason: "not_active_in_complete_ebay_result",
        action: params.deactivateEnded ? "deactivate" : "blocked",
        localProductId: local.id,
        price: Number(local.price),
        quantity: Number(local.quantity),
        imageCount: local.image_url ? 1 : 0,
        bestOfferEnabled: false,
        mappedCategory: "unknown",
        shippingProfile: "parcel_only",
        minimumWebsiteShippingMethod: "GROUND_ADVANTAGE",
        minimumWebsiteShippingAmount: 6.99,
      });
    }
  }

  if (mode === "apply") {
    await runWorkers(remote.listings, async (listing) => {
      const audit = rows.find((row) => row.itemId === listing.itemId)!;
      const local = localByItemId.get(listing.itemId) || null;
      try {
        await recordDecision({
          supabase: params.supabase,
          storeId: params.storeId,
          runId,
          listing,
        });
        if (!listing.allowed) {
          await blockExistingListing({ ...params, remote: listing, local });
          return;
        }
        if (audit.action === "unchanged") {
          await upsertAllowedListing({
            ...params,
            sellerAccountId,
            remote: listing,
            local,
          });
          return;
        }
        const productId = await upsertAllowedListing({
          ...params,
          sellerAccountId,
          remote: listing,
          local,
        });
        audit.localProductId = productId;
      } catch (error) {
        audit.action = "error";
        audit.error =
          error instanceof Error ? error.message : "Unknown launch sync failure.";
      }
    });

    if (params.deactivateEnded && remote.cycleComplete) {
      const ended = locals.filter(
        (local) => !remoteByItemId.has(String(local.ebay_item_id || "")),
      );
      await runWorkers(ended, async (local) => {
        const audit = rows.find(
          (row) => row.itemId === String(local.ebay_item_id || ""),
        );
        try {
          await deactivateEndedListing({ ...params, local });
        } catch (error) {
          if (audit) {
            audit.action = "error";
            audit.error =
              error instanceof Error ? error.message : "Deactivate failed.";
          }
        }
      });
    }
  }

  const failed = rows.filter((row) => row.action === "error").length;
  const blockers = [
    ...(!remote.cycleComplete ? ["eBay active-list pagination did not complete."] : []),
    ...(failed > 0 ? [`${failed} eligible listing sync operation(s) failed.`] : []),
    ...rows
      .filter((row) => row.allowed && row.imageCount < 1)
      .map((row) => `${row.itemId} is allowed but has no launch image.`),
  ];

  return {
    mode,
    storeId: params.storeId,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    pagesRead: remote.pagesRead,
    remoteActiveTotal: remote.totalEntries,
    cycleComplete: remote.cycleComplete,
    allowedRemote: rows.filter((row) => row.allowed).length,
    blockedRemote: rows.filter((row) => !row.allowed).length,
    inserted: rows.filter((row) => row.action === "insert").length,
    updated: rows.filter((row) => row.action === "update").length,
    unchanged: rows.filter((row) => row.action === "unchanged").length,
    deactivated: rows.filter((row) => row.action === "deactivate").length,
    failed,
    launchReady: blockers.length === 0,
    rows,
    blockers,
  };
}

export const ebayLaunchCatalogSyncTestHelpers = {
  parseRemoteListing,
  minimumShippingFor,
};
