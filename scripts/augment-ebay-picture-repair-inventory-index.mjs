import fs from "node:fs";

const routePath = process.argv[2];
if (!routePath) {
  throw new Error(
    "Usage: node augment-ebay-picture-repair-inventory-index.mjs <route-path>",
  );
}

let source = fs.readFileSync(routePath, "utf8");

const functionMarker =
  "async function getInventoryImages(accessToken: string, skus: string[]) {";
if (!source.includes(functionMarker)) {
  throw new Error("Inventory image function marker was not found.");
}

const sellerInventoryFunctions = `
type SellerInventoryRecord = {
  sku?: string;
  product?: {
    title?: string;
    imageUrls?: string[];
  };
};

function sellerTitleKey(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\\s+/g, " ");
}

async function getSellerInventoryIndex(accessToken: string) {
  const items: SellerInventoryRecord[] = [];
  const pages: Array<{
    offset: number;
    status: number;
    size: number;
    total: number | null;
  }> = [];
  const limit = 100;
  let offset = 0;
  let total: number | null = null;
  let error: string | null = null;

  for (let page = 0; page < 100; page += 1) {
    try {
      const url = new URL(
        "https://api.ebay.com/sell/inventory/v1/inventory_item",
      );
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Language": "en-US",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => ({}));
      const batch = Array.isArray(payload.inventoryItems)
        ? (payload.inventoryItems as SellerInventoryRecord[])
        : [];
      const reportedTotal = Number(payload.total);
      if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
        total = reportedTotal;
      }
      pages.push({
        offset,
        status: response.status,
        size: batch.length,
        total,
      });
      if (!response.ok) {
        error = JSON.stringify(payload?.errors || payload).slice(0, 800);
        break;
      }
      items.push(...batch);
      if (
        batch.length === 0 ||
        batch.length < limit ||
        (total !== null && items.length >= total)
      ) {
        break;
      }
      offset += batch.length;
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message.slice(0, 800)
          : String(caught).slice(0, 800);
      break;
    }
  }

  return { items, pages, total, error };
}

async function getOffersForSellerSku(accessToken: string, sku: string) {
  try {
    const url = new URL("https://api.ebay.com/sell/inventory/v1/offer");
    url.searchParams.set("sku", sku);
    url.searchParams.set("marketplace_id", "EBAY_US");
    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Language": "en-US",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    const offers = Array.isArray(payload.offers) ? payload.offers : [];
    return {
      status: response.status,
      offers,
      error: response.ok
        ? null
        : JSON.stringify(payload?.errors || payload).slice(0, 800),
    };
  } catch (caught) {
    return {
      status: 0,
      offers: [] as Array<Record<string, unknown>>,
      error:
        caught instanceof Error
          ? caught.message.slice(0, 800)
          : String(caught).slice(0, 800),
    };
  }
}

async function matchSellerInventoryImages(params: {
  accessToken: string;
  sellerInventory: SellerInventoryRecord[];
  productTitle: string;
  ebayItemId: string;
}) {
  const productKey = sellerTitleKey(params.productTitle);
  const ebayItemId = String(params.ebayItemId || "").trim();
  const candidates = params.sellerInventory.filter((record) => {
    const sku = String(record.sku || "");
    const titleKey = sellerTitleKey(record.product?.title);
    const titleMatches =
      Boolean(productKey && titleKey) &&
      (titleKey === productKey ||
        productKey.startsWith(titleKey) ||
        titleKey.startsWith(productKey));
    const skuMatches = Boolean(ebayItemId && sku.includes(ebayItemId));
    return titleMatches || skuMatches;
  });

  const exactListingMatches: SellerInventoryRecord[] = [];
  const offerChecks: Array<{
    sku: string;
    status: number;
    listingIds: string[];
    matched: boolean;
    error: string | null;
  }> = [];

  for (const candidate of candidates.slice(0, 20)) {
    const sku = String(candidate.sku || "").trim();
    if (!sku) continue;
    const offerResult = await getOffersForSellerSku(
      params.accessToken,
      sku,
    );
    const listingIds = offerResult.offers
      .map((offer: any) => String(offer?.listing?.listingId || "").trim())
      .filter(Boolean);
    const matched = Boolean(
      ebayItemId && listingIds.some((listingId) => listingId === ebayItemId),
    );
    offerChecks.push({
      sku,
      status: offerResult.status,
      listingIds,
      matched,
      error: offerResult.error,
    });
    if (matched) exactListingMatches.push(candidate);
  }

  const exactTitleCandidates = candidates.filter(
    (record) => sellerTitleKey(record.product?.title) === productKey,
  );
  const fallbackTitleMatch =
    exactListingMatches.length === 0 && exactTitleCandidates.length === 1;
  const selected = exactListingMatches.length
    ? exactListingMatches
    : fallbackTitleMatch
      ? exactTitleCandidates
      : [];

  return {
    candidateSkus: candidates
      .map((record) => String(record.sku || "").trim())
      .filter(Boolean),
    selectedSkus: selected
      .map((record) => String(record.sku || "").trim())
      .filter(Boolean),
    selectedTitles: selected
      .map((record) => String(record.product?.title || "").trim())
      .filter(Boolean),
    images: normalize(
      selected.flatMap((record) =>
        Array.isArray(record.product?.imageUrls)
          ? record.product.imageUrls
          : [],
      ),
    ),
    offerChecks,
    fallbackTitleMatch,
  };
}

`;

