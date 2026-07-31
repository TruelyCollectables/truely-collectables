import {
  calculateCustomWebsitePricing,
  calculateDualMarketplacePricing,
  normalizeDualMarketplaceFeeProfile,
  type DualMarketplaceFeeProfile,
} from "./dual-marketplace-pricing";
import {
  createDualMarketplaceListingDraft,
  type DualMarketplaceListingDraft,
} from "./dual-marketplace-listing";
import { ebayListingContentProblems } from "./ebay-listing-content";
import {
  MAX_DUAL_MARKETPLACE_REQUEST_ITEMS,
  MAX_DUAL_MARKETPLACE_SELECTION,
  dualMarketplaceReadinessErrors,
  validateDualMarketplaceAction,
  type DualMarketplaceAction,
} from "./dual-marketplace-workflow";
import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem,
  type EbayInventoryPublishResult,
} from "./ebay-inventory-publisher";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export const DUAL_MARKETPLACE_ROUTE_MAX_DURATION = 300;

type UnknownRecord = Record<string, unknown>;

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  sku: string | null;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  status: string;
  quantity: number | null;
  price: number | string | null;
  metadata: UnknownRecord | null;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: number;
  seller_account_id: string | null;
  sku: string | null;
  title: string | null;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number | string | null;
  quantity: number | null;
  image_url: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
};

type InventoryImageRow = {
  inventory_item_id: string;
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

type IncomingListing = {
  inventoryItemId?: unknown;
  websiteTitle?: unknown;
  websiteDescription?: unknown;
  ebayTitle?: unknown;
  ebayDescription?: unknown;
  ebayPrice?: unknown;
  websitePrice?: unknown;
  quantity?: unknown;
  ebayCategoryId?: unknown;
  ebayCondition?: unknown;
  cardCondition?: unknown;
  grader?: unknown;
  grade?: unknown;
  certificationNumber?: unknown;
  aspects?: unknown;
  bestOfferEnabled?: unknown;
};

type PreparedListing = {
  inventory: InventoryRow;
  product: ProductRow | null;
  metadata: UnknownRecord;
  websiteTitle: string;
  websiteDescription: string;
  ebayTitle: string;
  ebayDescription: string;
  ebayPrice: number;
  websitePrice: number;
  quantity: number;
  imageUrls: string[];
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber: string;
  aspects: Record<string, string[]>;
  bestOfferEnabled: boolean;
  generated: DualMarketplaceListingDraft;
  pricing: ReturnType<typeof calculateCustomWebsitePricing>;
};

class ExternalPublishReconciliationError extends Error {
  constructor(
    message: string,
    readonly channel: "website" | "ebay",
    readonly externalResult?: EbayInventoryPublishResult,
  ) {
    super(message);
    this.name = "ExternalPublishReconciliationError";
  }
}

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown, maximum: number) {
  const result = cleanText(value);
  return result ? result.slice(0, maximum) : null;
}

function incomingText(
  incoming: IncomingListing,
  key: keyof IncomingListing,
  fallback: string,
) {
  return hasOwn(incoming, key) ? cleanText(incoming[key]) : fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return Math.max(0, Math.round(numberValue(value) * 100) / 100);
}

function quantity(value: unknown) {
  return Math.max(0, Math.floor(numberValue(value)));
}

function chunk<T>(values: T[], size = 100) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function envRate(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
}

