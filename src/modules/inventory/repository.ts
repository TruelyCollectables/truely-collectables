import { supabase } from "../../lib/supabase";
import { getActiveStoreId } from "../../lib/stores";
import type {
  CreateInventoryItemInput,
  InventoryImage,
  InventoryItem,
  InventorySearchParams,
  UpdateInventoryItemInput,
} from "./types";

export class InventoryRepository {
  constructor(private readonly storeId = getActiveStoreId()) {}

  async getById(id: string): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("id", id)
      .eq("store_id", this.storeId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    return data as InventoryItem;
  }

  async getByLegacyProductId(legacyProductId: number): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("legacy_product_id", legacyProductId)
      .eq("store_id", this.storeId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    return data as InventoryItem;
  }

  async getBySku(sku: string): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("sku", sku)
      .eq("store_id", this.storeId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    return data as InventoryItem;
  }

  async list(params: InventorySearchParams = {}): Promise<InventoryItem[]> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    let query = supabase
      .from("inventory_items")
      .select("*")
      .eq("store_id", this.storeId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.status) {
      query = query.eq("status", params.status);
    }

    if (params.category) {
      query = query.eq("category", params.category);
    }

    if (params.query) {
      query = query.or(
        `title.ilike.%${params.query}%,sku.ilike.%${params.query}%,description.ilike.%${params.query}%`
      );
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data ?? []) as InventoryItem[];
  }

  async create(input: CreateInventoryItemInput): Promise<InventoryItem> {
    const { data, error } = await supabase
      .from("inventory_items")
      .insert({
        store_id: this.storeId,
        legacy_product_id: input.legacy_product_id ?? null,
        sku: input.sku ?? null,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? "other",
        condition: input.condition ?? "unknown",
        status: input.status ?? "active",
        quantity: input.quantity ?? 1,
        cost: input.cost ?? null,
        price: input.price ?? 0,
        currency: input.currency ?? "USD",
        location: input.location ?? null,
        notes: input.notes ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;

    return data as InventoryItem;
  }

  async upsertBySku(input: CreateInventoryItemInput): Promise<InventoryItem> {
    if (!input.sku) {
      throw new Error("Cannot upsert inventory item without a SKU");
    }

    const existing = await this.getBySku(input.sku);
    const payload = {
      legacy_product_id: input.legacy_product_id ?? null,
      sku: input.sku,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? "other",
      condition: input.condition ?? "unknown",
      status: input.status ?? "active",
      quantity: input.quantity ?? 1,
      cost: input.cost ?? null,
      price: input.price ?? 0,
      currency: input.currency ?? "USD",
      location: input.location ?? null,
      notes: input.notes ?? null,
    };

    if (existing) {
      return this.update(existing.id, payload);
    }

    return this.create(payload);
  }

  async update(id: string, input: UpdateInventoryItemInput): Promise<InventoryItem> {
    const { data, error } = await supabase
      .from("inventory_items")
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("store_id", this.storeId)
      .select("*")
      .single();

    if (error) throw error;

    return data as InventoryItem;
  }

  async archive(id: string): Promise<InventoryItem> {
    return this.update(id, {
      status: "archived",
    });
  }

  async getImages(inventoryItemId: string): Promise<InventoryImage[]> {
    const { data, error } = await supabase
      .from("inventory_images")
      .select("*")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return (data ?? []) as InventoryImage[];
  }

  async addImage(input: {
    inventoryItemId: string;
    imageUrl: string;
    altText?: string | null;
    sortOrder?: number;
    isPrimary?: boolean;
  }): Promise<InventoryImage> {
    const { data, error } = await supabase
      .from("inventory_images")
      .insert({
        inventory_item_id: input.inventoryItemId,
        image_url: input.imageUrl,
        alt_text: input.altText ?? null,
        sort_order: input.sortOrder ?? 0,
        is_primary: input.isPrimary ?? false,
      })
      .select("*")
      .single();

    if (error) throw error;

    return data as InventoryImage;
  }

  async replacePrimaryImage(input: {
    inventoryItemId: string;
    imageUrl: string;
    altText?: string | null;
  }): Promise<InventoryImage> {
    const { error: updateError } = await supabase
      .from("inventory_images")
      .update({ is_primary: false })
      .eq("inventory_item_id", input.inventoryItemId);

    if (updateError) throw updateError;

    return this.addImage({
      inventoryItemId: input.inventoryItemId,
      imageUrl: input.imageUrl,
      altText: input.altText ?? null,
      sortOrder: 0,
      isPrimary: true,
    });
  }
}

export const inventoryRepository = new InventoryRepository();
