import {
  calculateDualMarketplacePricing,
  normalizeDualMarketplaceFeeProfile,
  type DualMarketplaceFeeProfile,
} from "../../../../lib/dual-marketplace-pricing";
import {
  createDualMarketplaceListingDraft,
  type DualMarketplaceListingDraft,
} from "../../../../lib/dual-marketplace-listing";
import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem,
} from "../../../../lib/ebay-inventory-publisher";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

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

type ListingAction =
  | "save"
  | "publish-website"
  | "publish-ebay"
  | "publish-both";

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
  pricing: ReturnType<typeof calculateDualMarketplacePricing>;
  feeProfile: DualMarketplaceFeeProfile;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function cleanText(value: unknown, maximum = 100_000) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, maximum) : null;
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

function normalizedAspects(value: unknown) {
  const input = record(value);
  const output: Record<string, string[]> = {};

  for (const [name, values] of Object.entries(input)) {
    const cleanName = cleanText(name, 65);
    const cleanValues = (Array.isArray(values) ? values : [values])
      .map((entry) => cleanText(entry, 65))
      .filter((entry): entry is string => Boolean(entry));

    if (cleanName && cleanValues.length) {
      output[cleanName] = Array.from(new Set(cleanValues));
    }
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
    cleanText(instacomp.frontImageUrl, 2_000),
    cleanText(instacomp.backImageUrl, 2_000),
    ...params.images
      .slice()
      .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
      .map((image) => image.image_url),
  ]
    .map((value) => cleanText(value, 2_000))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(urls)).slice(0, 24);
}

function dualMetadata(row: InventoryRow) {
  return record(record(row.metadata).dual_marketplace);
}

function statusFromDual(dual: UnknownRecord, channel: "website" | "ebay") {
  const channelData = record(dual[channel]);
  return cleanText(channelData.status, 40) || "draft";
}