function envMoney(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function feeProfileFromEnvironment() {
  return normalizeDualMarketplaceFeeProfile({
    ebayPercent: envRate("TCOS_EBAY_FEE_PERCENT", 0.1325),
    ebayFixed: envMoney("TCOS_EBAY_FIXED_FEE", 0.4),
    ebayFixedUnderTen: envMoney("TCOS_EBAY_FIXED_FEE_UNDER_10", 0.3),
    promotedPercent: envRate("TCOS_EBAY_PROMOTED_PERCENT", 0),
    websitePercent: envRate("TCOS_WEBSITE_PROCESSING_PERCENT", 0.029),
    websiteFixed: envMoney("TCOS_WEBSITE_FIXED_FEE", 0.3),
    minimumWebsiteDiscountPercent: envRate(
      "TCOS_MINIMUM_WEBSITE_DISCOUNT_PERCENT",
      0.03,
    ),
    websitePriceEnding: envMoney("TCOS_WEBSITE_PRICE_ENDING", 0.99),
  });
}

function isInstaCompListing(row: InventoryRow) {
  const metadata = record(row.metadata);
  return Boolean(
    Object.keys(record(metadata.instacomp)).length ||
      Object.keys(record(metadata.dual_marketplace)).length,
  );
}

function normalizeIncomingAspects(value: unknown) {
  const input = record(value);
  const output: Record<string, string[]> = {};

  for (const [rawName, rawValues] of Object.entries(input)) {
    const name = cleanText(rawName);
    if (!name) continue;
    const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .map(cleanText)
      .filter(Boolean);
    if (values.length) output[name] = Array.from(new Set(values));
  }

  return output;
}

function imageUrlsForItem(params: {
  product: ProductRow | null;
  images: InventoryImageRow[];
  metadata: UnknownRecord;
}) {
  const instacomp = record(params.metadata.instacomp);
  const urls = [
    params.product?.image_url,
    nullableText(instacomp.frontImageUrl, 2_000),
    nullableText(instacomp.backImageUrl, 2_000),
    ...params.images
      .slice()
      .sort((left, right) => {
        if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
          return left.is_primary ? -1 : 1;
        }
        return Number(left.sort_order || 0) - Number(right.sort_order || 0);
      })
      .map((image) => image.image_url),
  ]
    .map((value) => nullableText(value, 2_000))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(urls)).slice(0, 24);
}

function dualMetadata(row: InventoryRow) {
  return record(record(row.metadata).dual_marketplace);
}

function statusFromDual(dual: UnknownRecord, channel: "website" | "ebay") {
  return nullableText(record(dual[channel]).status, 40) || "draft";
}

