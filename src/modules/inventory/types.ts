export type InventoryStatus = "draft" | "active" | "reserved" | "sold" | "archived";

export type InventoryItem = {
  id: string;
  store_id: string;
  legacy_product_id: number | null;
  sku: string | null;
  title: string;
  description: string | null;
  category: string;
  condition: string;
  status: InventoryStatus;
  quantity: number;
  cost: number | null;
  price: number;
  currency: string;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LegacyProductSnapshot = {
  id: number;
  sku: string | null;
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
  ebay_item_id: string | null;
};

export type UniversalInventoryItem = {
  inventoryItemId: string | null;
  legacyProductId: number;
  sku: string | null;
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  status: InventoryStatus;
  source: "inventory_items" | "products";
};

export type InventoryImage = {
  id: string;
  inventory_item_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
};

export type InventoryAttribute = {
  id: string;
  inventory_item_id: string;
  attribute_name: string;
  attribute_value: string | null;
  created_at: string;
};

export type InventorySearchParams = {
  query?: string;
  category?: string;
  status?: InventoryStatus;
  limit?: number;
  offset?: number;
};

export type CreateInventoryItemInput = {
  legacy_product_id?: number | null;
  sku?: string | null;
  title: string;
  description?: string | null;
  category?: string;
  condition?: string;
  status?: InventoryStatus;
  quantity?: number;
  cost?: number | null;
  price?: number;
  currency?: string;
  location?: string | null;
  notes?: string | null;
};

export type UpdateInventoryItemInput = Partial<CreateInventoryItemInput>;

export type UpdateInventoryProductInput = {
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  status: InventoryStatus;
  imageUrl: string | null;
};

export type InventoryDescriptionInput = {
  title: string;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  status: InventoryStatus;
  sku: string | null;
  ebayItemId: string | null;
  imageUrl?: string | null;
};

export type InventoryBridgeIssue =
  | "missing_inventory_item"
  | "quantity_mismatch"
  | "price_mismatch"
  | "sku_link_only"
  | "sold_out"
  | "ok";

export type InventoryBridgeRow = {
  legacyProductId: number;
  inventoryItemId: string | null;
  title: string;
  sku: string | null;
  ebayItemId: string | null;
  productQuantity: number;
  inventoryQuantity: number | null;
  productPrice: number;
  inventoryPrice: number | null;
  status: InventoryStatus;
  source: "inventory_items" | "products";
  issues: InventoryBridgeIssue[];
};

export type InventoryBridgeStatus = {
  storeId: string;
  totalProducts: number;
  bridgedItems: number;
  missingInventoryItems: number;
  skuLinkedItems: number;
  quantityMismatches: number;
  priceMismatches: number;
  activeItems: number;
  soldOutItems: number;
  ebayLinkedItems: number;
  rows: InventoryBridgeRow[];
};

export type InventoryBackfillResult = {
  storeId: string;
  scanned: number;
  created: number;
  updated: number;
  imagesAdded: number;
  failed: Array<{
    legacyProductId: number;
    title: string;
    message: string;
  }>;
};