function readinessErrors(params: {
  sku: string | null;
  websiteTitle: string;
  websiteDescription: string;
  websitePrice: number;
  ebayTitle: string;
  ebayDescription: string;
  ebayPrice: number;
  quantity: number;
  imageUrls: string[];
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  grader: string;
  grade: string;
  cardCondition: string;
}) {
  const website: string[] = [];
  const ebay: string[] = [];

  if (!params.websiteTitle) website.push("website title is missing");
  if (!params.websiteDescription) website.push("website description is missing");
  if (params.websitePrice <= 0) website.push("website price is missing");
  if (params.quantity < 1) website.push("quantity must be at least 1");
  if (!params.imageUrls.length) website.push("card image is missing");

  if (!params.sku) ebay.push("SKU is missing");
  if (!params.ebayTitle) ebay.push("eBay title is missing");
  if (params.ebayTitle.length > 80) ebay.push("eBay title is over 80 characters");
  if (!params.ebayDescription) ebay.push("eBay description is missing");
  if (params.ebayPrice <= 0) ebay.push("eBay price is missing");
  if (params.quantity < 1) ebay.push("quantity must be at least 1");
  if (!params.imageUrls.length) ebay.push("card image is missing");
  if (!params.ebayCategoryId) ebay.push("eBay category is missing");
  if (params.ebayCondition === "LIKE_NEW" && (!params.grader || !params.grade)) {
    ebay.push("graded cards require grader and grade");
  }
  if (params.ebayCondition === "USED_VERY_GOOD" && !params.cardCondition) {
    ebay.push("raw cards require Card Condition");
  }

  return { website, ebay };
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
  const calculatedPricing = calculateDualMarketplacePricing(
    ebayPrice,
    params.feeProfile,
  );
  const storedWebsitePrice = money(website.price);
  const websitePrice =
    storedWebsitePrice > 0 && storedWebsitePrice < ebayPrice
      ? storedWebsitePrice
      : calculatedPricing.websitePrice;
  const pricing =
    websitePrice === calculatedPricing.websitePrice
      ? calculatedPricing
      : {
          ...calculatedPricing,
          websitePrice,
          websiteEstimatedFees: Math.round(
            (websitePrice * params.feeProfile.websitePercent +
              params.feeProfile.websiteFixed) *
              100,
          ) / 100,
          websiteEstimatedNet: Math.round(
            (websitePrice -
              (websitePrice * params.feeProfile.websitePercent +
                params.feeProfile.websiteFixed)) *
              100,
          ) / 100,
          customerSavings: Math.round((ebayPrice - websitePrice) * 100) / 100,
          customerSavingsPercent:
            ebayPrice > 0
              ? Math.round(((ebayPrice - websitePrice) / ebayPrice) * 10_000) / 100
              : 0,
        };
  const imageUrls = imageUrlsForItem({
    product: params.product,
    images: params.images,
    metadata,
  });
  const websiteTitle =
    cleanText(website.title, 200) || generated.websiteTitle;
  const websiteDescription =
    cleanText(website.description, 100_000) || generated.websiteDescription;
  const ebayTitle = cleanText(ebay.title, 80) || generated.ebayTitle;
  const ebayDescription =
    cleanText(ebay.description, 100_000) || generated.ebayDescription;
  const ebayCategoryId =
    cleanText(ebay.categoryId, 32) || generated.ebayCategoryId;
  const ebayCondition =
    String(ebay.condition) === "LIKE_NEW"
      ? "LIKE_NEW"
      : String(ebay.condition) === "USED_VERY_GOOD"
        ? "USED_VERY_GOOD"
        : generated.ebayCondition;
  const cardCondition =
    cleanText(ebay.cardCondition, 80) || generated.cardCondition;
  const grader = cleanText(ebay.grader, 120) || generated.grader;
  const grade = cleanText(ebay.grade, 40) || generated.grade;
  const certificationNumber =
    cleanText(ebay.certificationNumber, 30) || generated.certificationNumber;
  const aspects =
    Object.keys(normalizedAspects(ebay.aspects)).length > 0
      ? normalizedAspects(ebay.aspects)
      : generated.aspects;
  const rowQuantity = Math.max(1, quantity(params.inventory.quantity));
  const readiness = readinessErrors({
    sku: cleanText(params.inventory.sku, 120),
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
  });

  return {
    inventoryItemId: params.inventory.id,
    legacyProductId: params.inventory.legacy_product_id,
    sku: params.inventory.sku,
    inventoryStatus: params.inventory.status,
    websiteStatus: statusFromDual(dual, "website"),
    ebayStatus:
      params.product?.ebay_item_id || statusFromDual(dual, "ebay") === "active"
        ? "active"
        : statusFromDual(dual, "ebay"),
    ebayItemId: params.product?.ebay_item_id || cleanText(ebay.listingId, 120),
    ebayOfferId: cleanText(ebay.offerId, 120),
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
    readyWebsite: readiness.website.length === 0,
    readyEbay: readiness.ebay.length === 0,
    websiteProblems: readiness.website,
    ebayProblems: readiness.ebay,
    lastError: cleanText(ebay.lastError, 1_000),
    createdAt: params.inventory.created_at,
    updatedAt: params.inventory.updated_at,
  };
}

