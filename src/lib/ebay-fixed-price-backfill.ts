import type { SupabaseClient } from "@supabase/supabase-js";
import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import { getStoreSettings } from "./store-settings";
import { InventoryRepository } from "../modules/inventory";

const TRADING_API_VERSION = "1409";
const TRADING_PAGE_SIZE = 200;
const RECENT_SYNC_LIMIT = 25;

const CARD_CATEGORY_ALLOWLIST = new Set([
  "sports_cards",
  "trading_cards",
  "sealed_wax",
]);

type ConnectionRow = {
  id: string;
  account_id: string;
  import_cursor: Record<string, unknown> | null;
  provider_metadata: Record<string, unknown> | null;
};

type TradingListing = {
  itemId: string;
  sku: string;
  title: string;
  price: number;
  quantity: number;
  listingType: string;
  imageUrl: string | null;
  condition: string | null;
  aspects: Record<string, string[]>;
  player: string | null;
  sport: string | null;
  category: string;
  categoryConfidence: "high" | "medium" | "low";
  reviewRequired: boolean;
  attributes: Record<string, string>;
};

type LocalLegacyListing = {
  inventoryItemId: string;
  legacyProductId: number;
  itemId: string;
  sku: string | null;
  title: string;
  localQuantity: number;
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
  const trimmed = value
    .trim()
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "");

  return trimmed
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

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlBlock(xml: string, tag: string) {
  const expression = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  );
  return expression.exec(xml)?.[1] || null;
}

function xmlBlocks(xml: string, tag: string) {
  const expression = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "gi",
  );
  return Array.from(xml.matchAll(expression), (match) => match[1]);
}

function xmlText(xml: string, tag: string) {
  const block = xmlBlock(xml, tag);
  return block === null ? null : decodeXml(block);
}

function firstAspect(aspects: Record<string, string[]>, names: string[]) {
  for (const name of names) {
    const value = aspects[name]?.[0]?.trim();
    if (value) return value;
  }

  return null;
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

    if (name && values.length > 0) aspects[name] = values;
  }

  return aspects;
}

