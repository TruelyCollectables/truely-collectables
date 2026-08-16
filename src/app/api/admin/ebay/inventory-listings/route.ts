import { NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
} from "../../../../../lib/instacomp-job-server";
import {
  saveOrPublishEbayListing,
  type EbayListingFormat,
  type EbayPublisherAction,
} from "../../../../../lib/ebay-publisher";
import {
  createMissingEbayOffer,
  isMissingEbayOfferLookupError,
} from "../../../../../lib/ebay-publisher-missing-offer";
import {
  deriveListingChannel,
  recommendedEbayPrice,
} from "../../../../../lib/listing-channels";
import {
  InventoryEngine,
  InventoryRepository,
  type InventoryItem,
} from "../../../../../modules/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SPORTS_CARD_CATEGORY_ID = "261328";
const CCG_CATEGORY_ID = "183454";
const MAX_PRODUCTS = 1500;

type StoredEbaySettings = {
  prepared?: boolean;
  price?: number | null;
  title?: string | null;
  description_override?: string | null;
  category_id?: string | null;
  format?: EbayListingFormat | null;
  offer_id?: string | null;
  listing_id?: string | null;
  state?: "prepared" | "draft" | "published" | "error" | null;
  last_action_at?: string | null;
  last_error?: string | null;
};

function text(value: unknown, max = 4000) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function wholeQuantity(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function savedSettings(metadata: unknown): StoredEbaySettings {
  const settings = record(record(metadata).ebay_listing);
  return {
    prepared: bool(settings.prepared),
    price: money(settings.price),
    title: text(settings.title, 80),
    description_override: text(settings.description_override, 10000),
    category_id: text(settings.category_id, 20),
    format:
      settings.format === "AUCTION" || settings.format === "FIXED_PRICE"
        ? settings.format
        : null,
    offer_id: text(settings.offer_id, 120),
    listing_id: text(settings.listing_id, 120),
    state:
      settings.state === "prepared" ||
      settings.state === "draft" ||
      settings.state === "published" ||
      settings.state === "error"
        ? settings.state
        : null,
    last_action_at: text(settings.last_action_at, 80),
    last_error: text(settings.last_error, 1000),
  };
}

function likelyCcg(product: any, inventory: InventoryItem | null) {
  const haystack = [
    product?.sport,
    product?.title,
    inventory?.category,
    inventory?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /pokemon|pokémon|trading card game|\btcg\b|magic: the gathering|\bmtg\b|yugioh|yu-gi-oh/.test(
    haystack,
  );
}

function defaultCategoryId(product: any, inventory: InventoryItem | null) {
  return likelyCcg(product, inventory) ? CCG_CATEGORY_ID : SPORTS_CARD_CATEGORY_ID;
}

function firstAccuracyAi(metadata: unknown) {
  const root = record(metadata);
  const scan = record(record(root.quick_list).scan);
  const candidates = [
    record(record(scan.passA).ai),
    record(record(scan.passB).ai),
    record(scan.ai),
  ];

  return candidates.find((candidate) => Object.keys(candidate).length > 0) || {};
}

function derivedAspects(product: any, inventory: InventoryItem | null) {
  const ai = firstAccuracyAi(inventory?.metadata);
  const aspects: Record<string, string[]> = {};
  const add = (name: string, value: unknown) => {
    const normalized = text(value, 65);
    if (normalized) aspects[name] = [normalized];
  };

  if (likelyCcg(product, inventory)) {
    add("Card Name", ai.player || product?.player);
    add("Set", ai.setName);
    add("Card Number", ai.cardNumber);
    add("Manufacturer", ai.brand);
    add("Year Manufactured", ai.year);
    add("Language", "English");
    if (ai.parallel && String(ai.parallel).toLowerCase() !== "base") {
      add("Features", ai.parallel);
    }
    return aspects;
  }

  add("Sport", ai.sport || product?.sport);
  add("Player/Athlete", ai.player || product?.player);
  add("Set", ai.setName);
  add("Card Number", ai.cardNumber);
  add("Manufacturer", ai.brand);
  add("Season", ai.year);
  add("Team", ai.team);
  add("Parallel/Variety", ai.parallel);
  add("Autographed", ai.isAuto === true ? "Yes" : "No");

  const features = [
    ai.isRookie ? "Rookie" : null,
    ai.isRelic ? "Memorabilia" : null,
    ai.serialNumber ? "Serial Numbered" : null,
  ].filter(Boolean) as string[];
  if (features.length) aspects.Features = features;

  return aspects;
}

function mergeAspects(
  base: Record<string, string[]>,
  supplied: unknown,
): Record<string, string[]> {
  const incoming = record(supplied);
  const cleaned = Object.fromEntries(
    Object.entries(incoming)
      .map(([name, values]) => {
        const normalizedValues = Array.isArray(values)
          ? values.map((value) => text(value, 65)).filter(Boolean)
          : [text(values, 65)].filter(Boolean);
        return [name.trim().slice(0, 65), normalizedValues];
      })
      .filter(([name, values]) => Boolean(name) && (values as string[]).length > 0),
  ) as Record<string, string[]>;

  return { ...base, ...cleaned };
}

function uniqueImages(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => text(value, 4000)).filter(Boolean) as string[]),
  );
}

