import type { SellerSweepVerifiedSale } from "./instacomp-seller-sweep-economics";
import type { SellerSweepCardCandidate } from "./instacomp-seller-sweep-identify";
import type { RegistryMatch } from "./instacomp-learning-server";

export type MarketIdentityRow = {
  id: string;
  collectible_type: string | null;
  season_year: string | null;
  manufacturer: string | null;
  brand: string | null;
  product_line: string | null;
  set_name: string | null;
  insert_name: string | null;
  card_number: string | null;
  parallel_name: string | null;
  variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
  condition_type: string | null;
  grading_company: string | null;
  grade: string | null;
  identity_confidence: number | null;
};

export type ReceiptCompRow = {
  id: string;
  marketplace_id: string | null;
  external_sale_id: string | null;
  source_url: string | null;
  sold_at: string | null;
  sold_price: number | null;
  shipping_price: number | null;
  quantity: number | null;
  verified: boolean;
  match_confidence: number | null;
  excluded: boolean;
  outlier_flag: boolean;
  metadata: Record<string, unknown> | null;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "");
}

function yearStart(value: unknown) {
  return String(value ?? "").match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isEbayUrl(value: unknown) {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase();
    return hostname === "ebay.com" || hostname.endsWith(".ebay.com");
  } catch {
    return false;
  }
}

export function findExactSellerSweepMarketIdentity(params: {
  card: SellerSweepCardCandidate;
  registryMatch: RegistryMatch;
  rows: MarketIdentityRow[];
}) {
  const expectedCatalogNames = new Set(
    [params.registryMatch.product, params.registryMatch.setName, params.card.setName]
      .map(normalized)
      .filter(Boolean),
  );
  const expectedBrands = new Set(
    [params.registryMatch.manufacturer, params.registryMatch.brand, params.card.brand]
      .map(normalized)
      .filter(Boolean),
  );
  const conditionType = params.card.isGraded ? "graded" : "raw";

  const matches = params.rows.filter((row) => {
    const catalogNames = [row.product_line, row.set_name, row.insert_name]
      .map(normalized)
      .filter(Boolean);
    const serialRun = numberOrNull(row.serial_numbered_to);
    return (
      normalized(row.collectible_type) === "sports card" &&
      yearStart(row.season_year) === yearStart(params.registryMatch.year) &&
      normalizedCardNumber(row.card_number) ===
        normalizedCardNumber(params.registryMatch.cardNumber) &&
      expectedBrands.has(normalized(row.manufacturer)) &&
      (!normalized(row.brand) || expectedBrands.has(normalized(row.brand))) &&
      catalogNames.length > 0 &&
      catalogNames.some((value) => expectedCatalogNames.has(value)) &&
      normalized(row.parallel_name) === normalized(params.registryMatch.parallel) &&
      normalized(row.variation_name) === normalized(params.registryMatch.variation) &&
      serialRun === numberOrNull(params.registryMatch.serialRun) &&
      row.autograph === params.card.isAutograph &&
      row.memorabilia === params.card.isRelic &&
      normalized(row.condition_type) === conditionType &&
      (conditionType === "raw" ||
        (normalized(row.grading_company) === normalized(params.card.gradingCompany) &&
          normalized(row.grade) === normalized(params.card.grade))) &&
      Number(row.identity_confidence) === 100
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

export function sellerSweepVerifiedReceiptSales(
  rows: ReceiptCompRow[],
  nowInput: Date | number = new Date(),
): SellerSweepVerifiedSale[] {
  const now = nowInput instanceof Date ? nowInput.getTime() : Number(nowInput);
  const seen = new Set<string>();
  const sales: SellerSweepVerifiedSale[] = [];

  for (const row of rows) {
    const metadata =
      row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const price = numberOrNull(row.sold_price);
    const shipping = numberOrNull(row.shipping_price);
    const soldAt = Date.parse(String(row.sold_at || ""));
    const marketplaceId = String(row.marketplace_id || "").trim();
    const externalSaleId = String(row.external_sale_id || "").trim();
    const saleId =
      marketplaceId && externalSaleId
        ? `${marketplaceId}:${externalSaleId}`
        : "";
    const eligible =
      row.verified === true &&
      row.excluded === false &&
      row.outlier_flag === false &&
      Number(row.match_confidence) === 100 &&
      Number(row.quantity) === 1 &&
      price !== null &&
      price > 0 &&
      shipping !== null &&
      shipping >= 0 &&
      Boolean(saleId) &&
      !seen.has(saleId) &&
      isEbayUrl(row.source_url) &&
      Number.isFinite(soldAt) &&
      soldAt <= now &&
      String(metadata.currency || "").toUpperCase() === "USD" &&
      metadata.verified_from === "connected_ebay_buyer_order" &&
      metadata.connected_buyer_order_verified === true &&
      Number(metadata.receipt_order_line_count) === 1 &&
      metadata.independently_verified === true &&
      metadata.exact_identity_confirmed === true &&
      metadata.final_price_confirmed === true &&
      metadata.shipping_price_confirmed === true;
    if (!eligible) continue;

    seen.add(saleId);
    sales.push({
      saleId,
      price,
      shipping,
      soldAt: new Date(soldAt).toISOString(),
      currency: "USD",
      sourceUrl: String(row.source_url),
      independentlyVerified: true,
      exactIdentityMatch: true,
      finalPriceConfirmed: true,
    });
  }

  return sales;
}
