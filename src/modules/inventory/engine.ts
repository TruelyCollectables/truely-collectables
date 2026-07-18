import { supabase } from "../../lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractAuthenticityProfile,
  authenticityStatusLabel,
  mergeAuthenticityIntoMetadata,
  validateAuthenticityProfile,
} from "../../lib/authenticity";
import { STORE_BRAND_NAME } from "../../lib/legal";
import { adminProductStatusChangeError } from "../../lib/admin-product-status";
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

function mapLegacyProduct(product: any): LegacyProductSnapshot {
  return {
    id: Number(product.id),
    seller_account_id: product.seller_account_id ?? null,
    sku: product.sku ?? null,
    title: String(product.title ?? "Untitled"),
    description: product.description ?? null,
    price: toNumber(product.price),
    quantity: toNumber(product.quantity),
    image_url: product.image_url ?? null,
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
      imageUrl: product.image_url,
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
    imageUrl: product.image_url,
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

    if (input.authenticity.authenticityNotes) {
      lines.push(`Authenticity notes: ${input.authenticity.authenticityNotes}.`);
    }
  }

  lines.push(
    "Inventory and availability are maintained by TCOS and may update as marketplace syncs complete."
  );

  return lines.join("\n\n");
}

function extractResponseText(data: any) {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  const text =
    data?.output
      ?.flatMap((item: any) => item?.content ?? [])
      ?.map((content: any) => content?.text)
      ?.filter(Boolean)
      ?.join("\n")
      ?.trim() ?? "";

  return text || null;
}

export class InventoryEngine {
  private storeDisplayNamePromise: Promise<string> | null = null;

  constructor(
    private readonly storeId = getActiveStoreId(),
    private readonly repository: InventoryRepository = inventoryRepository,
    private readonly database: SupabaseClient = supabase,
  ) {}

  private async getStoreDisplayName() {
    if (!this.storeDisplayNamePromise) {
      this.storeDisplayNamePromise = getStoreSettings(this.database, this.storeId)
        .then((settings) => settings.displayName || STORE_BRAND_NAME)
        .catch(() => STORE_BRAND_NAME);
    }

    return this.storeDisplayNamePromise;
  }

  private async createGeneratedDescription(input: InventoryDescriptionInput) {
    return generateInventoryDescription({
      ...input,
      storeDisplayName: await this.getStoreDisplayName(),
    });
  }

  private mapProductsWithInventory(
    products: any[] | null,
    inventoryItems: any[] | null,
  ): UniversalInventoryItem[] {
    const byLegacyProductId = new Map<number, InventoryItem>();
    const bySku = new Map<string, InventoryItem>();

    for (const item of (inventoryItems ?? []) as InventoryItem[]) {
      if (item.legacy_product_id) {
        byLegacyProductId.set(Number(item.legacy_product_id), item);
      }

      if (item.sku) {
        bySku.set(item.sku, item);
      }
    }

    return (products ?? []).map((productRow) => {
      const legacyProduct = mapLegacyProduct(productRow);
      const inventoryItem =
        byLegacyProductId.get(legacyProduct.id) ??
        (legacyProduct.sku ? bySku.get(legacyProduct.sku) : null) ??
        null;

      return mapUniversal(legacyProduct, inventoryItem);
    });
  }

