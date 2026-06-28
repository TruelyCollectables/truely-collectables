import { supabase } from "../../lib/supabase";
import { getActiveStoreId } from "../../lib/stores";
import { eventBus } from "../../core/events/event-bus";
import { InventoryRepository, inventoryRepository } from "./repository";
import type {
  InventoryItem,
  InventoryStatus,
  InventoryDescriptionInput,
  LegacyProductSnapshot,
  UpdateInventoryProductInput,
  UniversalInventoryItem,
} from "./types";

type CartRequestItem = {
  id: number;
  quantity: number;
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
    sku: product.sku ?? null,
    title: String(product.title ?? "Untitled"),
    description: product.description ?? null,
    price: toNumber(product.price),
    quantity: toNumber(product.quantity),
    image_url: product.image_url ?? null,
    ebay_item_id: product.ebay_item_id ?? null,
    player: product.player ?? null,
    sport: product.sport ?? null,
  };
}

function mapUniversal(
  product: LegacyProductSnapshot,
  inventoryItem: InventoryItem | null
): UniversalInventoryItem {
  if (inventoryItem) {
    return {
      inventoryItemId: inventoryItem.id,
      legacyProductId: product.id,
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
    };
  }

  return {
    inventoryItemId: null,
    legacyProductId: product.id,
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
  };
}

function cleanText(value: string | null | undefined) {
  return value?.trim() || null;
}

function getOpenAIModel() {
  return process.env.OPENAI_DESCRIPTION_MODEL || "gpt-5.5";
}