function looksLikeCardListing(listing: {
  title: string;
  category: string;
  aspects: Record<string, string[]>;
}) {
  if (CARD_CATEGORY_ALLOWLIST.has(listing.category)) return true;

  const type = firstAspect(listing.aspects, ["Type", "Product", "Card Type"]);
  const searchable = [
    listing.title,
    type,
    firstAspect(listing.aspects, ["Set"]),
    firstAspect(listing.aspects, ["Manufacturer", "Card Manufacturer"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    listing.category === "autographs" &&
    /\b(card|rookie|topps|panini|upper deck|bowman|donruss|prizm|refractor)\b/.test(
      searchable,
    )
  );
}

function parseTradingListing(itemXml: string): TradingListing | null {
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
  const quantityAvailable = xmlText(itemXml, "QuantityAvailable");
  const totalQuantity = nonNegativeInteger(xmlText(itemXml, "Quantity"));
  const quantitySold = nonNegativeInteger(xmlText(sellingStatus, "QuantitySold"));
  const quantity =
    quantityAvailable === null
      ? Math.max(totalQuantity - quantitySold, 0)
      : nonNegativeInteger(quantityAvailable);
  const pictureDetails = xmlBlock(itemXml, "PictureDetails") || "";
  const imageUrl =
    xmlText(pictureDetails, "GalleryURL") ||
    xmlBlocks(pictureDetails, "PictureURL").map(decodeXml)[0] ||
    null;
  const aspects = parseAspects(itemXml);
  const mapping = mapEbayInventoryCategory({ title, aspects });
  const candidate = {
    title,
    category: mapping.category,
    aspects,
  };

  if (!looksLikeCardListing(candidate) || price <= 0 || quantity <= 0 || !imageUrl) {
    return null;
  }

  const providedSku = xmlText(itemXml, "SKU")?.trim();

  return {
    itemId,
    sku: providedSku || `legacy-ebay-${itemId}`,
    title,
    price,
    quantity,
    listingType,
    imageUrl,
    condition:
      xmlText(itemXml, "ConditionDisplayName") ||
      firstAspect(aspects, ["Condition"]),
    aspects,
    player: firstAspect(aspects, ["Player/Athlete", "Player", "Athlete"]),
    sport: firstAspect(aspects, ["Sport"]),
    category: mapping.category,
    categoryConfidence: mapping.confidence,
    reviewRequired: mapping.reviewRequired,
    attributes: {
      ...mapping.attributes,
      ebay_listing_model: "trading",
      ebay_listing_type: listingType,
      ebay_source_item_id: itemId,
    },
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
    throw new Error(
      "No connected seller eBay account is available for fixed-price backfill.",
    );
  }

  return data as ConnectionRow;
}

async function getTradingAccessToken(params: {
  supabase: SupabaseClient;
  storeId: string;
  ebayEnvironment: string;
}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const { data, error } = await params.supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.refresh_token) {
    throw new Error("No store eBay refresh token is available");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const response = await fetch(tokenEndpoint(params.ebayEnvironment), {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
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
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "eBay token refresh failed",
    );
  }

  return String(payload.access_token);
}

async function tradingCall(params: {
  callName: string;
  requestXml: string;
  accessToken: string;
  ebayEnvironment: string;
}) {
  const response = await fetch(tradingEndpoint(params.ebayEnvironment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": params.callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: params.requestXml,
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";

  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    const message =
      xmlText(errorBlock, "LongMessage") ||
      xmlText(errorBlock, "ShortMessage") ||
      `eBay ${params.callName} failed with ${response.status}`;
    throw new Error(message);
  }

  return xml;
}

async function upsertNewLegacyListing(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId: string;
  listing: TradingListing;
}) {
  const { data: existing, error: existingError } = await params.supabase
    .from("products")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("ebay_item_id", params.listing.itemId)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return { inserted: false, reason: "listing_already_imported" };

  let sku = params.listing.sku;
  const { data: skuMatch, error: skuError } = await params.supabase
    .from("products")
    .select("id,ebay_item_id")
    .eq("store_id", params.storeId)
    .eq("sku", sku)
    .limit(1)
    .maybeSingle();

  if (skuError) throw skuError;
  if (skuMatch && String(skuMatch.ebay_item_id || "") !== params.listing.itemId) {
    sku = `legacy-ebay-${params.listing.itemId}`;
  }

  const now = new Date().toISOString();
  const { data: product, error: productError } = await params.supabase
    .from("products")
    .insert({
      store_id: params.storeId,
      seller_account_id: params.accountId,
      sku,
      title: params.listing.title,
      description: "",
      price: params.listing.price,
      player: params.listing.player,
      sport: params.listing.sport,
      quantity: params.listing.quantity,
      image_url: params.listing.imageUrl,
      ebay_item_id: params.listing.itemId,
      last_seen_at: now,
    })
    .select("id")
    .single();

  if (productError || !product?.id) {
    throw productError || new Error("Could not insert eBay fixed-price product");
  }

  const inventoryRepository = new InventoryRepository(params.storeId, params.supabase);
  const inventoryItem = await inventoryRepository.upsertBySku({
    seller_account_id: params.accountId,
    legacy_product_id: Number(product.id),
    sku,
    title: params.listing.title,
    description: null,
    category: params.listing.category,
    condition: params.listing.condition || "unknown",
    status: "active",
    quantity: params.listing.quantity,
    price: params.listing.price,
    currency: "USD",
    notes: `Imported from active eBay fixed-price listing ${params.listing.itemId}`,
    metadata: {
      source_marketplace: "ebay",
      ebay_listing_model: "trading",
      ebay_listing_type: params.listing.listingType,
      ebay_listing_id: params.listing.itemId,
      category_confidence: params.listing.categoryConfidence,
      review_required: params.listing.reviewRequired,
      source_aspects: params.listing.aspects,
      fixed_price_backfill_imported_at: now,
    },
  });

  if (params.listing.imageUrl) {
    await inventoryRepository.replacePrimaryImage({
      inventoryItemId: inventoryItem.id,
      imageUrl: params.listing.imageUrl,
      altText: params.listing.title,
    });
  }

  await inventoryRepository.replaceGeneratedAttributes(
    inventoryItem.id,
    Object.entries(params.listing.attributes).map(([attribute_name, value]) => ({
      attribute_name,
      attribute_value: value,
    })),
  );

  return { inserted: true, reason: null };
}

export async function importSellerEbayFixedPricePage(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const storeSettings = await getStoreSettings(params.supabase, params.storeId);

  if (!storeSettings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store");
  }

  const connection = await getConnectedSeller(params);
  const cursor = recordValue(connection.import_cursor);
  const requestedPage = Math.max(
    nonNegativeInteger(cursor.fixed_price_backfill_next_page) || 1,
    1,
  );
  const accessToken = await getTradingAccessToken({
    ...params,
    ebayEnvironment: storeSettings.ebayEnvironment,
  });
  const xml = await tradingCall({
    callName: "GetMyeBaySelling",
    accessToken,
    ebayEnvironment: storeSettings.ebayEnvironment,
    requestXml: `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <HideVariations>true</HideVariations>
  <ActiveList>
    <Include>true</Include>
    <ListingType>FixedPriceItem</ListingType>
    <Pagination>
      <EntriesPerPage>${TRADING_PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${requestedPage}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`,
  });
  const activeList = xmlBlock(xml, "ActiveList") || "";
  const totalPages = Math.max(
    nonNegativeInteger(xmlText(activeList, "TotalNumberOfPages")),
    1,
  );
  const totalEntries = nonNegativeInteger(
    xmlText(activeList, "TotalNumberOfEntries"),
  );
  const listings = xmlBlocks(xmlBlock(activeList, "ItemArray") || "", "Item")
    .map(parseTradingListing)
    .filter((listing): listing is TradingListing => Boolean(listing));
  let inserted = 0;
  let existing = 0;
  let failed = 0;
  const errors: Array<{ itemId: string; error: string }> = [];

  for (const listing of listings) {
    try {
      const result = await upsertNewLegacyListing({
        ...params,
        accountId: connection.account_id,
        listing,
      });
      if (result.inserted) inserted += 1;
      else existing += 1;
    } catch (error: any) {
      failed += 1;
      errors.push({
        itemId: listing.itemId,
        error: String(error.message || "Import failed").slice(0, 300),
      });
    }
  }

  const nextPage = requestedPage >= totalPages ? 1 : requestedPage + 1;
  const completedAt = new Date().toISOString();
  const nextCursor = {
    ...cursor,
    fixed_price_backfill_last_page: requestedPage,
    fixed_price_backfill_next_page: nextPage,
    fixed_price_backfill_total_pages: totalPages,
    fixed_price_backfill_total_entries: totalEntries,
    fixed_price_backfill_last_seen: listings.length,
    fixed_price_backfill_last_inserted: inserted,
    fixed_price_backfill_last_existing: existing,
    fixed_price_backfill_last_failed: failed,
    fixed_price_backfill_completed_at: completedAt,
  };

  await params.supabase
    .from("seller_marketplace_connections")
    .update({
      import_cursor: nextCursor,
      provider_metadata: {
        ...recordValue(connection.provider_metadata),
        latest_fixed_price_backfill: {
          page: requestedPage,
          next_page: nextPage,
          total_pages: totalPages,
          total_entries: totalEntries,
          eligible_cards_seen: listings.length,
          inserted,
          existing,
          failed,
          completed_at: completedAt,
        },
      },
      last_sync_error:
        failed > 0 ? `${failed} fixed-price listing(s) failed backfill.` : null,
      updated_at: completedAt,
    })
    .eq("id", connection.id);

  return {
    connectionId: connection.id,
    accountId: connection.account_id,
    page: requestedPage,
    nextPage,
    totalPages,
    totalEntries,
    eligibleCardsSeen: listings.length,
    inserted,
    existing,
    failed,
    errors: errors.slice(0, 10),
  };
}

async function setLocalQuantity(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId: string;
  inventoryItemId: string;
  legacyProductId: number;
  quantity: number;
  reason: string;
}) {
  const quantity = Math.max(0, Math.floor(params.quantity));
  const now = new Date().toISOString();
  const status = quantity > 0 ? "active" : "sold";

  const [productUpdate, inventoryUpdate] = await Promise.all([
    params.supabase
      .from("products")
      .update({ quantity, last_seen_at: now })
      .eq("id", params.legacyProductId)
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId),
    params.supabase
      .from("inventory_items")
      .update({
        quantity,
        status,
        updated_at: now,
        metadata: {
          ebay_listing_model: "trading",
          last_quantity_reconciliation_reason: params.reason,
          last_quantity_reconciled_at: now,
        },
      })
      .eq("id", params.inventoryItemId)
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId),
  ]);

  if (productUpdate.error) throw productUpdate.error;
  if (inventoryUpdate.error) throw inventoryUpdate.error;
}

