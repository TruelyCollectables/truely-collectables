export {};

declare global {
  type InventoryRow = {
    id: string;
    legacy_product_id: number | null;
    seller_account_id: string | null;
    title: string | null;
    category: string | null;
    status: string | null;
    price: number | string | null;
    metadata: Record<string, unknown> | null;
  };

  type ProductRow = {
    id: number;
    title: string | null;
    ebay_item_id: string | null;
    sport: string | null;
    player: string | null;
  };
}