function mapListingRow(params: {
  inventory: InventoryRow;
  product: ProductRow | null;
  images: InventoryImageRow[];
  feeProfile: DualMarketplaceFeeProfile;
}) {
  const metadata = record(params.inventory.metadata);
  const dual = dualMetadata(params.inventory);
  const website = record(dual.website);
  const ebay = record(dual.ebay);
  const generated = createDualMarketplaceListingDraft({
    title: params.inventory.title,
    description: params.inventory.description,
    category: params.inventory.category,
    condition: params.inventory.condition,
    metadata,
  });
  const ebayPrice = money(
    ebay.price ?? record(metadata.instacomp).listingPrice ?? params.inventory.price,
  );
  const calculated = calculateDualMarketplacePricing(ebayPrice, params.feeProfile);
  const storedWebsitePrice = money(website.price);
  const websitePrice =
    storedWebsitePrice > 0 ? storedWebsitePrice : calculated.websitePrice;
  const pricing = calculateCustomWebsitePricing(
    ebayPrice,
    websitePrice,
    params.feeProfile,
  );
  const imageUrls = imageUrlsForItem({
    product: params.product,
    images: params.images,
    metadata,
  });
  const websiteTitle =
    hasOwn(website, "title") ? cleanText(website.title) : generated.websiteTitle;
  const websiteDescription = hasOwn(website, "description")
    ? cleanText(website.description)
    : generated.websiteDescription;
  const ebayTitle =
    hasOwn(ebay, "title") ? cleanText(ebay.title) : generated.ebayTitle;
  const ebayDescription = hasOwn(ebay, "description")
    ? cleanText(ebay.description)
    : generated.ebayDescription;
  const ebayCategoryId = hasOwn(ebay, "categoryId")
    ? cleanText(ebay.categoryId)
    : generated.ebayCategoryId;
  const ebayCondition =
    String(ebay.condition) === "LIKE_NEW"
      ? "LIKE_NEW"
      : String(ebay.condition) === "USED_VERY_GOOD"
        ? "USED_VERY_GOOD"
        : generated.ebayCondition;
  const cardCondition = hasOwn(ebay, "cardCondition")
    ? cleanText(ebay.cardCondition)
    : generated.cardCondition;
  const grader = hasOwn(ebay, "grader")
    ? cleanText(ebay.grader)
    : generated.grader;
  const grade = hasOwn(ebay, "grade") ? cleanText(ebay.grade) : generated.grade;
  const certificationNumber = hasOwn(ebay, "certificationNumber")
    ? cleanText(ebay.certificationNumber)
    : generated.certificationNumber;
  const aspects = hasOwn(ebay, "aspects")
    ? normalizeIncomingAspects(ebay.aspects)
    : generated.aspects;
  const rowQuantity = quantity(params.inventory.quantity);
  const readinessInput = {
    sku: nullableText(params.inventory.sku, 120),
    websiteTitle,
    websiteDescription,
    websitePrice,
    ebayTitle,
    ebayDescription,
    ebayPrice,
    quantity: rowQuantity,
    imageUrls,
    ebayCategoryId,
    ebayCondition,
    grader,
    grade,
    cardCondition,
    aspects,
  };
  const readiness = dualMarketplaceReadinessErrors(readinessInput);
  readiness.ebay.push(...ebayListingContentProblems(ebayDescription));
  const websiteStatus =
    params.inventory.status === "active"
      ? "active"
      : statusFromDual(dual, "website");
  let ebayStatus = statusFromDual(dual, "ebay");
  if (ebayStatus === "draft" && params.product?.ebay_item_id) ebayStatus = "linked";
  const websiteError = nullableText(record(website).lastError, 1_000);
  const ebayError = nullableText(record(ebay).lastError, 1_000);

  return {
    inventoryItemId: params.inventory.id,
    legacyProductId: params.inventory.legacy_product_id,
    sku: params.inventory.sku,
    inventoryStatus: params.inventory.status,
    websiteStatus,
    ebayStatus,
    ebayItemId:
      params.product?.ebay_item_id || nullableText(ebay.listingId, 120),
    ebayOfferId: nullableText(ebay.offerId, 120),
    websiteTitle,
    websiteDescription,
    ebayTitle,
    ebayDescription,
    ebayPrice,
    websitePrice,
    quantity: rowQuantity,
    imageUrls,
    ebayCategoryId,
    ebayCondition,
    cardCondition,
    grader,
    grade,
    certificationNumber,
    aspects,
    bestOfferEnabled: ebay.bestOfferEnabled === true,
    pricing,
    generated,
    readyWebsite:
      readiness.structure.length === 0 && readiness.website.length === 0,
    readyEbay:
      readiness.structure.length === 0 && readiness.ebay.length === 0,
    websiteProblems: [...readiness.structure, ...readiness.website],
    ebayProblems: [...readiness.structure, ...readiness.ebay],
    lastError: ebayError || websiteError,
    createdAt: params.inventory.created_at,
    updatedAt: params.inventory.updated_at,
  };
}

async function readAdminInventoryRows(inventoryItemIds?: string[]) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();

  if (inventoryItemIds?.length) {
    const rows: InventoryRow[] = [];
    for (const idBatch of chunk(Array.from(new Set(inventoryItemIds)), 100)) {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
        )
        .eq("store_id", storeId)
        .is("seller_account_id", null)
        .in("id", idBatch);
      if (error) throw error;
      rows.push(...((data || []) as InventoryRow[]));
    }
    return rows;
  }

  const matched: InventoryRow[] = [];
  const pageSize = 500;

  for (let page = 0; page < 20 && matched.length < MAX_DUAL_MARKETPLACE_SELECTION; page += 1) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as InventoryRow[];
    matched.push(...batch.filter(isInstaCompListing));
    if (batch.length < pageSize) break;
  }

  return matched.slice(0, MAX_DUAL_MARKETPLACE_SELECTION);
}

async function loadListingData(inventoryItemIds?: string[]) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const inventoryRows = await readAdminInventoryRows(inventoryItemIds);
  const productsById = new Map<number, ProductRow>();
  const legacyProductIds = Array.from(
    new Set(
      inventoryRows
        .map((row) => Number(row.legacy_product_id || 0))
        .filter((id) => id > 0),
    ),
  );

  for (const idBatch of chunk(legacyProductIds, 100)) {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id,seller_account_id,sku,title,description,player,sport,price,quantity,image_url,ebay_item_id,last_seen_at",
      )
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .in("id", idBatch);
    if (error) throw error;
    for (const product of (data || []) as ProductRow[]) {
      productsById.set(Number(product.id), product);
    }
  }

  const imagesByInventoryId = new Map<string, InventoryImageRow[]>();
  for (const idBatch of chunk(inventoryRows.map((row) => row.id), 100)) {
    const { data, error } = await supabase
      .from("inventory_images")
      .select("inventory_item_id,image_url,sort_order,is_primary")
      .in("inventory_item_id", idBatch)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    for (const image of (data || []) as InventoryImageRow[]) {
      const current = imagesByInventoryId.get(image.inventory_item_id) || [];
      current.push(image);
      imagesByInventoryId.set(image.inventory_item_id, current);
    }
  }

  return { inventoryRows, productsById, imagesByInventoryId };
}