export function generateInventoryDescription(input: InventoryDescriptionInput) {
  const title = cleanText(input.title) ?? "This card";
  const player = cleanText(input.player);
  const sport = cleanText(input.sport);
  const identifier = player && sport ? `${player} ${sport}` : player ?? sport;
  const availability =
    input.status === "active" && input.quantity > 0
      ? `${input.quantity} available`
      : input.status.replaceAll("_", " ");

  const lines = [
    `${title} is available from Truely Collectables.`,
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
  constructor(
    private readonly storeId = getActiveStoreId(),
    private readonly repository: InventoryRepository = inventoryRepository
  ) {}

  async listAvailable(
    params: {
      query?: string;
      sport?: string;
    } = {}
  ): Promise<UniversalInventoryItem[]> {
    let query = supabase
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

    const { data: products, error } = await query;

    if (error) throw error;

    const items: UniversalInventoryItem[] = [];

    for (const product of products ?? []) {
      const legacyProduct = mapLegacyProduct(product);
      const inventoryItem =
        (await this.repository.getByLegacyProductId(legacyProduct.id)) ??
        (legacyProduct.sku
          ? await this.repository.getBySku(legacyProduct.sku)
          : null);
      const item = mapUniversal(legacyProduct, inventoryItem);

      if (item.quantity > 0 && item.status === "active") {
        items.push(item);
      }
    }

    return items;
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(items.map((item) => item.sport).filter(Boolean) as string[])
    ).sort();
  }

  async listAll(): Promise<UniversalInventoryItem[]> {
    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .order("id");

    if (error) throw error;

    const items: UniversalInventoryItem[] = [];

    for (const product of products ?? []) {
      const legacyProduct = mapLegacyProduct(product);
      const inventoryItem =
        (await this.repository.getByLegacyProductId(legacyProduct.id)) ??
        (legacyProduct.sku
          ? await this.repository.getBySku(legacyProduct.sku)
          : null);

      items.push(mapUniversal(legacyProduct, inventoryItem));
    }

    return items;
  }

  async getByLegacyProductId(
    legacyProductId: number
  ): Promise<UniversalInventoryItem | null> {
    const { data: product, error } = await supabase
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

    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .in("id", ids);

    if (error) throw error;

    const universalItems: UniversalInventoryItem[] = [];

    for (const product of products ?? []) {
      const legacyProduct = mapLegacyProduct(product);
      const inventoryItem =
        (await this.repository.getByLegacyProductId(legacyProduct.id)) ??
        (legacyProduct.sku
          ? await this.repository.getBySku(legacyProduct.sku)
          : null);

      universalItems.push(mapUniversal(legacyProduct, inventoryItem));
    }

    return universalItems;
  }

  async requireAvailableCartItems(
    cart: CartRequestItem[]
  ): Promise<UniversalInventoryItem[]> {
    const items = await this.getByLegacyProductIds(cart.map((item) => item.id));

    for (const cartItem of cart) {
      const inventoryItem = items.find(
        (item) => item.legacyProductId === cartItem.id
      );

      if (!inventoryItem) {
        throw new InventoryEngineError(`Product ${cartItem.id} not found`, 404);
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
    }

    return items;
  }

  async decrementAfterSale(params: {
    legacyProductId: number;
    quantity: number;
    source: string;
  }): Promise<InventoryMutationResult | null> {
    const item = await this.getByLegacyProductId(params.legacyProductId);

    if (!item) return null;

    const previousQuantity = item.quantity;
    const newQuantity = Math.max(previousQuantity - params.quantity, 0);

    await this.setQuantity({
      item,
      quantity: newQuantity,
      source: params.source,
    });

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
    const { data: products, error } = await supabase
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
    const productData = {
      store_id: this.storeId,
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
      const { data: updatedRows, error: updateError } = await supabase
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
      const { data: product, error: upsertError } = await supabase
        .from("products")
        .upsert(productData, { onConflict: "sku" })
        .select("*")
        .single();

      if (upsertError) throw upsertError;

      legacyProduct = mapLegacyProduct(product);
    }

    const inventoryItem = await this.repository.upsertBySku({
      legacy_product_id: legacyProduct.id,
      sku: input.sku,
      title: input.title,
      description: input.description,
      category: input.sport ?? "sports cards",
      condition: "unknown",
      status: normalizeStatus(input.quantity),
      quantity: input.quantity,
      price: input.price,
      currency: "USD",
      notes: input.ebayItemId ? `eBay listing ${input.ebayItemId}` : null,
    });

    await eventBus.publish(
      "inventory.ebay_imported",
      {
        inventoryItemId: inventoryItem.id,
        legacyProductId: legacyProduct.id,
        sku: input.sku,
        ebayItemId: input.ebayItemId,
        quantity: input.quantity,
      },
      "inventory-engine"
    );

    return mapUniversal(legacyProduct, inventoryItem);
  }

  async createManualProduct(input: ManualProductInput): Promise<UniversalInventoryItem> {
    const generatedDescription = input.description ?? generateInventoryDescription({
      title: input.title,
      player: input.player,
      sport: input.sport,
      price: input.price,
      quantity: input.quantity,
      status: normalizeStatus(input.quantity),
      sku: null,
      ebayItemId: null,
    });

    const { data: product, error } = await supabase
      .from("products")
      .insert({
        store_id: this.storeId,
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

  async updateProduct(
    legacyProductId: number,
    input: UpdateInventoryProductInput
  ): Promise<UniversalInventoryItem> {
    const current = await this.getByLegacyProductId(legacyProductId);

    if (!current) {
      throw new InventoryEngineError("Product not found", 404);
    }

    const description = input.description ?? generateInventoryDescription({
      title: input.title,
      player: input.player,
      sport: input.sport,
      price: input.price,
      quantity: input.quantity,
      status: input.status,
      sku: current.sku,
      ebayItemId: current.ebayItemId,
    });

    const { data: product, error } = await supabase
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

    const description = generateInventoryDescription({
      title: current.title,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: current.quantity,
      status: current.status,
      sku: current.sku,
      ebayItemId: current.ebayItemId,
      imageUrl: current.imageUrl,
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

    const fallbackDescription = generateInventoryDescription({
      title: current.title,
      player: current.player,
      sport: current.sport,
      price: current.price,
      quantity: current.quantity,
      status: current.status,
      sku: current.sku,
      ebayItemId: current.ebayItemId,
      imageUrl: current.imageUrl,
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

    const { error: productUpdateError } = await supabase
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