async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "The inventory listing manager is restricted to the Truely Collectables administrator.",
      403,
      "EBAY_INVENTORY_ADMIN_REQUIRED",
    );
  }
  return actor;
}

async function productAndInventory(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  storeId: string;
  legacyProductId: number;
}) {
  const repository = new InventoryRepository(params.storeId, params.supabase);
  const [{ data: product, error: productError }, inventory] = await Promise.all([
    params.supabase
      .from("products")
      .select(
        "id,sku,title,description,player,sport,price,quantity,image_url,ebay_item_id,archived_at",
      )
      .eq("store_id", params.storeId)
      .eq("id", params.legacyProductId)
      .maybeSingle(),
    repository.getByLegacyProductId(params.legacyProductId),
  ]);

  if (productError) throw productError;
  if (!product) {
    throw new InstaCompJobServerError(
      "Product was not found.",
      404,
      "EBAY_INVENTORY_PRODUCT_NOT_FOUND",
    );
  }

  return { product, inventory, repository };
}

async function persistSettings(params: {
  repository: InventoryRepository;
  inventory: InventoryItem;
  patch: Partial<StoredEbaySettings>;
}) {
  const current = record(params.inventory.metadata);
  const next = {
    ...current,
    ebay_listing: {
      ...record(current.ebay_listing),
      ...params.patch,
    },
  };
  return params.repository.update(params.inventory.id, { metadata: next });
}

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const supabase = requireInstaCompJobSupabase();
    const repository = new InventoryRepository(actor.storeId, supabase);
    const [{ data: products, error: productsError }, inventoryItems] =
      await Promise.all([
        supabase
          .from("products")
          .select(
            "id,sku,title,description,player,sport,price,quantity,image_url,ebay_item_id,archived_at",
          )
          .eq("store_id", actor.storeId)
          .order("id", { ascending: false })
          .limit(MAX_PRODUCTS),
        repository.list({ limit: MAX_PRODUCTS }),
      ]);

    if (productsError) throw productsError;

    const inventoriesByProduct = new Map<number, InventoryItem[]>();
    for (const item of inventoryItems) {
      const id = Number(item.legacy_product_id || 0);
      if (!id) continue;
      const group = inventoriesByProduct.get(id) || [];
      group.push(item);
      inventoriesByProduct.set(id, group);
    }

    const rows = await Promise.all(
      (products || []).map(async (product: any) => {
        const choices = inventoriesByProduct.get(Number(product.id)) || [];
        const productSku = text(product.sku, 100);
        const inventory =
          (productSku
            ? choices.find((item) => text(item.sku, 100) === productSku)
            : null) || choices[0] || null;
        const images = inventory ? await repository.getImages(inventory.id) : [];
        const settings = savedSettings(inventory?.metadata);
        const sitePrice = money(product.price) || money(inventory?.price) || 0;
        const quantity = wholeQuantity(product.quantity ?? inventory?.quantity);
        const status =
          inventory?.status ||
          (product.archived_at ? "archived" : quantity > 0 ? "active" : "sold");
        const ebayPrice = settings.price || recommendedEbayPrice(sitePrice);
        const imageUrls = uniqueImages([
          product.image_url,
          ...images
            .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
            .map((image) => image.image_url),
        ]);
        const categoryId =
          settings.category_id || defaultCategoryId(product, inventory);

        return {
          legacyProductId: Number(product.id),
          inventoryItemId: inventory?.id || null,
          sku: productSku || text(inventory?.sku, 100),
          title: text(product.title, 240) || "Untitled card",
          ebayTitle:
            settings.title || (text(product.title, 240) || "Untitled card").slice(0, 80),
          siteDescription: text(product.description, 10000) || "",
          ebayDescriptionOverride: settings.description_override || "",
          player: text(product.player, 160),
          sport: text(product.sport, 100),
          sitePrice,
          ebayPrice,
          quantity,
          status,
          ebayItemId: text(product.ebay_item_id, 120),
          ebayOfferId: settings.offer_id || null,
          ebayState: settings.state || null,
          preparedForEbay: Boolean(settings.prepared),
          format: settings.format || "FIXED_PRICE",
          categoryId,
          aspects: derivedAspects(product, inventory),
          imageUrls,
          hasFrontAndBack: imageUrls.length >= 2,
          channel: deriveListingChannel({
            status,
            quantity,
            ebayItemId: product.ebay_item_id,
          }),
          lastEbayActionAt: settings.last_action_at || null,
          lastEbayError: settings.last_error || null,
        };
      }),
    );

    return NextResponse.json(
      { ok: true, rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = error instanceof InstaCompJobServerError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unable to load inventory listing rows.",
        code:
          error instanceof InstaCompJobServerError
            ? error.code
            : "EBAY_INVENTORY_LOAD_FAILED",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const supabase = requireInstaCompJobSupabase();
    const body = await request.json();
    const legacyProductId = Number(body?.legacyProductId || 0);

    if (!Number.isInteger(legacyProductId) || legacyProductId <= 0) {
      throw new InstaCompJobServerError(
        "A valid product ID is required.",
        400,
        "EBAY_INVENTORY_PRODUCT_ID_REQUIRED",
      );
    }

    const { product, inventory, repository } = await productAndInventory({
      supabase,
      storeId: actor.storeId,
      legacyProductId,
    });

    if (!inventory) {
      throw new InstaCompJobServerError(
        "This product needs an inventory-item bridge before channel settings can be saved or published.",
        409,
        "EBAY_INVENTORY_BRIDGE_REQUIRED",
      );
    }

    const engine = new InventoryEngine(actor.storeId, repository, supabase);
    const action = String(body?.action || "");

    if (action === "set_site_active" || action === "set_site_draft") {
      const status = action === "set_site_active" ? "active" : "draft";
      await engine.setStatus({ legacyProductId, status });
      return NextResponse.json({
        ok: true,
        action,
        legacyProductId,
        status,
      });
    }

    const sitePrice = money(body?.sitePrice) || money(product.price);
    const ebayPrice = money(body?.ebayPrice);
    const prepared = body?.preparedForEbay === undefined
      ? true
      : bool(body.preparedForEbay);
    const ebayTitle = text(body?.ebayTitle, 80) || text(product.title, 80);
    const descriptionOverride = text(body?.ebayDescriptionOverride, 10000);
    const categoryId =
      text(body?.categoryId, 20) || defaultCategoryId(product, inventory);
    const format: EbayListingFormat =
      body?.format === "AUCTION" ? "AUCTION" : "FIXED_PRICE";

    if (!sitePrice) {
      throw new InstaCompJobServerError(
        "Site price must be greater than zero.",
        400,
        "EBAY_INVENTORY_SITE_PRICE_REQUIRED",
      );
    }

    if (!ebayPrice) {
      throw new InstaCompJobServerError(
        "eBay price must be greater than zero.",
        400,
        "EBAY_INVENTORY_EBAY_PRICE_REQUIRED",
      );
    }

    if (!ebayTitle) {
      throw new InstaCompJobServerError(
        "eBay title is required.",
        400,
        "EBAY_INVENTORY_TITLE_REQUIRED",
      );
    }

    const isCurrentlySiteLive = String(inventory.status || "") === "active";
    if (format === "FIXED_PRICE" && isCurrentlySiteLive && ebayPrice <= sitePrice) {
      throw new InstaCompJobServerError(
        "eBay price must be higher than the Truely Collectables site price while the card is listed on both channels.",
        400,
        "EBAY_INVENTORY_DIRECT_PRICE_ADVANTAGE_REQUIRED",
      );
    }

    const now = new Date().toISOString();
    const baseSettings: Partial<StoredEbaySettings> = {
      prepared,
      price: ebayPrice,
      title: ebayTitle,
      description_override: descriptionOverride,
      category_id: categoryId,
      format,
      state: "prepared",
      last_action_at: now,
      last_error: null,
    };

    const productPriceUpdate = supabase
      .from("products")
      .update({ price: sitePrice })
      .eq("store_id", actor.storeId)
      .eq("id", legacyProductId);
    const inventoryPriceUpdate = repository.update(inventory.id, { price: sitePrice });
    await Promise.all([productPriceUpdate, inventoryPriceUpdate]);

    let currentInventory = await repository.getById(inventory.id);
    if (!currentInventory) {
      throw new Error("Inventory item disappeared while saving channel settings.");
    }
    currentInventory = await persistSettings({
      repository,
      inventory: currentInventory,
      patch: baseSettings,
    });

    if (action === "save_settings") {
      return NextResponse.json({
        ok: true,
        action,
        legacyProductId,
        sitePrice,
        ebayPrice,
        preparedForEbay: prepared,
      });
    }

    if (action !== "draft" && action !== "publish") {
      throw new InstaCompJobServerError(
        "Action must be save_settings, draft, publish, set_site_active, or set_site_draft.",
        400,
        "EBAY_INVENTORY_ACTION_INVALID",
      );
    }

    const publisherAction = action as EbayPublisherAction;
    if (publisherAction === "publish" && body?.confirmation !== "PUBLISH_LIVE") {
      throw new InstaCompJobServerError(
        "Live eBay publishing requires explicit confirmation.",
        400,
        "EBAY_INVENTORY_PUBLISH_CONFIRMATION_REQUIRED",
      );
    }

    const quantity = wholeQuantity(product.quantity ?? inventory.quantity);
    if (quantity < 1) {
      throw new InstaCompJobServerError(
        "Quantity must be at least one before creating an eBay listing.",
        400,
        "EBAY_INVENTORY_QUANTITY_REQUIRED",
      );
    }

    const images = await repository.getImages(inventory.id);
    const imagePaths = uniqueImages([
      product.image_url,
      ...images
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((image) => image.image_url),
    ]);

    if (imagePaths.length < 2) {
      throw new InstaCompJobServerError(
        "Front and back card images are required before eBay drafting or publishing.",
        400,
        "EBAY_INVENTORY_FRONT_BACK_REQUIRED",
      );
    }

    const sku = text(product.sku, 50) || text(inventory.sku, 50);
    if (!sku) {
      throw new InstaCompJobServerError(
        "A stable SKU is required before eBay drafting or publishing.",
        400,
        "EBAY_INVENTORY_SKU_REQUIRED",
      );
    }

    const description =
      descriptionOverride || text(product.description, 10000) || ebayTitle;
    const policies = record(body?.policies);
    const listing = {
      sku,
      title: ebayTitle,
      description,
      categoryId,
      format,
      listingDuration: format === "AUCTION" ? "DAYS_3" : "GTC",
      price: ebayPrice,
      quantity,
      imagePaths,
      aspects: mergeAspects(derivedAspects(product, currentInventory), body?.aspects),
      merchantLocationKey: text(body?.merchantLocationKey, 120) || "",
      policies: {
        fulfillmentPolicyId: text(policies.fulfillmentPolicyId, 120) || "",
        paymentPolicyId: text(policies.paymentPolicyId, 120) || "",
        returnPolicyId: text(policies.returnPolicyId, 120) || "",
      },
    } as const;

    let result;
    const publishParams = {
      action: publisherAction,
      listing,
      confirmation:
        publisherAction === "publish" ? "PUBLISH_LIVE" : undefined,
    };

    try {
      result = await saveOrPublishEbayListing(publishParams);
    } catch (error) {
      if (!isMissingEbayOfferLookupError(error)) throw error;
      result = await createMissingEbayOffer(publishParams);
    }

    const listingId = text(result?.listingId, 120);
    const offerId = text(result?.offerId, 120);
    if (listingId) {
      const { error: linkError } = await supabase
        .from("products")
        .update({ ebay_item_id: listingId, last_seen_at: now })
        .eq("store_id", actor.storeId)
        .eq("id", legacyProductId);
      if (linkError) throw linkError;
    }

    const latestInventory = (await repository.getById(inventory.id)) || currentInventory;
    await persistSettings({
      repository,
      inventory: latestInventory,
      patch: {
        ...baseSettings,
        offer_id: offerId,
        listing_id: listingId,
        state: publisherAction === "publish" ? "published" : "draft",
        last_action_at: now,
        last_error: null,
      },
    });

    return NextResponse.json({
      ok: true,
      action: publisherAction,
      legacyProductId,
      sku,
      offerId,
      listingId,
      listingUrl: result?.listingUrl || null,
      alreadyPublished: Boolean(result?.alreadyPublished),
      sitePrice,
      ebayPrice,
      channel: deriveListingChannel({
        status: inventory.status,
        quantity,
        ebayItemId: listingId || product.ebay_item_id,
      }),
    });
  } catch (error: any) {
    const status = error instanceof InstaCompJobServerError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Inventory listing action failed.",
        code:
          error instanceof InstaCompJobServerError
            ? error.code
            : "EBAY_INVENTORY_ACTION_FAILED",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