function incomingByInventoryId(items: IncomingListing[]) {
  const map = new Map<string, IncomingListing>();
  for (const item of items) {
    const id = nullableText(item.inventoryItemId, 80);
    if (id) map.set(id, item);
  }
  return map;
}

function prepareListing(params: {
  inventory: InventoryRow;
  product: ProductRow | null;
  images: InventoryImageRow[];
  incoming: IncomingListing;
  feeProfile: DualMarketplaceFeeProfile;
}): PreparedListing {
  const base = mapListingRow({
    inventory: params.inventory,
    product: params.product,
    images: params.images,
    feeProfile: params.feeProfile,
  });
  const ebayPrice = hasOwn(params.incoming, "ebayPrice")
    ? money(params.incoming.ebayPrice)
    : base.ebayPrice;
  const websitePrice = hasOwn(params.incoming, "websitePrice")
    ? money(params.incoming.websitePrice)
    : base.websitePrice;
  const rowQuantity = hasOwn(params.incoming, "quantity")
    ? quantity(params.incoming.quantity)
    : base.quantity;
  const websiteTitle = incomingText(
    params.incoming,
    "websiteTitle",
    base.websiteTitle,
  );
  const websiteDescription = incomingText(
    params.incoming,
    "websiteDescription",
    base.websiteDescription,
  );
  const ebayTitle = incomingText(params.incoming, "ebayTitle", base.ebayTitle);
  const ebayDescription = incomingText(
    params.incoming,
    "ebayDescription",
    base.ebayDescription,
  );
  const ebayCategoryId = incomingText(
    params.incoming,
    "ebayCategoryId",
    base.ebayCategoryId,
  );
  const ebayCondition =
    String(params.incoming.ebayCondition) === "LIKE_NEW"
      ? "LIKE_NEW"
      : String(params.incoming.ebayCondition) === "USED_VERY_GOOD"
        ? "USED_VERY_GOOD"
        : base.ebayCondition;
  const cardCondition = incomingText(
    params.incoming,
    "cardCondition",
    base.cardCondition,
  );
  const grader = incomingText(params.incoming, "grader", base.grader);
  const grade = incomingText(params.incoming, "grade", base.grade);
  const certificationNumber = incomingText(
    params.incoming,
    "certificationNumber",
    base.certificationNumber,
  );
  const aspects = hasOwn(params.incoming, "aspects")
    ? normalizeIncomingAspects(params.incoming.aspects)
    : base.aspects;
  const bestOfferEnabled = hasOwn(params.incoming, "bestOfferEnabled")
    ? params.incoming.bestOfferEnabled === true
    : base.bestOfferEnabled;
  const pricing = calculateCustomWebsitePricing(
    ebayPrice,
    websitePrice,
    params.feeProfile,
  );
  const metadata = record(params.inventory.metadata);
  const previousDual = record(metadata.dual_marketplace);
  const now = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    dual_marketplace: {
      ...previousDual,
      schema: "tcos.dualMarketplaceListing.v2",
      pricing: {
        ...pricing,
        feeProfile: params.feeProfile,
        itemPriceOnlyEstimate: true,
        calculatedAt: now,
      },
      website: {
        ...record(previousDual.website),
        title: websiteTitle,
        description: websiteDescription,
        price: websitePrice,
        status: statusFromDual(previousDual, "website"),
      },
      ebay: {
        ...record(previousDual.ebay),
        title: ebayTitle,
        description: ebayDescription,
        price: ebayPrice,
        categoryId: ebayCategoryId,
        condition: ebayCondition,
        cardCondition,
        grader,
        grade,
        certificationNumber,
        aspects,
        bestOfferEnabled,
        status: statusFromDual(previousDual, "ebay"),
      },
      updatedAt: now,
    },
  };

  return {
    inventory: params.inventory,
    product: params.product,
    metadata: nextMetadata,
    websiteTitle,
    websiteDescription,
    ebayTitle,
    ebayDescription,
    ebayPrice,
    websitePrice,
    quantity: rowQuantity,
    imageUrls: base.imageUrls,
    ebayCategoryId,
    ebayCondition,
    cardCondition,
    grader,
    grade,
    certificationNumber,
    aspects,
    bestOfferEnabled,
    generated: base.generated,
    pricing,
  };
}

