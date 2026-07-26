import { supabase } from "../../lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractAuthenticityProfile,
  authenticityStatusLabel,
  mergeAuthenticityIntoMetadata,
  validateAuthenticityProfile,
} from "../../lib/authenticity";
import { STORE_BRAND_NAME } from "../../lib/legal";
import { preferHighResolutionListingImage } from "../../lib/listing-image-utils";
import {
  adminProductStatusChangeError,
  adminProductStatusNormalizedQuantity,
} from "../../lib/admin-product-status";
import { getStoreSettings } from "../../lib/store-settings";
import { getActiveStoreId } from "../../lib/stores";
import { eventBus } from "../../core/events/event-bus";
import { InventoryRepository, inventoryRepository } from "./repository";
import type {
  InventoryItem,
  InventoryStatus,
  EbayReconciliationIssue,
  EbayReconciliationStatus,
  InventoryBackfillResult,
  InventoryBridgeIssue,
  InventoryBridgeRow,
  InventoryBridgeStatus,
  InventoryDescriptionInput,
  LegacyProductSnapshot,
  UpdateInventoryProductInput,
  UniversalInventoryItem,
} from "./types";

type CartRequestItem = {
  id: number;
  quantity: number;
};

type RawCartRequestItem = {
  id?: unknown;
  product_id?: unknown;
  productId?: unknown;
  quantity?: unknown;
  qty?: unknown;
};

type EbayImportInput = {
  sku: string;
  title: string;
  description: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  player?: string | null;
  sport?: string | null;
  category?: string | null;
  categoryConfidence?: string | null;
  reviewRequired?: boolean;
  attributes?: Record<string, string | null>;
};

type ManualProductInput = {
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
};

type SellerDraftProductInput = {
  sellerAccountId: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  condition?: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
  sku?: string | null;
  ebayItemId?: string | null;
  authenticity?: UniversalInventoryItem["authenticity"];
};

type InventoryMutationResult = {
  item: UniversalInventoryItem;
  previousQuantity: number;
  newQuantity: number;
};

export class InventoryEngineError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500
  ) {
    super(message);
    this.name = "InventoryEngineError";
  }
}

function normalizeStatus(quantity: number): InventoryStatus {
  return quantity > 0 ? "active" : "sold";
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storefrontImageUrl(value: unknown) {
  const preferred = preferHighResolutionListingImage(value);
  return preferred || null;
}

function mapLegacyProduct(product: any): LegacyProductSnapshot {
  return {
    id: Number(product.id),
    seller_account_id: product.seller_account_id ?? null,
    sku: product.sku ?? null,
    title: String(product.title ?? "Untitled"),
    description: product.description ?? null,
    price: toNumber(product.price),
    quantity: toNumber(product.quantity),
    image_url: storefrontImageUrl(product.image_url),
    ebay_item_id: product.ebay_item_id ?? null,
    last_seen_at: product.last_seen_at ?? null,
    player: product.player ?? null,
    sport: product.sport ?? null,
  };
}

function mapUniversal(
  product: LegacyProductSnapshot,
  inventoryItem: InventoryItem | null
): UniversalInventoryItem {
  if (inventoryItem) {
    const authenticity = extractAuthenticityProfile(inventoryItem.metadata);

    return {
      inventoryItemId: inventoryItem.id,
      legacyProductId: product.id,
      sellerAccountId:
        inventoryItem.seller_account_id ?? product.seller_account_id ?? null,
      sku: inventoryItem.sku ?? product.sku,
      title: inventoryItem.title,
      description: inventoryItem.description ?? product.description,
      player: product.player ?? null,
      sport: product.sport ?? null,
      price: toNumber(inventoryItem.price),
      quantity: toNumber(inventoryItem.quantity),
      imageUrl: storefrontImageUrl(product.image_url),
      ebayItemId: product.ebay_item_id,
      status: inventoryItem.status,
      source: "inventory_items",
      authenticity,
    };
  }

  return {
    inventoryItemId: null,
    legacyProductId: product.id,
    sellerAccountId: product.seller_account_id ?? null,
    sku: product.sku,
    title: product.title,
    description: product.description,
    player: product.player ?? null,
    sport: product.sport ?? null,
    price: product.price,
    quantity: product.quantity,
    imageUrl: storefrontImageUrl(product.image_url),
    ebayItemId: product.ebay_item_id,
    status: normalizeStatus(product.quantity),
    source: "products",
    authenticity: extractAuthenticityProfile(null),
  };
}

function pricesMatch(left: number, right: number | null) {
  if (right === null) return false;
  return Math.round(left * 100) === Math.round(toNumber(right) * 100);
}

function primaryIssue(issues: InventoryBridgeIssue[]) {
  return issues.length > 0 ? issues : ["ok" as const];
}

function primaryEbayIssue(issues: EbayReconciliationIssue[]) {
  return issues.length > 0 ? issues : ["ok" as const];
}

function hoursSince(value: string | null) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) return null;

  return Math.max(0, Math.round((Date.now() - timestamp) / 36_000) / 100);
}