async function loadListingData(
  inventoryItemIds?: string[],
): Promise<{
  inventoryRows: InventoryRow[];
  productsById: Map<number, ProductRow>;
  imagesByInventoryId: Map<string, InventoryImageRow[]>;
}> {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  let query = supabase
    .from("inventory_items")
    .select(
      "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(inventoryItemIds?.length ? Math.min(500, inventoryItemIds.length) : 250);

  if (inventoryItemIds?.length) {
    query = query.in("id", inventoryItemIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const inventoryRows = ((data || []) as InventoryRow[]).filter((row) =>
    inventoryItemIds?.length ? true : isInstaCompListing(row),
  );
  const legacyProductIds = inventoryRows
    .map((row) => Number(row.legacy_product_id || 0))
    .filter((id) => id > 0);
  const productsById = new Map<number, ProductRow>();

  if (legacyProductIds.length) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select(
        "id,sku,title,description,player,sport,price,quantity,image_url,ebay_item_id,last_seen_at",
      )
      .eq("store_id", storeId)
      .in("id", legacyProductIds);

    if (productsError) throw productsError;
    for (const product of (products || []) as ProductRow[]) {
      productsById.set(Number(product.id), product);
    }
  }

  const imagesByInventoryId = new Map<string, InventoryImageRow[]>();
  const inventoryIds = inventoryRows.map((row) => row.id);

  if (inventoryIds.length) {
    const { data: images, error: imagesError } = await supabase
      .from("inventory_images")
      .select("inventory_item_id,image_url,sort_order,is_primary")
      .in("inventory_item_id", inventoryIds)
      .order("sort_order", { ascending: true });

    if (imagesError) throw imagesError;
    for (const image of (images || []) as InventoryImageRow[]) {
      const current = imagesByInventoryId.get(image.inventory_item_id) || [];
      current.push(image);
      imagesByInventoryId.set(image.inventory_item_id, current);
    }
  }

  return { inventoryRows, productsById, imagesByInventoryId };
}

function incomingByInventoryId(items: IncomingListing[]) {
  return new Map(
    items
      .map((item) => [cleanText(item.inventoryItemId, 80), item] as const)
      .filter((entry): entry is [string, IncomingListing] => Boolean(entry[0])),
  );
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
  const ebayPrice = money(params.incoming.ebayPrice ?? base.ebayPrice);
  const calculatedPricing = calculateDualMarketplacePricing(
    ebayPrice,
    params.feeProfile,
  );
  const requestedWebsitePrice = money(params.incoming.websitePrice);
  const websitePrice =
    requestedWebsitePrice > 0 && requestedWebsitePrice < ebayPrice
      ? requestedWebsitePrice
      : calculatedPricing.websitePrice;
  const websiteTitle =
    cleanText(params.incoming.websiteTitle, 200) || base.websiteTitle;
  const websiteDescription =
    cleanText(params.incoming.websiteDescription, 100_000) ||
    base.websiteDescription;
  const ebayTitle = cleanText(params.incoming.ebayTitle, 80) || base.ebayTitle;
  const ebayDescription =
    cleanText(params.incoming.ebayDescription, 100_000) || base.ebayDescription;
  const rowQuantity = Math.max(1, quantity(params.incoming.quantity ?? base.quantity));
  const ebayCategoryId =
    cleanText(params.incoming.ebayCategoryId, 32) || base.ebayCategoryId;
  const ebayCondition =
    String(params.incoming.ebayCondition) === "LIKE_NEW"
      ? "LIKE_NEW"
      : String(params.incoming.ebayCondition) === "USED_VERY_GOOD"
        ? "USED_VERY_GOOD"
        : base.ebayCondition;
  const cardCondition =
    cleanText(params.incoming.cardCondition, 80) || base.cardCondition;
  const grader = cleanText(params.incoming.grader, 120) || base.grader;
  const grade = cleanText(params.incoming.grade, 40) || base.grade;
  const certificationNumber =
    cleanText(params.incoming.certificationNumber, 30) || base.certificationNumber;
  const incomingAspects = normalizedAspects(params.incoming.aspects);
  const aspects =
    Object.keys(incomingAspects).length > 0 ? incomingAspects : base.aspects;
  const readiness = readinessErrors({
    sku: cleanText(params.inventory.sku, 120),
    websiteTitle,
    websiteDescription,
    websitePrice,
    ebayTitle,
    ebayDescription,
    ebayPrice,
    quantity: rowQuantity,
    imageUrls: base.imageUrls,
    ebayCategoryId,
    ebayCondition,
    grader,
    grade,
    cardCondition,
  });

  if (readiness.website.length || readiness.ebay.length) {
    throw new Error(
      [...readiness.website, ...readiness.ebay].filter((value, index, values) => values.indexOf(value) === index).join("; "),
    );
  }
  if (websitePrice >= ebayPrice) {
    throw new Error("Website price must remain lower than the eBay price.");
  }

  const metadata = record(params.inventory.metadata);
  const previousDual = record(metadata.dual_marketplace);
  const now = new Date().toISOString();
  const pricing = {
    ...calculatedPricing,
    websitePrice,
    websiteEstimatedFees:
      Math.round(
        (websitePrice * params.feeProfile.websitePercent +
          params.feeProfile.websiteFixed) *
          100,
      ) / 100,
  };
  pricing.websiteEstimatedNet =
    Math.round((websitePrice - pricing.websiteEstimatedFees) * 100) / 100;
  pricing.customerSavings = Math.round((ebayPrice - websitePrice) * 100) / 100;
  pricing.customerSavingsPercent =
    ebayPrice > 0
      ? Math.round(((ebayPrice - websitePrice) / ebayPrice) * 10_000) / 100
      : 0;
  pricing.netDifference =
    Math.round((pricing.websiteEstimatedNet - pricing.ebayEstimatedNet) * 100) / 100;
  const nextMetadata = {
    ...metadata,
    dual_marketplace: {
      ...previousDual,
      schema: "tcos.dualMarketplaceListing.v1",
      pricing: {
        ...pricing,
        feeProfile: params.feeProfile,
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
        bestOfferEnabled: params.incoming.bestOfferEnabled === true,
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
    bestOfferEnabled: params.incoming.bestOfferEnabled === true,
    generated: base.generated,
    pricing,
    feeProfile: params.feeProfile,
  };
}

async function savePreparedListing(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  prepared: PreparedListing;
}) {
  const now = new Date().toISOString();
  const { error: inventoryError } = await params.supabase
    .from("inventory_items")
    .update({
      title: params.prepared.websiteTitle,
      description: params.prepared.websiteDescription,
      price: params.prepared.websitePrice,
      quantity: params.prepared.quantity,
      metadata: params.prepared.metadata,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("id", params.prepared.inventory.id);

  if (inventoryError) throw inventoryError;

  if (params.prepared.inventory.legacy_product_id) {
    const { error: productError } = await params.supabase
      .from("products")
      .update({
        sku: params.prepared.inventory.sku,
        title: params.prepared.websiteTitle,
        description: params.prepared.websiteDescription,
        player: params.prepared.generated.identity.player,
        sport: params.prepared.generated.identity.sport,
        price: params.prepared.websitePrice,
        quantity: params.prepared.quantity,
        image_url: params.prepared.imageUrls[0] || null,
        last_seen_at: now,
      })
      .eq("store_id", params.storeId)
      .eq("id", params.prepared.inventory.legacy_product_id);

    if (productError) throw productError;
  }
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
    .update({
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", params.storeId)
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
  const { error } = await params.supabase
    .from("inventory_items")
    .update({
      status: "active",
      quantity: params.prepared.quantity,
      price: params.prepared.websitePrice,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("id", params.prepared.inventory.id);

  if (error) throw error;
  await updateChannelMetadata({
    ...params,
    website: {
      status: "active",
      publishedAt: now,
      lastError: null,
    },
  });
}

async function publishEbay(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  prepared: PreparedListing;
}) {
  const sku = cleanText(params.prepared.inventory.sku, 120);
  if (!sku) throw new Error("SKU is required before publishing to eBay.");

  try {
    const result = await publishEbayInventoryItem({
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
    const now = new Date().toISOString();

    if (params.prepared.inventory.legacy_product_id) {
      const { error } = await params.supabase
        .from("products")
        .update({
          ebay_item_id: result.listingId,
          last_seen_at: now,
        })
        .eq("store_id", params.storeId)
        .eq("id", params.prepared.inventory.legacy_product_id);

      if (error) throw error;
    }

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

    return result;
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
}

export async function GET(request: Request) {
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "") as ListingAction;
  const items = Array.isArray(body.items)
    ? (body.items as IncomingListing[]).slice(0, 100)
    : [];

  if (![
    "save",
    "publish-website",
    "publish-ebay",
    "publish-both",
  ].includes(action)) {
    return Response.json(
      { success: false, error: "Unsupported dual-marketplace action." },
      { status: 400 },
    );
  }
  if (!items.length) {
    return Response.json(
      { success: false, error: "Select at least one listing." },
      { status: 400 },
    );
  }

  const ids = items
    .map((item) => cleanText(item.inventoryItemId, 80))
    .filter((id): id is string => Boolean(id));
  const inputById = incomingByInventoryId(items);
  const feeProfile = feeProfileFromEnvironment();
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const results: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];

  try {
    const data = await loadListingData(ids);
    const inventoryById = new Map(
      data.inventoryRows.map((row) => [row.id, row]),
    );

    for (const id of ids) {
      const inventory = inventoryById.get(id);
      const incoming = inputById.get(id);

      if (!inventory || !incoming) {
        errors.push({ inventoryItemId: id, error: "Listing was not found." });
        continue;
      }

      try {
        const prepared = prepareListing({
          inventory,
          product: inventory.legacy_product_id
            ? data.productsById.get(Number(inventory.legacy_product_id)) || null
            : null,
          images: data.imagesByInventoryId.get(inventory.id) || [],
          incoming,
          feeProfile,
        });
        await savePreparedListing({ supabase, storeId, prepared });
        let ebayResult: Awaited<ReturnType<typeof publishEbay>> | null = null;

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
        errors.push({
          inventoryItemId: id,
          title: inventory.title,
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
      { status: errors.length === items.length ? 400 : 200 },
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