function readinessInput(prepared: PreparedListing) {
  return {
    sku: nullableText(prepared.inventory.sku, 120),
    websiteTitle: prepared.websiteTitle,
    websiteDescription: prepared.websiteDescription,
    websitePrice: prepared.websitePrice,
    ebayTitle: prepared.ebayTitle,
    ebayDescription: prepared.ebayDescription,
    ebayPrice: prepared.ebayPrice,
    quantity: prepared.quantity,
    imageUrls: prepared.imageUrls,
    ebayCategoryId: prepared.ebayCategoryId,
    ebayCondition: prepared.ebayCondition,
    grader: prepared.grader,
    grade: prepared.grade,
    cardCondition: prepared.cardCondition,
    aspects: prepared.aspects,
  };
}

async function saveDraftMetadata(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  prepared: PreparedListing;
}) {
  const { error } = await params.supabase
    .from("inventory_items")
    .update({
      metadata: params.prepared.metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.prepared.inventory.id);
  if (error) throw error;
}

async function updateChannelMetadata(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  prepared: PreparedListing;
  website?: UnknownRecord;
  ebay?: UnknownRecord;
}) {
  const metadata = record(params.prepared.metadata);
  const dual = record(metadata.dual_marketplace);
  const nextMetadata = {
    ...metadata,
    dual_marketplace: {
      ...dual,
      website: {
        ...record(dual.website),
        ...(params.website || {}),
      },
      ebay: {
        ...record(dual.ebay),
        ...(params.ebay || {}),
      },
      updatedAt: new Date().toISOString(),
    },
  };
  const { error } = await params.supabase
    .from("inventory_items")
    .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.prepared.inventory.id);
  if (error) throw error;
  params.prepared.metadata = nextMetadata;
}

