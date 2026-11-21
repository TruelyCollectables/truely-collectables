import type { SupabaseClient } from "@supabase/supabase-js";

// Keyset paging avoids the Supabase per-request row cap and unstable offset pages.
// Every in-stock, non-archived product must be selectable for a website sale.
const PAGE_SIZE = 750;
const MAX_PAGES = 50;

export type SaleEligibleProduct = {
  id: number;
  title: string | null;
  player: string | null;
  sport: string | null;
  price: number | null;
  quantity: number | null;
  image_url: string | null;
};

export async function loadSaleEligibleProducts(
  supabase: SupabaseClient,
  storeId: string,
): Promise<SaleEligibleProduct[]> {
  const rows: SaleEligibleProduct[] = [];
  let beforeId: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from("products")
      .select("id,title,player,sport,price,quantity,image_url")
      .eq("store_id", storeId)
      .gt("price", 0)
      .gt("quantity", 0)
      .is("archived_at", null)
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);

    if (beforeId !== null) query = query.lt("id", beforeId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data || []) as SaleEligibleProduct[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;

    const lastId = Number(batch[batch.length - 1]?.id);
    if (!Number.isSafeInteger(lastId) || lastId < 1) {
      throw new Error("Invalid product ID while paging sale inventory.");
    }
    beforeId = lastId;
  }

  throw new Error("Sale inventory exceeded the safe pagination limit.");
}