async function loadRecentLegacyListings(params: {
  supabase: SupabaseClient;
  storeId: string;
  accountId: string;
}) {
  const { data: inventoryRows, error: inventoryError } = await params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,quantity,status,metadata,updated_at")
    .eq("store_id", params.storeId)
    .eq("seller_account_id", params.accountId)
    .order("updated_at", { ascending: false })
    .limit(250);

  if (inventoryError) throw inventoryError;

  const legacyRows = (inventoryRows || [])
    .filter(
      (row: any) =>
        recordValue(row.metadata).ebay_listing_model === "trading" &&
        Number(row.legacy_product_id) > 0,
    )
    .slice(0, RECENT_SYNC_LIMIT);
  const productIds = legacyRows.map((row: any) => Number(row.legacy_product_id));

  if (productIds.length === 0) return [] as LocalLegacyListing[];

  const { data: products, error: productError } = await params.supabase
    .from("products")
    .select("id,sku,title,quantity,ebay_item_id")
    .eq("store_id", params.storeId)
    .eq("seller_account_id", params.accountId)
    .in("id", productIds);

  if (productError) throw productError;

  const productsById = new Map(
    (products || []).map((product: any) => [Number(product.id), product]),
  );

  return legacyRows
    .map((row: any) => {
      const product = productsById.get(Number(row.legacy_product_id));
      const itemId = String(product?.ebay_item_id || "").trim();
      if (!product || !itemId) return null;

      return {
        inventoryItemId: String(row.id),
        legacyProductId: Number(product.id),
        itemId,
        sku: product.sku ? String(product.sku) : null,
        title: String(product.title || "Untitled"),
        localQuantity: nonNegativeInteger(row.quantity),
      } satisfies LocalLegacyListing;
    })
    .filter((listing): listing is LocalLegacyListing => Boolean(listing));
}