function cleanText(value: string | null | undefined) {
  return value?.trim() || null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getOpenAIModel() {
  return process.env.OPENAI_DESCRIPTION_MODEL || "gpt-5.5";
}

export function generateInventoryDescription(input: InventoryDescriptionInput) {
  const storeDisplayName = cleanText(input.storeDisplayName) ?? STORE_BRAND_NAME;
  const title = cleanText(input.title) ?? "This card";
  const player = cleanText(input.player);
  const sport = cleanText(input.sport);
  const identifier = player && sport ? `${player} ${sport}` : player ?? sport;
  const availability =
    input.status === "active" && input.quantity > 0
      ? `${input.quantity} available`
      : input.status.replaceAll("_", " ");

  const lines = [
    `${title} is available from ${storeDisplayName}.`,
    identifier
      ? `This listing is cataloged as a ${identifier} trading card.`
      : "This listing is cataloged as a trading card.",
    `Current price: $${Number(input.price || 0).toFixed(2)}.`,
    `Current availability: ${availability}.`,
  ];

  if (input.sku) {
    lines.push(`Inventory SKU: ${input.sku}.`);
  }

  if (input.ebayItemId) {
    lines.push(`Synced eBay listing ID: ${input.ebayItemId}.`);
  }

  if (input.authenticity && input.authenticity.status !== "not_applicable") {
    lines.push(
      `Authenticity disclosure: ${authenticityStatusLabel(input.authenticity.status)}.`,
    );

    if (input.authenticity.certProvider) {
      const certDetails = input.authenticity.certNumber
        ? `${input.authenticity.certProvider} cert ${input.authenticity.certNumber}`
        : input.authenticity.certProvider;
      lines.push(`Certification details: ${certDetails}.`);
    }

    if (input.authenticity.guaranteedAuthenticators.length > 0) {
      lines.push(
        `Seller pass guarantee names: ${input.authenticity.guaranteedAuthenticators.join(", ")}.`,
      );
    }

    if (input.authenticity.provenanceEvidence) {
      lines.push(`Provenance support: ${input.authenticity.provenanceEvidence}.`);
    }
  }

  return lines.join(" ");
}

export class InventoryEngine {
  constructor(
    private readonly storeId = getActiveStoreId(),
    private readonly repository: InventoryRepository = inventoryRepository,
    private readonly database: SupabaseClient = supabase,
  ) {}

  normalizeCartItems(value: unknown): CartRequestItem[] {
    if (!Array.isArray(value)) return [];

    const quantities = new Map<number, number>();

    for (const rawValue of value) {
      const raw = (rawValue || {}) as RawCartRequestItem;
      const id = positiveInteger(raw.id ?? raw.product_id ?? raw.productId);
      const quantity = positiveInteger(raw.quantity ?? raw.qty ?? 1);

      if (!id || !quantity) continue;
      quantities.set(id, (quantities.get(id) || 0) + quantity);
    }

    return Array.from(quantities.entries()).map(([id, quantity]) => ({
      id,
      quantity,
    }));
  }

  async getByLegacyProductId(
    legacyProductId: number,
  ): Promise<UniversalInventoryItem | null> {
    const legacyProduct = await this.getLegacyProductById(legacyProductId);
    if (!legacyProduct) return null;

    const inventoryItem = await this.repository.getByLegacyProductId(legacyProductId);
    return mapUniversal(legacyProduct, inventoryItem);
  }

  async getByLegacyProductIds(
    legacyProductIds: number[],
  ): Promise<UniversalInventoryItem[]> {
    const uniqueIds = Array.from(
      new Set(legacyProductIds.map(Number).filter(Number.isFinite)),
    );
    if (uniqueIds.length === 0) return [];

    const { data: legacyProducts, error: legacyError } = await this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .in("id", uniqueIds);
    if (legacyError) throw legacyError;

    const inventoryItems = await Promise.all(
      uniqueIds.map((legacyProductId) =>
        this.repository.getByLegacyProductId(legacyProductId),
      ),
    );
    const inventoryByLegacyId = new Map(
      inventoryItems
        .filter(Boolean)
        .map((item) => [Number(item!.legacy_product_id), item!]),
    );

    return (legacyProducts || []).map((product) =>
      mapUniversal(
        mapLegacyProduct(product),
        inventoryByLegacyId.get(Number(product.id)) || null,
      ),
    );
  }

  async listAvailable(params: InventorySearchParams = {}) {
    const limit = params.limit ?? 1000;
    const offset = params.offset ?? 0;

    let query = this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .gt("price", 0)
      .gt("quantity", 0)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.query) {
      const value = params.query.replace(/[%_,]/g, " ").trim();
      if (value) {
        query = query.or(
          `title.ilike.%${value}%,player.ilike.%${value}%,sport.ilike.%${value}%`,
        );
      }
    }

    if (params.sport) {
      query = query.ilike("sport", params.sport);
    }

    const { data: legacyProducts, error: legacyError } = await query;
    if (legacyError) throw legacyError;

    const ids = (legacyProducts || []).map((product) => Number(product.id));
    const inventoryItems = await Promise.all(
      ids.map((legacyProductId) =>
        this.repository.getByLegacyProductId(legacyProductId),
      ),
    );
    const inventoryByLegacyId = new Map(
      inventoryItems
        .filter(Boolean)
        .map((item) => [Number(item!.legacy_product_id), item!]),
    );

    return (legacyProducts || [])
      .map((product) =>
        mapUniversal(
          mapLegacyProduct(product),
          inventoryByLegacyId.get(Number(product.id)) || null,
        ),
      )
      .filter((item) => item.status === "active" && item.quantity > 0);
  }

  async listAvailableSports() {
    const items = await this.listAvailable();
    return Array.from(
      new Set(items.map((item) => item.sport?.trim()).filter(Boolean) as string[]),
    ).sort((left, right) => left.localeCompare(right));
  }

  async requireAvailableCartItems(
    cartItems: CartRequestItem[],
  ): Promise<UniversalInventoryItem[]> {
    const normalized = this.normalizeCartItems(cartItems);
    if (normalized.length === 0) {
      throw new InventoryEngineError("Cart is empty", 400);
    }

    const products = await this.getByLegacyProductIds(
      normalized.map((item) => item.id),
    );
    const byId = new Map(products.map((product) => [product.legacyProductId, product]));

    for (const cartItem of normalized) {
      const product = byId.get(cartItem.id);
      if (!product) {
        throw new InventoryEngineError(`Product ${cartItem.id} was not found`, 404);
      }
      if (product.status !== "active" || product.quantity < cartItem.quantity) {
        throw new InventoryEngineError(
          `Product ${cartItem.id} does not have enough quantity available`,
          409,
        );
      }
    }

    return normalized.map((item) => byId.get(item.id)!);
  }

  async getLegacyProductById(id: number) {
    const { data, error } = await this.database
      .from("products")
      .select("*")
      .eq("id", id)
      .eq("store_id", this.storeId)
      .maybeSingle();

    if (error) throw error;
    return data ? mapLegacyProduct(data) : null;
  }

  async importFromEbay(input: EbayImportInput) {
    const status = normalizeStatus(input.quantity);
    const metadata = mergeAuthenticityIntoMetadata(
      {
        source: "ebay",
        source_account: "truely_collectables",
        category_confidence: input.categoryConfidence ?? null,
        category_review_required: input.reviewRequired === true,
        imported_at: new Date().toISOString(),
      },
      extractAuthenticityProfile(null),
    );
    const inventoryItem = await this.repository.upsertBySku({
      legacy_product_id: null,
      sku: input.sku,
      title: input.title,
      description: input.description,
      category: input.category ?? "sports_cards",
      condition: "unknown",
      status,
      quantity: input.quantity,
      price: input.price,
      metadata,
    });

    await this.repository.replaceGeneratedAttributes(
      inventoryItem.id,
      Object.entries(input.attributes ?? {}).map(([attribute_name, attribute_value]) => ({
        attribute_name,
        attribute_value,
      })),
    );

    return inventoryItem;
  }

  async createManualProduct(input: ManualProductInput) {
    const { data: product, error: productError } = await this.database
      .from("products")
      .insert({
        store_id: this.storeId,
        title: input.title,
        description: input.description,
        player: input.player,
        sport: input.sport,
        price: input.price,
        quantity: input.quantity,
        image_url: storefrontImageUrl(input.imageUrl),
        status: normalizeStatus(input.quantity),
      })
      .select("*")
      .single();
    if (productError) throw productError;

    const inventoryItem = await this.repository.create({
      legacy_product_id: Number(product.id),
      sku: `MANUAL-${product.id}`,
      title: input.title,
      description: input.description,
      category: input.sport || "sports_cards",
      condition: "unknown",
      status: normalizeStatus(input.quantity),
      quantity: input.quantity,
      price: input.price,
      metadata: mergeAuthenticityIntoMetadata(
        { source: "manual" },
        extractAuthenticityProfile(null),
      ),
    });

    return mapUniversal(mapLegacyProduct(product), inventoryItem);
  }

  async createSellerDraftProduct(input: SellerDraftProductInput) {
    const { data: product, error: productError } = await this.database
      .from("products")
      .insert({
        store_id: this.storeId,
        seller_id: input.sellerAccountId,
        seller_account_id: input.sellerAccountId,
        sku: input.sku,
        title: input.title,
        description: input.description ?? null,
        price: input.price,
        quantity: input.quantity,
        image_url: storefrontImageUrl(input.imageUrl),
        ebay_item_id: input.ebayItemId ?? null,
        status: "draft",
      })
      .select("*")
      .single();
    if (productError) throw productError;

    const authenticity = input.authenticity || extractAuthenticityProfile(null);
    const inventoryItem = await this.repository.create({
      legacy_product_id: Number(product.id),
      seller_account_id: input.sellerAccountId,
      sku: input.sku || `SELLER-${product.id}`,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? "sports_cards",
      condition: input.condition ?? "unknown",
      status: "draft",
      quantity: input.quantity,
      price: input.price,
      metadata: mergeAuthenticityIntoMetadata(
        { source: "seller" },
        authenticity,
      ),
    });

    return mapUniversal(mapLegacyProduct(product), inventoryItem);
  }

  async updateProduct(
    legacyProductId: number,
    input: UpdateInventoryProductInput,
  ): Promise<UniversalInventoryItem> {
    const current = await this.getByLegacyProductId(legacyProductId);
    if (!current) throw new InventoryEngineError("Product not found", 404);

    const authenticity = input.authenticity || current.authenticity;
    const authenticityError = validateAuthenticityProfile(authenticity);
    if (authenticityError) {
      throw new InventoryEngineError(authenticityError, 400);
    }

    const quantity = adminProductStatusNormalizedQuantity({
      currentQuantity: current.quantity,
      nextStatus: input.status,
      requestedQuantity: input.quantity,
    });
    const statusError = adminProductStatusChangeError({
      currentStatus: current.status,
      nextStatus: input.status,
      quantity,
      price: input.price,
    });
    if (statusError) throw new InventoryEngineError(statusError, 400);

    const productUpdate = {
      title: input.title,
      description: input.description,
      player: input.player,
      sport: input.sport,
      price: input.price,
      quantity,
      image_url: storefrontImageUrl(input.imageUrl),
      status: input.status,
      archived_at: input.status === "archived" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error: productError } = await this.database
      .from("products")
      .update(productUpdate)
      .eq("id", legacyProductId)
      .eq("store_id", this.storeId);
    if (productError) throw productError;

    const inventoryItem = await this.repository.getByLegacyProductId(legacyProductId);
    if (!inventoryItem) {
      throw new InventoryEngineError("Inventory bridge row not found", 500);
    }

    const existingMetadata = inventoryItem.metadata || {};
    await this.repository.update(inventoryItem.id, {
      title: input.title,
      description: input.description,
      price: input.price,
      quantity,
      status: input.status,
      metadata: mergeAuthenticityIntoMetadata(existingMetadata, authenticity),
    });

    const updated = await this.getByLegacyProductId(legacyProductId);
    if (!updated) throw new InventoryEngineError("Updated product not found", 500);

    await eventBus.emit({
      type: "inventory.updated",
      payload: {
        inventoryItemId: updated.inventoryItemId,
        legacyProductId,
        status: updated.status,
        quantity: updated.quantity,
      },
    });

    return updated;
  }

  async archiveProduct(legacyProductId: number) {
    const item = await this.getByLegacyProductId(legacyProductId);
    if (!item) throw new InventoryEngineError("Product not found", 404);
    return this.updateProduct(legacyProductId, {
      title: item.title,
      description: item.description,
      player: item.player,
      sport: item.sport,
      price: item.price,
      quantity: 0,
      imageUrl: item.imageUrl,
      status: "archived",
      authenticity: item.authenticity,
    });
  }

  async decrementAfterSale(
    legacyProductId: number,
    quantity: number,
  ): Promise<InventoryMutationResult> {
    const item = await this.getByLegacyProductId(legacyProductId);
    if (!item || !item.inventoryItemId) {
      throw new InventoryEngineError("Inventory item not found", 404);
    }

    const previousQuantity = item.quantity;
    const newQuantity = Math.max(previousQuantity - quantity, 0);
    const status = normalizeStatus(newQuantity);

    const { error: productError } = await this.database
      .from("products")
      .update({
        quantity: newQuantity,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", legacyProductId)
      .eq("store_id", this.storeId);
    if (productError) throw productError;

    await this.repository.update(item.inventoryItemId, {
      quantity: newQuantity,
      status,
    });

    const updated = await this.getByLegacyProductId(legacyProductId);
    if (!updated) throw new InventoryEngineError("Updated inventory item not found", 500);

    return {
      item: updated,
      previousQuantity,
      newQuantity,
    };
  }

  async markEbayListingInactive(input: {
    ebayItemId: string;
    sku?: string | null;
  }) {
    const candidates = [
      input.sku ? await this.repository.getBySku(input.sku) : null,
    ].filter(Boolean) as InventoryItem[];

    if (candidates.length === 0) {
      const { data, error } = await this.database
        .from("products")
        .select("id")
        .eq("store_id", this.storeId)
        .eq("ebay_item_id", input.ebayItemId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) return null;
      const item = await this.repository.getByLegacyProductId(Number(data.id));
      if (item) candidates.push(item);
    }

    const item = candidates[0];
    if (!item) return null;
    return this.updateProduct(Number(item.legacy_product_id), {
      title: item.title,
      description: item.description,
      player: null,
      sport: item.category,
      price: toNumber(item.price),
      quantity: 0,
      imageUrl: null,
      status: "sold",
      authenticity: extractAuthenticityProfile(item.metadata),
    });
  }

  async getBridgeStatus(): Promise<InventoryBridgeStatus> {
    const { data: products, error: productsError } = await this.database
      .from("products")
      .select("id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,last_seen_at,player,sport")
      .eq("store_id", this.storeId);
    if (productsError) throw productsError;

    const { data: inventoryItems, error: inventoryError } = await this.database
      .from("inventory_items")
      .select("*")
      .eq("store_id", this.storeId);
    if (inventoryError) throw inventoryError;

    const inventoryByLegacyId = new Map(
      (inventoryItems || [])
        .filter((item) => item.legacy_product_id)
        .map((item) => [Number(item.legacy_product_id), item as InventoryItem]),
    );

    const rows: InventoryBridgeRow[] = (products || []).map((rawProduct) => {
      const product = mapLegacyProduct(rawProduct);
      const inventoryItem = inventoryByLegacyId.get(product.id) || null;
      const issues: InventoryBridgeIssue[] = [];

      if (!inventoryItem) issues.push("missing_inventory_item");
      if (inventoryItem && inventoryItem.sku !== product.sku) issues.push("sku_mismatch");
      if (inventoryItem && !pricesMatch(product.price, inventoryItem.price)) {
        issues.push("price_mismatch");
      }
      if (
        inventoryItem &&
        toNumber(product.quantity) !== toNumber(inventoryItem.quantity)
      ) {
        issues.push("quantity_mismatch");
      }
      if (
        inventoryItem &&
        normalizeStatus(product.quantity) !== inventoryItem.status
      ) {
        issues.push("status_mismatch");
      }

      return {
        legacyProductId: product.id,
        inventoryItemId: inventoryItem?.id ?? null,
        sku: inventoryItem?.sku ?? product.sku,
        title: inventoryItem?.title ?? product.title,
        productPrice: product.price,
        inventoryPrice: inventoryItem?.price === null ? null : toNumber(inventoryItem?.price),
        productQuantity: product.quantity,
        inventoryQuantity: inventoryItem ? toNumber(inventoryItem.quantity) : null,
        productStatus: normalizeStatus(product.quantity),
        inventoryStatus: inventoryItem?.status ?? null,
        issues: primaryIssue(issues),
      };
    });

    return {
      storeId: this.storeId,
      totals: {
        products: rows.length,
        inventoryItems: (inventoryItems || []).length,
        issueRows: rows.filter((row) => !row.issues.includes("ok")).length,
      },
      rows,
    };
  }

  async getEbayReconciliationStatus(): Promise<EbayReconciliationStatus> {
    const { data: products, error: productsError } = await this.database
      .from("products")
      .select("id,sku,title,price,quantity,ebay_item_id,last_seen_at,archived_at,status")
      .eq("store_id", this.storeId)
      .not("ebay_item_id", "is", null);
    if (productsError) throw productsError;

    const { data: inventoryItems, error: inventoryError } = await this.database
      .from("inventory_items")
      .select("legacy_product_id,sku,price,quantity,status")
      .eq("store_id", this.storeId);
    if (inventoryError) throw inventoryError;

    const inventoryByLegacyId = new Map(
      (inventoryItems || [])
        .filter((item) => item.legacy_product_id)
        .map((item) => [Number(item.legacy_product_id), item as InventoryItem]),
    );

    const now = Date.now();
    const rows = (products || []).map((product) => {
      const issues: EbayReconciliationIssue[] = [];
      const inventoryItem = inventoryByLegacyId.get(Number(product.id));
      const lastSeenAt = product.last_seen_at || null;
      const ageHours = lastSeenAt
        ? Math.max(0, (now - new Date(lastSeenAt).getTime()) / 3_600_000)
        : null;

      if (!product.ebay_item_id) issues.push("missing_ebay_item_id");
      if (!product.sku) issues.push("missing_sku");
      if (!lastSeenAt) issues.push("missing_last_seen_at");
      if (ageHours !== null && ageHours > 25) issues.push("stale_sync");
      if (!inventoryItem) issues.push("missing_inventory_item");
      if (inventoryItem && inventoryItem.sku !== product.sku) issues.push("sku_mismatch");
      if (inventoryItem && !pricesMatch(toNumber(product.price), inventoryItem.price)) {
        issues.push("price_mismatch");
      }
      if (
        inventoryItem &&
        toNumber(product.quantity) !== toNumber(inventoryItem.quantity)
      ) {
        issues.push("quantity_mismatch");
      }

      return {
        legacyProductId: Number(product.id),
        inventoryItemId: inventoryItem?.id ?? null,
        ebayItemId: product.ebay_item_id,
        sku: product.sku,
        title: product.title,
        lastSeenAt,
        ageHours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
        issues: primaryEbayIssue(issues),
      };
    });

    return {
      storeId: this.storeId,
      totals: {
        ebayLinkedProducts: rows.length,
        issueRows: rows.filter((row) => !row.issues.includes("ok")).length,
      },
      rows,
    };
  }

  async backfillInventoryFromProducts(): Promise<InventoryBackfillResult> {
    const { data: products, error: productsError } = await this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId);
    if (productsError) throw productsError;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawProduct of products || []) {
      const product = mapLegacyProduct(rawProduct);
      const status = normalizeStatus(product.quantity);
      const existing = await this.repository.getByLegacyProductId(product.id);
      const input = {
        legacy_product_id: product.id,
        seller_account_id: product.seller_account_id,
        sku: product.sku || `LEGACY-${product.id}`,
        title: product.title,
        description: product.description,
        category: product.sport || "sports_cards",
        condition: "unknown",
        status,
        quantity: product.quantity,
        price: product.price,
        metadata: mergeAuthenticityIntoMetadata(
          existing?.metadata || { source: "legacy_products" },
          extractAuthenticityProfile(existing?.metadata),
        ),
      };

      if (existing) {
        const changed =
          existing.sku !== input.sku ||
          existing.title !== input.title ||
          existing.description !== input.description ||
          toNumber(existing.price) !== input.price ||
          toNumber(existing.quantity) !== input.quantity ||
          existing.status !== input.status;

        if (!changed) {
          skipped += 1;
          continue;
        }

        await this.repository.update(existing.id, input);
        updated += 1;
      } else {
        await this.repository.create(input);
        inserted += 1;
      }
    }

    return { inserted, updated, skipped };
  }
}
