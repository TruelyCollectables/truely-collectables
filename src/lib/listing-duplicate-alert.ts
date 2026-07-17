export type ListingDuplicateAlertMatch = {
  legacyProductId: number;
  title: string;
  sku: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  lastSeenAt: string | null;
};

export type ListingDuplicateAlert = {
  matchType: "normalized_title";
  checkedTitle: string;
  normalizedTitle: string;
  requestedPrice: number;
  matchedPrice: number | null;
  priceMatched: boolean;
  mergeUrl: string;
  message: string;
  matches: ListingDuplicateAlertMatch[];
};

type ProductDuplicateRow = {
  id: number | string;
  title: string | null;
  sku: string | null;
  price: number | string | null;
  quantity: number | string | null;
  image_url: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
};

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function normalizeListingDuplicateTitle(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(listing|lot|card|cards)\b/g, " ")
    .replace(/[^a-z0-9#/.+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findListingDuplicateAlert(params: {
  supabase: any;
  storeId: string;
  sellerAccountId: string | null;
  title: string;
  requestedPrice: number;
  excludeLegacyProductIds?: Array<number | null | undefined>;
}): Promise<ListingDuplicateAlert | null> {
  const normalizedTitle = normalizeListingDuplicateTitle(params.title);

  if (!normalizedTitle) return null;

  let query = params.supabase
    .from("products")
    .select("id,title,sku,price,quantity,image_url,ebay_item_id,last_seen_at")
    .eq("store_id", params.storeId)
    .gt("quantity", 0)
    .limit(5000);

  query = params.sellerAccountId
    ? query.eq("seller_account_id", params.sellerAccountId)
    : query.is("seller_account_id", null);

  const { data, error } = await query;

  if (error) throw error;

  const excluded = new Set(
    (params.excludeLegacyProductIds || [])
      .map((id) => Number(id || 0))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
  const matches = ((data || []) as ProductDuplicateRow[])
    .filter((row) => {
      const productId = Number(row.id || 0);

      if (!Number.isInteger(productId) || productId <= 0 || excluded.has(productId)) {
        return false;
      }

      return normalizeListingDuplicateTitle(row.title) === normalizedTitle;
    })
    .map<ListingDuplicateAlertMatch>((row) => ({
      legacyProductId: Number(row.id),
      title: row.title || "Untitled listing",
      sku: row.sku || null,
      price: moneyNumber(row.price),
      quantity: wholeQuantity(row.quantity),
      imageUrl: row.image_url || null,
      ebayItemId: row.ebay_item_id || null,
      lastSeenAt: row.last_seen_at || null,
    }))
    .sort((left, right) => {
      if (Boolean(right.ebayItemId) !== Boolean(left.ebayItemId)) {
        return Number(Boolean(right.ebayItemId)) - Number(Boolean(left.ebayItemId));
      }

      return right.quantity - left.quantity;
    })
    .slice(0, 10);

  if (matches.length === 0) return null;

  const pricedMatch = matches.find((match) => match.price > 0) || matches[0];
  const matchedPrice = pricedMatch.price > 0 ? pricedMatch.price : null;
  const requestedPrice = moneyNumber(params.requestedPrice);
  const priceMatched =
    matchedPrice !== null && Math.round(matchedPrice * 100) !== Math.round(requestedPrice * 100);
  const matchWord = matches.length === 1 ? "listing" : "listings";

  return {
    matchType: "normalized_title",
    checkedTitle: params.title,
    normalizedTitle,
    requestedPrice,
    matchedPrice,
    priceMatched,
    mergeUrl: "/admin/ebay/duplicates",
    message: matchedPrice
      ? `Possible duplicate found: ${matches.length} active ${matchWord}. Price matched to existing ${matchedPrice.toLocaleString(
          "en-US",
          { style: "currency", currency: "USD" },
        )}; review/merge before going live.`
      : `Possible duplicate found: ${matches.length} active ${matchWord}. Review/merge before going live.`,
    matches,
  };
}
