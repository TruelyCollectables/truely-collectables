import fs from "node:fs";
import path from "node:path";

const [sourceWorkflowPath, routePath, token] = process.argv.slice(2);
if (!sourceWorkflowPath || !routePath || !token) {
  throw new Error("Usage: node generate-ebay-picture-repair-route.mjs <source-workflow> <route-path> <token>");
}

const workflow = fs.readFileSync(sourceWorkflowPath, "utf8");
const marker =
  "cat > src/app/api/internal/ebay-hidden-image-repair/route.ts <<'ROUTE'";
const markerIndex = workflow.indexOf(marker);
if (markerIndex < 0) throw new Error("Embedded repair route marker was not found.");

const contentStart = workflow.indexOf("\n", markerIndex) + 1;
const contentEnd = workflow.indexOf("\n          ROUTE", contentStart);
if (contentStart <= 0 || contentEnd < 0) {
  throw new Error("Embedded repair route boundaries were not found.");
}

let source = workflow
  .slice(contentStart, contentEnd)
  .split("\n")
  .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
  .join("\n");

source = source
  .replace(
    "../../../../../lib/supabase-server",
    "../../../../lib/supabase-server",
  )
  .replace(/^.*lib\/stores.*\n/m, "")
  .replace(
    "const storeId = getActiveStoreId();",
    'const storeId = "00000000-0000-4000-8000-000000000001";',
  )
  .replace("const CONCURRENCY = 5;", "const CONCURRENCY = 2;");

const authMarker =
  'const expected = process.env.EBAY_HIDDEN_IMAGE_REPAIR_TOKEN || "";';
if (!source.includes(authMarker)) {
  throw new Error("Repair authentication marker was not found.");
}
source = source.replace(authMarker, `const expected = "${token}";`);

const inventoryMarker =
  "async function getInventoryImages(accessToken: string, skus: string[]) {";
if (!source.includes(inventoryMarker)) {
  throw new Error("Inventory image reader marker was not found.");
}

const publicReader = `
function collectPublicImageValues(value: unknown, output: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    if (value.includes("i.ebayimg.com")) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPublicImageValues(entry, output);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("image") ||
      normalizedKey.includes("zoom") ||
      normalizedKey.includes("thumbnail")
    ) {
      collectPublicImageValues(entry, output);
    } else if (entry && typeof entry === "object") {
      collectPublicImageValues(entry, output);
    }
  }
}

async function getPublicListingImages(itemId: string) {
  try {
    const listingUrl =
      "https://www.ebay.com/itm/" + encodeURIComponent(itemId);
    const response = await fetch(listingUrl, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const html = await response.text();
    const decoded = html
      .replace(/\\\\u002F/gi, "/")
      .replace(/\\\\u0026/gi, "&")
      .replace(/&amp;/g, "&");

    const structured: string[] = [];
    for (const match of decoded.matchAll(
      /<script[^>]+type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi,
    )) {
      try {
        collectPublicImageValues(JSON.parse(match[1]), structured);
      } catch {
        // Ignore malformed structured-data blocks.
      }
    }

    const attributes = Array.from(
      decoded.matchAll(
        /(?:src|data-src|data-zoom-src|href)=["'](https:\\/\\/i\\.ebayimg\\.com\\/[^"'<>\\s]+)["']/gi,
      ),
      (match) => match[1],
    );

    const srcset: string[] = [];
    for (const match of decoded.matchAll(/srcset=["']([^"']+)["']/gi)) {
      for (const candidate of match[1].split(",")) {
        const imageUrl = candidate.trim().split(/\\s+/, 1)[0];
        if (imageUrl.includes("i.ebayimg.com")) srcset.push(imageUrl);
      }
    }

    return {
      status: response.status,
      htmlLength: html.length,
      images: normalize([...structured, ...attributes, ...srcset]),
    };
  } catch (error) {
    return {
      status: 0,
      htmlLength: 0,
      images: [] as string[],
      error:
        error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

`;

source = source.replace(inventoryMarker, publicReader + inventoryMarker);