export async function syncRecentLegacyEbayQuantities(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const storeSettings = await getStoreSettings(params.supabase, params.storeId);
  const connection = await getConnectedSeller(params);
  const accessToken = await getTradingAccessToken({
    ...params,
    ebayEnvironment: storeSettings.ebayEnvironment,
  });
  const listings = await loadRecentLegacyListings({
    ...params,
    accountId: connection.account_id,
  });
  const counters = {
    checked: 0,
    pushedToEbay: 0,
    endedOnEbay: 0,
    reducedLocally: 0,
    unchanged: 0,
    failed: 0,
  };
  const errors: Array<{ itemId: string; error: string }> = [];

  for (const listing of listings) {
    counters.checked += 1;

    try {
      const itemXml = await tradingCall({
        callName: "GetItem",
        accessToken,
        ebayEnvironment: storeSettings.ebayEnvironment,
        requestXml: `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(listing.itemId)}</ItemID>
</GetItemRequest>`,
      });
      const item = xmlBlock(itemXml, "Item") || "";
      const listingType = xmlText(item, "ListingType") || "";
      const sellingStatus = xmlBlock(item, "SellingStatus") || "";
      const listingStatus = xmlText(sellingStatus, "ListingStatus") || "";
      const availableText = xmlText(item, "QuantityAvailable");
      const totalQuantity = nonNegativeInteger(xmlText(item, "Quantity"));
      const soldQuantity = nonNegativeInteger(
        xmlText(sellingStatus, "QuantitySold"),
      );
      const remoteQuantity =
        availableText === null
          ? Math.max(totalQuantity - soldQuantity, 0)
          : nonNegativeInteger(availableText);

      if (!["FixedPriceItem", "StoresFixedPrice"].includes(listingType)) {
        counters.unchanged += 1;
        continue;
      }

      if (listingStatus && listingStatus !== "Active") {
        if (listing.localQuantity > 0) {
          await setLocalQuantity({
            ...params,
            accountId: connection.account_id,
            inventoryItemId: listing.inventoryItemId,
            legacyProductId: listing.legacyProductId,
            quantity: 0,
            reason: `ebay_listing_${listingStatus.toLowerCase()}`,
          });
          counters.reducedLocally += 1;
        } else {
          counters.unchanged += 1;
        }
        continue;
      }

      if (listing.localQuantity < remoteQuantity) {
        if (listing.localQuantity === 0) {
          await tradingCall({
            callName: "EndFixedPriceItem",
            accessToken,
            ebayEnvironment: storeSettings.ebayEnvironment,
            requestXml: `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(listing.itemId)}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`,
          });
          counters.endedOnEbay += 1;
        } else {
          await tradingCall({
            callName: "ReviseFixedPriceItem",
            accessToken,
            ebayEnvironment: storeSettings.ebayEnvironment,
            requestXml: `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${escapeXml(listing.itemId)}</ItemID>
    <Quantity>${listing.localQuantity}</Quantity>
  </Item>
</ReviseFixedPriceItemRequest>`,
          });
          counters.pushedToEbay += 1;
        }
      } else if (remoteQuantity < listing.localQuantity) {
        await setLocalQuantity({
          ...params,
          accountId: connection.account_id,
          inventoryItemId: listing.inventoryItemId,
          legacyProductId: listing.legacyProductId,
          quantity: remoteQuantity,
          reason: "ebay_remote_quantity_lower",
        });
        counters.reducedLocally += 1;
      } else {
        counters.unchanged += 1;
      }
    } catch (error: any) {
      counters.failed += 1;
      errors.push({
        itemId: listing.itemId,
        error: String(error.message || "Quantity sync failed").slice(0, 300),
      });
    }
  }

  return {
    connectionId: connection.id,
    accountId: connection.account_id,
    ...counters,
    errors: errors.slice(0, 10),
  };
}