source = source.replace(
  functionMarker,
  sellerInventoryFunctions + functionMarker,
);

const productQueryMarker = "const { data: productData, error: productError }";
if (!source.includes(productQueryMarker)) {
  throw new Error("Product query marker was not found.");
}
source = source.replace(
  productQueryMarker,
  [
    "const sellerInventoryIndex = await getSellerInventoryIndex(accessToken);",
    "",
    productQueryMarker,
  ].join("\n"),
);

const browseMarker = "const browse =";
const browseIndex = source.indexOf(browseMarker);
if (browseIndex < 0) {
  throw new Error("Browse source marker was not found.");
}
const browseLineStart = source.lastIndexOf("\n", browseIndex) + 1;
const indent = source.slice(browseLineStart, browseIndex);
const sellerMatchBlock = [
  `${indent}const sellerInventoryMatch = await matchSellerInventoryImages({`,
  `${indent}  accessToken,`,
  `${indent}  sellerInventory: sellerInventoryIndex.items,`,
  `${indent}  productTitle: product.title,`,
  `${indent}  ebayItemId: String(product.ebay_item_id || ""),`,
  `${indent}});`,
  `${indent}`,
].join("\n");
source =
  source.slice(0, browseLineStart) +
  sellerMatchBlock +
  source.slice(browseLineStart);

const trustedMarker = `${indent}  ...inventoryApi.images,`;
if (!source.includes(trustedMarker)) {
  throw new Error("Trusted image aggregation marker was not found.");
}
source = source.replace(
  trustedMarker,
  [
    trustedMarker,
    `${indent}  ...sellerInventoryMatch.images,`,
  ].join("\n"),
);

const receiptMarker = "tradingError: trading.error,";
const receiptIndex = source.indexOf(receiptMarker);
if (receiptIndex < 0) {
  throw new Error("Per-product receipt marker was not found.");
}
const receiptLineStart = source.lastIndexOf("\n", receiptIndex) + 1;
const receiptIndent = source.slice(receiptLineStart, receiptIndex);
const receiptFields = [
  `${receiptIndent}sellerInventoryCandidateSkus:`,
  `${receiptIndent}  sellerInventoryMatch.candidateSkus,`,
  `${receiptIndent}sellerInventorySelectedSkus:`,
  `${receiptIndent}  sellerInventoryMatch.selectedSkus,`,
  `${receiptIndent}sellerInventorySelectedTitles:`,
  `${receiptIndent}  sellerInventoryMatch.selectedTitles,`,
  `${receiptIndent}sellerInventoryImages: sellerInventoryMatch.images,`,
  `${receiptIndent}sellerInventoryOfferChecks:`,
  `${receiptIndent}  sellerInventoryMatch.offerChecks,`,
  `${receiptIndent}sellerInventoryFallbackTitleMatch:`,
  `${receiptIndent}  sellerInventoryMatch.fallbackTitleMatch,`,
].join("\n");
source =
  source.slice(0, receiptLineStart) +
  receiptFields +
  "\n" +
  source.slice(receiptLineStart);

const rootReceiptMarker = "requestedProducts: TARGET_IDS.length,";
if (!source.includes(rootReceiptMarker)) {
  throw new Error("Root receipt marker was not found.");
}
source = source.replace(
  rootReceiptMarker,
  [
    "sellerInventoryIndex: {",
    "  itemCount: sellerInventoryIndex.items.length,",
    "  total: sellerInventoryIndex.total,",
    "  pages: sellerInventoryIndex.pages,",
    "  error: sellerInventoryIndex.error,",
    "},",
    rootReceiptMarker,
  ].join("\n"),
);

fs.writeFileSync(routePath, source);
console.log(`Augmented seller inventory matching in ${routePath}`);