async function activateWebsite(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  prepared: PreparedListing;
}) {
  const now = new Date().toISOString();
  await updateChannelMetadata({
    ...params,
    website: { status: "publishing", startedAt: now, lastError: null },
  });

  const { error: inventoryError } = await params.supabase
    .from("inventory_items")
    .update({
      title: params.prepared.websiteTitle,
      description: params.prepared.websiteDescription,
      status: "active",
      quantity: params.prepared.quantity,
      price: params.prepared.websitePrice,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.prepared.inventory.id);
  if (inventoryError) throw inventoryError;

  if (params.prepared.inventory.legacy_product_id) {
    const { error: productError } = await params.supabase
      .from("products")
      .update({
        title: params.prepared.websiteTitle,
        description: params.prepared.websiteDescription,
        player: params.prepared.generated.identity.player,
        sport: params.prepared.generated.identity.sport,
        price: params.prepared.websitePrice,
        quantity: params.prepared.quantity,
        image_url: params.prepared.imageUrls[0] || null,
      })
      .eq("store_id", params.storeId)
      .is("seller_account_id", null)
      .eq("id", params.prepared.inventory.legacy_product_id);

    if (productError) {
      await updateChannelMetadata({
        ...params,
        website: {
          status: "reconciliation_required",
          publishedAt: now,
          lastError: `Website is active, but the legacy product mirror failed: ${productError.message}`,
        },
      }).catch(() => undefined);
      throw new ExternalPublishReconciliationError(
        "Website inventory is active, but TCOS could not reconcile the legacy product mirror.",
        "website",
      );
    }
  }

  await updateChannelMetadata({
    ...params,
    website: { status: "active", publishedAt: now, lastError: null },
  });
}

async function publishEbay(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  prepared: PreparedListing;
}) {
  const sku = nullableText(params.prepared.inventory.sku, 120);
  if (!sku) throw new Error("SKU is required before publishing to eBay.");

  await updateChannelMetadata({
    ...params,
    ebay: {
      status: "publishing",
      startedAt: new Date().toISOString(),
      lastError: null,
    },
  });

  let result: EbayInventoryPublishResult;
  try {
    result = await publishEbayInventoryItem({
      supabase: params.supabase,
      storeId: params.storeId,
      item: {
        sku,
        title: params.prepared.ebayTitle,
        description: params.prepared.ebayDescription,
        quantity: params.prepared.quantity,
        price: params.prepared.ebayPrice,
        imageUrls: params.prepared.imageUrls,
        aspects: params.prepared.aspects,
        categoryId: params.prepared.ebayCategoryId,
        condition: params.prepared.ebayCondition,
        cardCondition: params.prepared.cardCondition,
        grader: params.prepared.grader,
        grade: params.prepared.grade,
        certificationNumber: params.prepared.certificationNumber,
        bestOfferEnabled: params.prepared.bestOfferEnabled,
      },
    });
  } catch (error: any) {
    await updateChannelMetadata({
      ...params,
      ebay: {
        status: "error",
        lastError: error?.message || "eBay publishing failed.",
        failedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    throw error;
  }

  const now = new Date().toISOString();
  try {
    await updateChannelMetadata({
      ...params,
      ebay: {
        status: "active",
        listingId: result.listingId,
        offerId: result.offerId,
        publishedAt: now,
        warnings: result.warnings,
        lastError: null,
      },
    });
  } catch (metadataError: any) {
    throw new ExternalPublishReconciliationError(
      `eBay listing ${result.listingId} is live, but TCOS could not save its reconciliation metadata: ${metadataError?.message || "unknown database error"}`,
      "ebay",
      result,
    );
  }

  if (params.prepared.inventory.legacy_product_id) {
    const { error: productError } = await params.supabase
      .from("products")
      .update({ ebay_item_id: result.listingId, last_seen_at: now })
      .eq("store_id", params.storeId)
      .is("seller_account_id", null)
      .eq("id", params.prepared.inventory.legacy_product_id);

    if (productError) {
      await updateChannelMetadata({
        ...params,
        ebay: {
          status: "reconciliation_required",
          listingId: result.listingId,
          offerId: result.offerId,
          publishedAt: now,
          warnings: result.warnings,
          lastError: `eBay is live, but the legacy product mirror failed: ${productError.message}`,
        },
      }).catch(() => undefined);
      throw new ExternalPublishReconciliationError(
        `eBay listing ${result.listingId} is live, but TCOS could not reconcile the legacy product mirror.`,
        "ebay",
        result,
      );
    }
  }

  return result;
}

export async function handleDualMarketplaceGet(request: Request) {
  try {
    const url = new URL(request.url);
    const includeReadiness = url.searchParams.get("includeReadiness") !== "0";
    const feeProfile = feeProfileFromEnvironment();
    const storeId = getActiveStoreId();
    const data = await loadListingData();
    const rows = data.inventoryRows.map((inventory) =>
      mapListingRow({
        inventory,
        product: inventory.legacy_product_id
          ? data.productsById.get(Number(inventory.legacy_product_id)) || null
          : null,
        images: data.imagesByInventoryId.get(inventory.id) || [],
        feeProfile,
      }),
    );
    const ebayReadiness = includeReadiness
      ? await getEbayPublishingReadiness({
          supabase: getSupabaseClient(),
          storeId,
        })
      : null;

    return Response.json({
      success: true,
      rows,
      feeProfile,
      ebayReadiness,
      summary: {
        total: rows.length,
        readyWebsite: rows.filter((row) => row.readyWebsite).length,
        readyEbay: rows.filter((row) => row.readyEbay).length,
        websiteActive: rows.filter((row) => row.websiteStatus === "active").length,
        ebayActive: rows.filter((row) => row.ebayStatus === "active").length,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        error: error?.message || "Could not load dual-marketplace listings.",
      },
      { status: 500 },
    );
  }
}

export async function handleDualMarketplacePost(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "") as DualMarketplaceAction;
  const rawItems = Array.isArray(body.items) ? (body.items as IncomingListing[]) : [];

  if (!["save", "publish-website", "publish-ebay", "publish-both"].includes(action)) {
    return Response.json(
      { success: false, error: "Unsupported dual-marketplace action." },
      { status: 400 },
    );
  }
  if (!rawItems.length) {
    return Response.json(
      { success: false, error: "Select at least one listing." },
      { status: 400 },
    );
  }
  if (rawItems.length > MAX_DUAL_MARKETPLACE_REQUEST_ITEMS) {
    return Response.json(
      {
        success: false,
        error: `This request contains ${rawItems.length} listings; the safe per-request limit is ${MAX_DUAL_MARKETPLACE_REQUEST_ITEMS}. The listing studio automatically sends larger selections in complete batches.`,
      },
      { status: 413 },
    );
  }

  const inputById = incomingByInventoryId(rawItems);
  const ids = Array.from(inputById.keys());
  const feeProfile = feeProfileFromEnvironment();
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const results: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];

  try {
    const data = await loadListingData(ids);
    const inventoryById = new Map(data.inventoryRows.map((row) => [row.id, row]));

    for (const id of ids) {
      const inventory = inventoryById.get(id);
      const incoming = inputById.get(id);

      if (!inventory || !incoming) {
        errors.push({ inventoryItemId: id, error: "Admin-owned listing was not found." });
        continue;
      }

      let prepared: PreparedListing;
      try {
        prepared = prepareListing({
          inventory,
          product: inventory.legacy_product_id
            ? data.productsById.get(Number(inventory.legacy_product_id)) || null
            : null,
          images: data.imagesByInventoryId.get(inventory.id) || [],
          incoming,
          feeProfile,
        });
        await saveDraftMetadata({ supabase, storeId, prepared });
      } catch (error: any) {
        errors.push({
          inventoryItemId: id,
          title: inventory.title,
          saved: false,
          error: error?.message || "Listing edits could not be saved.",
        });
        continue;
      }

      const validationErrors = validateDualMarketplaceAction(
        action,
        readinessInput(prepared),
      );
      if (action === "publish-ebay" || action === "publish-both") {
        validationErrors.push(...ebayListingContentProblems(prepared.ebayDescription));
      }

      if (validationErrors.length) {
        errors.push({
          inventoryItemId: id,
          title: inventory.title,
          saved: true,
          error: Array.from(new Set(validationErrors)).join("; "),
        });
        continue;
      }

      try {
        let ebayResult: EbayInventoryPublishResult | null = null;
        if (action === "publish-ebay" || action === "publish-both") {
          ebayResult = await publishEbay({ supabase, storeId, prepared });
        }
        if (action === "publish-website" || action === "publish-both") {
          await activateWebsite({ supabase, storeId, prepared });
        }

        results.push({
          inventoryItemId: id,
          action,
          saved: true,
          websitePublished:
            action === "publish-website" || action === "publish-both",
          ebayPublished: Boolean(ebayResult),
          ebayListingId: ebayResult?.listingId || null,
          ebayOfferId: ebayResult?.offerId || null,
          websitePrice: prepared.websitePrice,
          ebayPrice: prepared.ebayPrice,
        });
      } catch (error: any) {
        const reconciliation =
          error instanceof ExternalPublishReconciliationError ? error : null;
        errors.push({
          inventoryItemId: id,
          title: inventory.title,
          saved: true,
          externalPublished: Boolean(reconciliation?.externalResult),
          channel: reconciliation?.channel || null,
          ebayListingId: reconciliation?.externalResult?.listingId || null,
          ebayOfferId: reconciliation?.externalResult?.offerId || null,
          error: error?.message || "Listing action failed.",
        });
      }
    }

    return Response.json(
      {
        success: errors.length === 0,
        action,
        resultCount: results.length,
        errorCount: errors.length,
        results,
        errors,
        message:
          errors.length > 0
            ? `${results.length} listing${results.length === 1 ? "" : "s"} completed; ${errors.length} need review.`
            : `${results.length} listing${results.length === 1 ? "" : "s"} completed successfully.`,
      },
      { status: errors.length === ids.length ? 400 : 200 },
    );
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        error: error?.message || "Dual-marketplace listing action failed.",
      },
      { status: 500 },
    );
  }
}