const tradingStart = source.indexOf(
  "const trading = product.ebay_item_id ? await getItemSources(accessToken, String(product.ebay_item_id))",
);
const inventoryStart = source.indexOf(
  "const inventoryApi = await getInventoryImages(accessToken, skuCandidates);",
  tradingStart,
);
const verifiedStart = source.indexOf(
  "const verifiedRemote: string[] = [];",
  inventoryStart,
);
if (tradingStart < 0 || inventoryStart < 0 || verifiedStart < 0) {
  throw new Error("Original product image source block was not found.");
}

const sourceLineStart = source.lastIndexOf("\n", tradingStart) + 1;
const indent = source.slice(sourceLineStart, tradingStart);
const safeSources = [
  `${indent}let trading = {`,
  `${indent}  pictureUrls: [] as string[],`,
  `${indent}  descriptionImages: [] as string[],`,
  `${indent}  descriptionLength: 0,`,
  `${indent}  error: null as string | null,`,
  `${indent}};`,
  `${indent}if (product.ebay_item_id) {`,
  `${indent}  try {`,
  `${indent}    const tradingData = await getItemSources(`,
  `${indent}      accessToken,`,
  `${indent}      String(product.ebay_item_id),`,
  `${indent}    );`,
  `${indent}    trading = { ...tradingData, error: null };`,
  `${indent}  } catch (error) {`,
  `${indent}    trading.error =`,
  `${indent}      error instanceof Error`,
  `${indent}        ? error.message.slice(0, 500)`,
  `${indent}        : String(error);`,
  `${indent}  }`,
  `${indent}}`,
  `${indent}`,
  `${indent}let inventoryApi = {`,
  `${indent}  images: [] as string[],`,
  `${indent}  attempts: [] as Array<{ sku: string; status: number }>,`,
  `${indent}  error: null as string | null,`,
  `${indent}};`,
  `${indent}try {`,
  `${indent}  const inventoryData = await getInventoryImages(`,
  `${indent}    accessToken,`,
  `${indent}    skuCandidates,`,
  `${indent}  );`,
  `${indent}  inventoryApi = { ...inventoryData, error: null };`,
  `${indent}} catch (error) {`,
  `${indent}  inventoryApi.error =`,
  `${indent}    error instanceof Error`,
  `${indent}      ? error.message.slice(0, 500)`,
  `${indent}      : String(error);`,
  `${indent}}`,
  `${indent}`,
  `${indent}const publicListing = product.ebay_item_id`,
  `${indent}  ? await getPublicListingImages(String(product.ebay_item_id))`,
  `${indent}  : { status: 0, htmlLength: 0, images: [] as string[] };`,
  `${indent}const trustedRemote = normalize([`,
  `${indent}  ...inventoryApi.images,`,
  `${indent}  ...trading.pictureUrls,`,
  `${indent}  ...trading.descriptionImages,`,
  `${indent}  ...publicListing.images,`,
  `${indent}]);`,
  `${indent}`,
].join("\n");

source =
  source.slice(0, sourceLineStart) +
  safeSources +
  source.slice(verifiedStart);

const receiptMarker = "verifiedRemoteImages: verifiedRemote,";
const receiptIndex = source.indexOf(receiptMarker);
if (receiptIndex < 0) throw new Error("Repair receipt marker was not found.");
const receiptLineStart = source.lastIndexOf("\n", receiptIndex) + 1;
const receiptIndent = source.slice(receiptLineStart, receiptIndex);
const receiptFields = [
  `${receiptIndent}tradingError: trading.error,`,
  `${receiptIndent}inventoryApiError: inventoryApi.error,`,
  `${receiptIndent}publicListingStatus: publicListing.status,`,
  `${receiptIndent}publicListingHtmlLength: publicListing.htmlLength,`,
  `${receiptIndent}publicListingImages: publicListing.images,`,
  `${receiptIndent}publicListingError:`,
  `${receiptIndent}  "error" in publicListing ? publicListing.error : null,`,
].join("\n");

source =
  source.slice(0, receiptLineStart) +
  receiptFields +
  "\n" +
  source.slice(receiptLineStart);

fs.mkdirSync(path.dirname(routePath), { recursive: true });
fs.writeFileSync(routePath, source);
console.log(`Generated quota-tolerant repair route at ${routePath}`);