  async listAvailable(
    params: {
      query?: string;
      sport?: string;
    } = {}
  ): Promise<UniversalInventoryItem[]> {
    let query = this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .gt("price", 0)
      .order("created_at", { ascending: false });

    if (params.query) {
      const safeQuery = params.query.replaceAll(",", " ").replaceAll("%", "").trim();

      if (safeQuery) {
        query = query.or(
          `title.ilike.%${safeQuery}%,player.ilike.%${safeQuery}%,sport.ilike.%${safeQuery}%`
        );
      }
    }

    if (params.sport) {
      query = query.eq("sport", params.sport);
    }

    const [
      { data: products, error },
      { data: inventoryItems, error: inventoryError },
    ] = await Promise.all([
      query,
      this.database
        .from("inventory_items")
        .select("*")
        .eq("store_id", this.storeId),
    ]);

    if (error) throw error;
    if (inventoryError) throw inventoryError;

    return this.mapProductsWithInventory(products ?? [], inventoryItems ?? []).filter(
      (item) =>
        item.inventoryItemId &&
        item.imageUrl &&
        item.quantity > 0 &&
        item.status === "active",
    );
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(items.map((item) => item.sport).filter(Boolean) as string[])
    ).sort();
  }

  async listAll(): Promise<UniversalInventoryItem[]> {
    const [
      { data: products, error },
      { data: inventoryItems, error: inventoryError },
    ] = await Promise.all([
      this.database
        .from("products")
        .select("*")
        .eq("store_id", this.storeId)
        .order("id"),
      this.database
        .from("inventory_items")
        .select("*")
        .eq("store_id", this.storeId),
    ]);

    if (error) throw error;
    if (inventoryError) throw inventoryError;

    return this.mapProductsWithInventory(products ?? [], inventoryItems ?? []);
  }

  async getBridgeStatus(): Promise<InventoryBridgeStatus> {
    const [{ data: products, error: productsError }, { data: inventoryItems, error: inventoryError }] =
      await Promise.all([
        this.database
          .from("products")
          .select("*")
          .eq("store_id", this.storeId)
          .order("created_at", { ascending: false }),
        this.database
          .from("inventory_items")
          .select("*")
          .eq("store_id", this.storeId),
      ]);

    if (productsError) throw productsError;
    if (inventoryError) throw inventoryError;

    const items = (inventoryItems ?? []) as InventoryItem[];
    const byLegacyProductId = new Map<number, InventoryItem>();
    const bySku = new Map<string, InventoryItem>();

    for (const item of items) {
      if (item.legacy_product_id) {
        byLegacyProductId.set(Number(item.legacy_product_id), item);
      }

      if (item.sku) {
        bySku.set(item.sku, item);
      }
    }

    const rows: InventoryBridgeRow[] = (products ?? []).map((productRow) => {
      const product = mapLegacyProduct(productRow);
      const legacyLinkedItem = byLegacyProductId.get(product.id) ?? null;
      const skuLinkedItem = product.sku ? bySku.get(product.sku) ?? null : null;
      const inventoryItem = legacyLinkedItem ?? skuLinkedItem;
      const issues: InventoryBridgeIssue[] = [];

      if (!inventoryItem) {
        issues.push("missing_inventory_item");
      } else {
        if (!legacyLinkedItem && skuLinkedItem) {
          issues.push("sku_link_only");
        }

        if (toNumber(inventoryItem.quantity) !== product.quantity) {
          issues.push("quantity_mismatch");
        }

        if (!pricesMatch(product.price, inventoryItem.price)) {
          issues.push("price_mismatch");
        }
      }

      if (product.quantity <= 0) {
        issues.push("sold_out");
      }

      return {
        legacyProductId: product.id,
        inventoryItemId: inventoryItem?.id ?? null,
        title: product.title,
        sku: product.sku,
        ebayItemId: product.ebay_item_id,
        productQuantity: product.quantity,
        inventoryQuantity:
          inventoryItem?.quantity === undefined ? null : toNumber(inventoryItem.quantity),
        productPrice: product.price,
        inventoryPrice:
          inventoryItem?.price === undefined ? null : toNumber(inventoryItem.price),
        status: inventoryItem?.status ?? normalizeStatus(product.quantity),
        source: inventoryItem ? "inventory_items" : "products",
        issues: primaryIssue(issues),
      };
    });

    return {
      storeId: this.storeId,
      totalProducts: rows.length,
      bridgedItems: rows.filter((row) => row.inventoryItemId).length,
      missingInventoryItems: rows.filter((row) =>
        row.issues.includes("missing_inventory_item")
      ).length,
      skuLinkedItems: rows.filter((row) => row.issues.includes("sku_link_only")).length,
      quantityMismatches: rows.filter((row) =>
        row.issues.includes("quantity_mismatch")
      ).length,
      priceMismatches: rows.filter((row) => row.issues.includes("price_mismatch")).length,
      activeItems: rows.filter((row) => row.productQuantity > 0).length,
      soldOutItems: rows.filter((row) => row.productQuantity <= 0).length,
      ebayLinkedItems: rows.filter((row) => row.ebayItemId).length,
      rows,
    };
  }

  async backfillInventoryItemsFromProducts(): Promise<InventoryBackfillResult> {
    const { data: products, error } = await this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .order("id");

    if (error) throw error;

    const result: InventoryBackfillResult = {
      storeId: this.storeId,
      scanned: products?.length ?? 0,
      created: 0,
      updated: 0,
      imagesAdded: 0,
      failed: [],
    };

    for (const productRow of products ?? []) {
      const product = mapLegacyProduct(productRow);

      try {
        const existing =
          (await this.repository.getByLegacyProductId(product.id)) ??
          (product.sku ? await this.repository.getBySku(product.sku) : null);

        const payload = {
          seller_account_id: product.seller_account_id ?? null,
          legacy_product_id: product.id,
          sku: product.sku,
          title: product.title,
          description:
            product.description ??
            (await this.createGeneratedDescription({
              title: product.title,
              player: product.player,
              sport: product.sport,
              price: product.price,
              quantity: product.quantity,
              status: normalizeStatus(product.quantity),
              sku: product.sku,
              ebayItemId: product.ebay_item_id,
              imageUrl: product.image_url,
              authenticity: extractAuthenticityProfile(existing?.metadata),
            })),
          category: product.sport ?? "sports cards",
          condition: "unknown",
          status: normalizeStatus(product.quantity),
          quantity: product.quantity,
          price: product.price,
          currency: "USD",
          notes: product.ebay_item_id ? `eBay listing ${product.ebay_item_id}` : null,
        };

        const inventoryItem = existing
          ? await this.repository.update(existing.id, payload)
          : await this.repository.create(payload);

        if (existing) {
          result.updated++;
        } else {
          result.created++;
        }

        if (product.image_url) {
          const images = await this.repository.getImages(inventoryItem.id);
          const hasImage = images.some(
            (image) => image.image_url === product.image_url
          );

          if (!hasImage) {
            await this.repository.addImage({
              inventoryItemId: inventoryItem.id,
              imageUrl: product.image_url,
              altText: product.title,
              sortOrder: images.length,
              isPrimary: images.length === 0,
            });

            result.imagesAdded++;
          }
        }
      } catch (backfillError: any) {
        result.failed.push({
          legacyProductId: product.id,
          title: product.title,
          message: backfillError.message || "Unknown inventory backfill error",
        });
      }
    }

    await eventBus.publish(
      "inventory.backfilled",
      {
        scanned: result.scanned,
        created: result.created,
        updated: result.updated,
        imagesAdded: result.imagesAdded,
        failed: result.failed.length,
      },
      "inventory-engine"
    );

    return result;
  }

  async getEbayReconciliationStatus(params: {
    staleAfterHours?: number;
  } = {}): Promise<EbayReconciliationStatus> {
    const staleAfterHours = params.staleAfterHours ?? 12;
    const { data: products, error } = await this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (products ?? []).map((productRow) => {
      const product = mapLegacyProduct(productRow);
      const syncAgeHours = hoursSince(product.last_seen_at);
      const issues: EbayReconciliationIssue[] = [];

      if (!product.sku) {
        issues.push("missing_sku");
      }

      if (!product.ebay_item_id) {
        issues.push("not_linked");
      }

      if (product.ebay_item_id && !product.last_seen_at) {
        issues.push("never_synced");
      }

      if (
        product.ebay_item_id &&
        syncAgeHours !== null &&
        syncAgeHours > staleAfterHours
      ) {
        issues.push("stale_sync");
      }

      if (product.quantity <= 0) {
        issues.push("sold_out");
      }

      return {
        legacyProductId: product.id,
        title: product.title,
        sku: product.sku,
        ebayItemId: product.ebay_item_id,
        quantity: product.quantity,
        price: product.price,
        status: normalizeStatus(product.quantity),
        lastSeenAt: product.last_seen_at,
        syncAgeHours,
        issues: primaryEbayIssue(issues),
      };
    });

    const latestSeenAt =
      rows
        .map((row) => row.lastSeenAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    return {
      storeId: this.storeId,
      totalProducts: rows.length,
      ebayLinkedItems: rows.filter((row) => row.ebayItemId).length,
      localOnlyItems: rows.filter((row) => row.issues.includes("not_linked")).length,
      missingSkuItems: rows.filter((row) => row.issues.includes("missing_sku")).length,
      neverSyncedItems: rows.filter((row) => row.issues.includes("never_synced")).length,
      staleItems: rows.filter((row) => row.issues.includes("stale_sync")).length,
      soldOutItems: rows.filter((row) => row.issues.includes("sold_out")).length,
      healthyLinkedItems: rows.filter(
        (row) =>
          row.ebayItemId &&
          row.issues.every((issue) => issue === "ok" || issue === "sold_out")
      ).length,
      latestSeenAt,
      staleAfterHours,
      rows,
    };
  }

  async getByLegacyProductId(
    legacyProductId: number
  ): Promise<UniversalInventoryItem | null> {
    const { data: product, error } = await this.database
      .from("products")
      .select("*")
      .eq("id", legacyProductId)
      .eq("store_id", this.storeId)
      .maybeSingle();

    if (error) throw error;
    if (!product) return null;

    const legacyProduct = mapLegacyProduct(product);
    const inventoryItem =
      (await this.repository.getByLegacyProductId(legacyProduct.id)) ??
      (legacyProduct.sku
        ? await this.repository.getBySku(legacyProduct.sku)
        : null);

    return mapUniversal(legacyProduct, inventoryItem);
  }

  async getByLegacyProductIds(
    legacyProductIds: number[]
  ): Promise<UniversalInventoryItem[]> {
    const ids = Array.from(new Set(legacyProductIds.filter(Boolean)));

    if (ids.length === 0) return [];

    const { data: products, error } = await this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .in("id", ids);

    if (error) throw error;

    const { data: inventoryItems, error: inventoryError } = await this.database
      .from("inventory_items")
      .select("*")
      .eq("store_id", this.storeId)
      .in("legacy_product_id", ids);

    if (inventoryError) throw inventoryError;

    return this.mapProductsWithInventory(products ?? [], inventoryItems ?? []);
  }

  async requireAvailableCartItems(
    cart: RawCartRequestItem[]
  ): Promise<UniversalInventoryItem[]> {
    const normalizedCart = this.normalizeCartItems(cart);
    const items = await this.getByLegacyProductIds(
      normalizedCart.map((item) => item.id)
    );

    for (const cartItem of normalizedCart) {
      const inventoryItem = items.find(
        (item) => item.legacyProductId === cartItem.id
      );

      if (!inventoryItem) {
        throw new InventoryEngineError(`Product ${cartItem.id} not found`, 404);
      }

      if (!inventoryItem.inventoryItemId) {
        throw new InventoryEngineError(
          `${inventoryItem.title} is not live inventory`,
          400
        );
      }

      if (inventoryItem.quantity < cartItem.quantity) {
        throw new InventoryEngineError(
          `${inventoryItem.title} does not have enough inventory`,
          400
        );
      }

      if (inventoryItem.status !== "active") {
        throw new InventoryEngineError(
          `${inventoryItem.title} is not available for purchase`,
          400
        );
      }

      if (inventoryItem.price <= 0) {
        throw new InventoryEngineError(
          `${inventoryItem.title} is not priced for checkout`,
          400
        );
      }
    }

    return items;
  }

  normalizeCartItems(cart: unknown): CartRequestItem[] {
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new InventoryEngineError("Cart is empty", 400);
    }

    if (cart.length > 100) {
      throw new InventoryEngineError("Cart has too many line items", 400);
    }

    const quantitiesByProduct = new Map<number, number>();

    for (const rawItem of cart as RawCartRequestItem[]) {
      const productId = positiveInteger(
        rawItem.id ?? rawItem.product_id ?? rawItem.productId
      );
      const quantity = positiveInteger(rawItem.quantity ?? rawItem.qty ?? 1);

      if (!productId) {
        throw new InventoryEngineError("Cart contains an invalid product", 400);
      }

      if (!quantity) {
        throw new InventoryEngineError(
          `Cart quantity for product ${productId} is invalid`,
          400
        );
      }

      const nextQuantity = (quantitiesByProduct.get(productId) ?? 0) + quantity;

      if (nextQuantity > 1_000) {
        throw new InventoryEngineError(
          `Cart quantity for product ${productId} is too large`,
          400
        );
      }

      quantitiesByProduct.set(productId, nextQuantity);
    }

    return Array.from(quantitiesByProduct.entries()).map(([id, quantity]) => ({
      id,
      quantity,
    }));
  }

  async decrementAfterSale(params: {
    legacyProductId: number;
    quantity: number;
    source: string;
  }): Promise<InventoryMutationResult | null> {
    const quantity = positiveInteger(params.quantity);

    if (!quantity) {
      throw new InventoryEngineError("Sale quantity is invalid", 400);
    }

    const item = await this.getByLegacyProductId(params.legacyProductId);

    if (!item) return null;

    const { data, error } = await this.database.rpc(
      "tcos_decrement_inventory_after_sale",
      {
        p_legacy_product_id: item.legacyProductId,
        p_quantity: quantity,
        p_store_id: this.storeId,
      }
    );

    if (error) {
      const message = error.message || "Inventory decrement failed";

      if (message.includes("insufficient_inventory")) {
        throw new InventoryEngineError(
          `${item.title} does not have enough inventory`,
          409
        );
      }

      if (message.includes("inventory_product_not_found")) {
        throw new InventoryEngineError(
          `Product ${params.legacyProductId} not found`,
          404
        );
      }

      throw error;
    }

    const decrementRow = Array.isArray(data) ? data[0] : data;
    const previousQuantity = toNumber(
      decrementRow?.previous_quantity ?? item.quantity
    );
    const newQuantity = toNumber(
      decrementRow?.new_quantity ?? Math.max(previousQuantity - quantity, 0)
    );

    await eventBus.publish(
      "inventory.quantity_changed",
      {
        legacyProductId: item.legacyProductId,
        inventoryItemId: decrementRow?.inventory_item_id ?? item.inventoryItemId,
        sku: item.sku,
        quantity: newQuantity,
      },
      params.source
    );

    return {
      item: {
        ...item,
        quantity: newQuantity,
        status: normalizeStatus(newQuantity),
      },
      previousQuantity,
      newQuantity,
    };
  }

  async markEbayListingInactive(params: {
    sku: string;
    ebayItemId: string | null;
  }): Promise<void> {
    const { data: products, error } = await this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .or(
        params.ebayItemId
          ? `sku.eq.${params.sku},ebay_item_id.eq.${params.ebayItemId}`
          : `sku.eq.${params.sku}`
      );

    if (error) throw error;

    if (!products || products.length === 0) {
      const inventoryItem = await this.repository.getBySku(params.sku);

      if (inventoryItem) {
        await this.repository.update(inventoryItem.id, {
          quantity: 0,
          status: "sold",
        });
      }

      return;
    }

    for (const product of products ?? []) {
      const item = mapUniversal(mapLegacyProduct(product), null);
      await this.setQuantity({
        item,
        quantity: 0,
        source: "ebay-import",
      });
    }
  }

  async upsertFromEbayListing(input: EbayImportInput): Promise<UniversalInventoryItem> {
    const category = input.category ?? input.sport ?? "other_collectable";
    const reviewNote = input.reviewRequired
      ? "Category review required"
      : null;
    const notes = [
      input.ebayItemId ? `eBay listing ${input.ebayItemId}` : null,
      input.categoryConfidence
        ? `Category confidence: ${input.categoryConfidence}`
        : null,
      reviewNote,
    ]
      .filter(Boolean)
      .join(" | ");
    const productData = {
      store_id: this.storeId,
      seller_account_id: null,
      sku: input.sku,
      title: input.title,
      description: input.description ?? "",
      price: input.price,
      player: input.player ?? null,
      sport: input.sport ?? null,
      quantity: input.quantity,
      image_url: input.imageUrl,
      ebay_item_id: input.ebayItemId,
      last_seen_at: new Date().toISOString(),
    };

    let legacyProduct: LegacyProductSnapshot | null = null;

    if (input.ebayItemId) {
      const { data: updatedRows, error: updateError } = await this.database
        .from("products")
        .update(productData)
        .eq("ebay_item_id", input.ebayItemId)
        .eq("store_id", this.storeId)
        .select("*");

      if (updateError) throw updateError;

      if (updatedRows && updatedRows.length > 0) {
        legacyProduct = mapLegacyProduct(updatedRows[0]);
      }
    }

    if (!legacyProduct) {
      const { data: skuMatches, error: lookupError } = await this.database
        .from("products")
        .select("*")
        .eq("sku", input.sku)
        .eq("store_id", this.storeId)
        .limit(1);

      if (lookupError) throw lookupError;

      if (skuMatches && skuMatches.length > 0) {
        const { data: updatedRows, error: updateError } = await this.database
          .from("products")
          .update(productData)
          .eq("id", skuMatches[0].id)
          .eq("store_id", this.storeId)
          .select("*");

        if (updateError) throw updateError;
        legacyProduct = mapLegacyProduct(updatedRows?.[0] ?? skuMatches[0]);
      } else {
        const { data: product, error: insertError } = await this.database
          .from("products")
          .insert(productData)
          .select("*")
          .single();

        if (insertError) throw insertError;

        legacyProduct = mapLegacyProduct(product);
      }
    }

    const inventoryItem = await this.repository.upsertBySku({
      legacy_product_id: legacyProduct.id,
      seller_account_id: legacyProduct.seller_account_id ?? null,
      sku: input.sku,
      title: input.title,
      description: input.description,
      category,
      condition: "unknown",
      status: normalizeStatus(input.quantity),
      quantity: input.quantity,
      price: input.price,
      currency: "USD",
      notes: notes || null,
    });

    try {
      await this.repository.replaceGeneratedAttributes(
        inventoryItem.id,
        Object.entries(input.attributes ?? {}).map(([attribute_name, value]) => ({
          attribute_name,
          attribute_value: value,
        })),
      );
    } catch (attributeError: any) {
      const message = String(attributeError?.message || "").toLowerCase();

      if (
        !message.includes("inventory_attributes") &&
        !message.includes("permission denied")
      ) {
        throw attributeError;
      }
    }

    await eventBus.publish(
      "inventory.ebay_imported",
      {
        inventoryItemId: inventoryItem.id,
        legacyProductId: legacyProduct.id,
        sku: input.sku,
        ebayItemId: input.ebayItemId,
        quantity: input.quantity,
        category,
        categoryConfidence: input.categoryConfidence,
        reviewRequired: input.reviewRequired === true,
      },
      "inventory-engine"
    );

    return mapUniversal(legacyProduct, inventoryItem);
  }

  async createManualProduct(input: ManualProductInput): Promise<UniversalInventoryItem> {
    const generatedDescription =
      input.description ??
      (await this.createGeneratedDescription({
        title: input.title,
        player: input.player,
        sport: input.sport,
        price: input.price,
        quantity: input.quantity,
        status: normalizeStatus(input.quantity),
        sku: null,
        ebayItemId: null,
      }));

    const { data: product, error } = await this.database
      .from("products")
      .insert({
        store_id: this.storeId,
        seller_account_id: null,
        title: input.title,
        player: input.player,
        sport: input.sport,
        price: input.price,
        quantity: input.quantity,
        description: generatedDescription,
        image_url: input.imageUrl,
      })
      .select("*")
      .single();

    if (error) throw error;

    const legacyProduct = mapLegacyProduct(product);
    const inventoryItem = await this.repository.create({
      legacy_product_id: legacyProduct.id,
      sku: legacyProduct.sku,
      title: legacyProduct.title,
      description: generatedDescription,
      category: legacyProduct.sport ?? "sports cards",
      condition: "unknown",
      status: normalizeStatus(legacyProduct.quantity),
      quantity: legacyProduct.quantity,
      price: legacyProduct.price,
      currency: "USD",
    });

    if (legacyProduct.image_url) {
      await this.repository.addImage({
        inventoryItemId: inventoryItem.id,
        imageUrl: legacyProduct.image_url,
        altText: legacyProduct.title,
        isPrimary: true,
      });
    }

    await eventBus.publish(
      "inventory.manual_product_created",
      {
        inventoryItemId: inventoryItem.id,
        legacyProductId: legacyProduct.id,
        quantity: legacyProduct.quantity,
      },
      "inventory-engine"
    );

    return mapUniversal(legacyProduct, inventoryItem);
  }

  async createSellerDraftProduct(
    input: SellerDraftProductInput,
  ): Promise<UniversalInventoryItem> {
    const sku = cleanText(input.sku);
    const ebayItemId = cleanText(input.ebayItemId);
    const authenticityProfile = input.authenticity ?? extractAuthenticityProfile(null);
    const authenticityError = validateAuthenticityProfile(authenticityProfile);

    if (authenticityError) {
      throw new InventoryEngineError(authenticityError, 400);
    }

    let duplicateQuery = this.database
      .from("products")
      .select("id,title,seller_account_id")
      .eq("store_id", this.storeId);

    if (ebayItemId && sku) {
      duplicateQuery = duplicateQuery.or(
        `ebay_item_id.eq.${ebayItemId},sku.eq.${sku}`,
      );
    } else if (ebayItemId) {
      duplicateQuery = duplicateQuery.eq("ebay_item_id", ebayItemId);
    } else if (sku) {
      duplicateQuery = duplicateQuery.eq("sku", sku);
    }

    if (ebayItemId || sku) {
      const { data: duplicates, error: duplicateError } = await duplicateQuery.limit(1);

      if (duplicateError) throw duplicateError;

      if (duplicates && duplicates.length > 0) {
        throw new InventoryEngineError(
          `A store product already exists for ${duplicates[0].title}. Review the staged listing before promoting it.`,
          409,
        );
      }
    }

    const generatedDescription =
      input.description ??
      (await this.createGeneratedDescription({
        title: input.title,
        player: null,
        sport: null,
        price: input.price,
        quantity: input.quantity,
        status: "draft",
        sku: sku,
        ebayItemId: ebayItemId,
        imageUrl: input.imageUrl,
        authenticity: authenticityProfile,
      }));

    const { data: product, error } = await this.database
      .from("products")
      .insert({
        store_id: this.storeId,
        seller_account_id: input.sellerAccountId,
        sku,
        title: input.title,
        player: null,
        sport: null,
        price: input.price,
        quantity: Math.max(0, input.quantity),
        description: generatedDescription,
        image_url: input.imageUrl,
        ebay_item_id: ebayItemId,
        last_seen_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) throw error;

    const legacyProduct = mapLegacyProduct(product);
    const inventoryItem = await this.repository.create({
      seller_account_id: input.sellerAccountId,
      legacy_product_id: legacyProduct.id,
      sku: legacyProduct.sku,
      title: legacyProduct.title,
      description: generatedDescription,
      category: cleanText(input.category) ?? "other_collectable",
      condition: cleanText(input.condition) ?? "unknown",
      status: "draft",
      quantity: Math.max(0, input.quantity),
      price: input.price,
      currency: "USD",
      notes: ebayItemId
        ? `Seller-staged eBay listing ${ebayItemId}`
        : "Seller-staged listing",
      metadata: mergeAuthenticityIntoMetadata({}, authenticityProfile),
    });

    if (legacyProduct.image_url) {
      await this.repository.addImage({
        inventoryItemId: inventoryItem.id,
        imageUrl: legacyProduct.image_url,
        altText: legacyProduct.title,
        isPrimary: true,
      });
    }

    await eventBus.publish(
      "inventory.seller_draft_created",
      {
        inventoryItemId: inventoryItem.id,
        legacyProductId: legacyProduct.id,
        sellerAccountId: input.sellerAccountId,
        quantity: legacyProduct.quantity,
      },
      "inventory-engine",
    );

    return mapUniversal(legacyProduct, inventoryItem);
  }

  async updateProduct(
    legacyProductId: number,
    input: UpdateInventoryProductInput
  ): Promise<UniversalInventoryItem> {
    const current = await this.getByLegacyProductId(legacyProductId);

    if (!current) {
      throw new InventoryEngineError("Product not found", 404);
    }

    const statusError = adminProductStatusChangeError({
      productId: legacyProductId,
      status: input.status,
      quantity: input.quantity,
    });

    if (statusError) {
      throw new InventoryEngineError(statusError, 400);
    }

    const authenticityProfile = input.authenticity ?? current.authenticity;
    const authenticityError = validateAuthenticityProfile(authenticityProfile);

    if (authenticityError) {
      throw new InventoryEngineError(authenticityError, 400);
    }

    const description =
      input.description ??
      (await this.createGeneratedDescription({
        title: input.title,
        player: input.player,
        sport: input.sport,
        price: input.price,
        quantity: input.quantity,
        status: input.status,
        sku: current.sku,
        ebayItemId: current.ebayItemId,
        authenticity: authenticityProfile,
      }));

    const { data: product, error } = await this.database
      .from("products")
      .update({
        title: input.title,
        player: input.player,
        sport: input.sport,
        price: input.price,
        quantity: Math.max(0, input.quantity),
        description,
        image_url: input.imageUrl,
      })
      .eq("id", legacyProductId)
      .eq("store_id", this.storeId)
      .select("*")
      .single();

    if (error) throw error;

    const legacyProduct = mapLegacyProduct(product);
    const inventoryItem = await this.ensureInventoryItem(
      legacyProduct,
      current.inventoryItemId
    );

    const updatedInventoryItem = await this.repository.update(
      inventoryItem.id,
      {
        title: input.title,
        description,
        category: input.sport ?? "sports cards",
        status: input.status,
        quantity: Math.max(0, input.quantity),
        price: input.price,
        metadata: mergeAuthenticityIntoMetadata(
          inventoryItem.metadata,
          authenticityProfile,
        ),
      }
    );

    if (input.imageUrl && input.imageUrl !== current.imageUrl) {
      await this.repository.replacePrimaryImage({
        inventoryItemId: updatedInventoryItem.id,
        imageUrl: input.imageUrl,
        altText: input.title,
      });
    }

    await eventBus.publish(
      "inventory.product_updated",
      {
        inventoryItemId: updatedInventoryItem.id,
        legacyProductId,
        status: input.status,
        quantity: Math.max(0, input.quantity),
      },
      "inventory-engine"
    );

    return mapUniversal(legacyProduct, updatedInventoryItem);
  }

  async regenerateDescription(legacyProductId: number): Promise<UniversalInventoryItem> {
    const current = await this.getByLegacyProductId(legacyProductId);

    if (!current) {
      throw new InventoryEngineError("Product not found", 404);
    }

    const description = await this.createGeneratedDescription({
      title: current.title,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: current.quantity,
      status: current.status,
      sku: current.sku,
      ebayItemId: current.ebayItemId,
      imageUrl: current.imageUrl,
      authenticity: current.authenticity,
    });

    return this.updateProduct(legacyProductId, {
      title: current.title,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: current.quantity,
      status: current.status,
      imageUrl: current.imageUrl,
      description,
    });
  }

  async generateAiDescription(legacyProductId: number): Promise<UniversalInventoryItem> {
    const current = await this.getByLegacyProductId(legacyProductId);

    if (!current) {
      throw new InventoryEngineError("Product not found", 404);
    }

    const fallbackDescription = await this.createGeneratedDescription({
      title: current.title,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: current.quantity,
      status: current.status,
      sku: current.sku,
      ebayItemId: current.ebayItemId,
      imageUrl: current.imageUrl,
      authenticity: current.authenticity,
    });

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return this.updateProduct(legacyProductId, {
        title: current.title,
        player: current.player,
        sport: current.sport,
        price: current.price,
        quantity: current.quantity,
        status: current.status,
        imageUrl: current.imageUrl,
        description: fallbackDescription,
      });
    }

    const prompt = [
      "Write a clean ecommerce description for this sports trading card listing.",
      "Use only the provided facts. Do not invent year, set, grade, condition, autograph, patch, serial number, rookie status, or scarcity.",
      "Keep it professional, buyer-friendly, and under 120 words.",
      "Return only the description text.",
      "",
      `Title: ${current.title}`,
      `Player: ${current.player || "Unknown"}`,
      `Sport: ${current.sport || "Unknown"}`,
      `Price: $${Number(current.price || 0).toFixed(2)}`,
      `Quantity: ${current.quantity}`,
      `Status: ${current.status}`,
      `SKU: ${current.sku || "Not set"}`,
      `eBay listing ID: ${current.ebayItemId || "Not linked"}`,
      `Image URL: ${current.imageUrl || "Not set"}`,
      `Authenticity status: ${authenticityStatusLabel(current.authenticity.status)}`,
      `Certification provider: ${current.authenticity.certProvider || "Not set"}`,
      `Certification number: ${current.authenticity.certNumber || "Not set"}`,
      `Pass guarantee authenticators: ${
        current.authenticity.guaranteedAuthenticators.join(", ") || "Not set"
      }`,
      `Provenance evidence: ${current.authenticity.provenanceEvidence || "Not set"}`,
      `Authenticity notes: ${current.authenticity.authenticityNotes || "Not set"}`,
    ].join("\n");

    let description = fallbackDescription;

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getOpenAIModel(),
          reasoning: { effort: "low" },
          instructions:
            "You write accurate, concise product descriptions for a sports card ecommerce shop.",
          input: prompt,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        description = extractResponseText(data) || fallbackDescription;
      } else {
        console.error("AI description generation failed:", data);
      }
    } catch (error: any) {
      console.error("AI description generation failed:", error.message);
    }

    return this.updateProduct(legacyProductId, {
      title: current.title,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: current.quantity,
      status: current.status,
      imageUrl: current.imageUrl,
      description,
    });
  }

  async setStatus(params: {
    legacyProductId: number;
    status: InventoryStatus;
  }): Promise<UniversalInventoryItem> {
    const current = await this.getByLegacyProductId(params.legacyProductId);

    if (!current) {
      throw new InventoryEngineError("Product not found", 404);
    }

    const statusError = adminProductStatusChangeError({
      productId: params.legacyProductId,
      status: params.status,
      quantity: current.quantity,
    });

    if (statusError) {
      throw new InventoryEngineError(statusError, 400);
    }

    const nextQuantity =
      params.status === "sold" ? 0 : Math.max(0, current.quantity);

    return this.updateProduct(params.legacyProductId, {
      title: current.title,
      description: current.description,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: nextQuantity,
      status: params.status,
      imageUrl: current.imageUrl,
    });
  }

  private async setQuantity(params: {
    item: UniversalInventoryItem;
    quantity: number;
    source: string;
  }): Promise<void> {
    const quantity = Math.max(0, params.quantity);
    const status = normalizeStatus(quantity);

    const { error: productUpdateError } = await this.database
      .from("products")
      .update({ quantity })
      .eq("id", params.item.legacyProductId)
      .eq("store_id", this.storeId);

    if (productUpdateError) throw productUpdateError;

    if (params.item.inventoryItemId) {
      await this.repository.update(params.item.inventoryItemId, {
        quantity,
        status,
      });
    } else if (params.item.sku) {
      await this.repository.upsertBySku({
        legacy_product_id: params.item.legacyProductId,
        sku: params.item.sku,
        title: params.item.title,
        description: params.item.description,
        category: "other",
        condition: "unknown",
        status,
        quantity,
        price: params.item.price,
        currency: "USD",
      });
    }

    await eventBus.publish(
      "inventory.quantity_changed",
      {
        legacyProductId: params.item.legacyProductId,
        inventoryItemId: params.item.inventoryItemId,
        sku: params.item.sku,
        quantity,
      },
      params.source
    );
  }

  private async ensureInventoryItem(
    product: LegacyProductSnapshot,
    inventoryItemId: string | null
  ): Promise<InventoryItem> {
    if (inventoryItemId) {
      const existing = await this.repository.getById(inventoryItemId);

      if (existing) return existing;
    }

    const existingByLegacyId = await this.repository.getByLegacyProductId(
      product.id
    );

    if (existingByLegacyId) return existingByLegacyId;

    if (product.sku) {
      const existingBySku = await this.repository.getBySku(product.sku);

      if (existingBySku) return existingBySku;
    }

    return this.repository.create({
      legacy_product_id: product.id,
      sku: product.sku,
      title: product.title,
      description: product.description,
      category: product.sport ?? "sports cards",
      condition: "unknown",
      status: normalizeStatus(product.quantity),
      quantity: product.quantity,
      price: product.price,
      currency: "USD",
    });
  }
}

export const inventoryEngine = new InventoryEngine();
