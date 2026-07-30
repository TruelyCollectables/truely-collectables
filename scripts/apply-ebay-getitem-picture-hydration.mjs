import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`${label} was not found.`);
  return source.replace(before, after);
}

const syncPath = "src/lib/ebay-all-image-sync.ts";
let sync = fs.readFileSync(syncPath, "utf8");
sync = replaceOnce(
  sync,
  "const APPLY_CONCURRENCY = 8;",
  "const APPLY_CONCURRENCY = 8;\nconst GET_ITEM_CONCURRENCY = 12;",
  "image worker constants",
);
sync = replaceOnce(
  sync,
  "const IMAGE_SYNC_VERSION = 3;",
  "const IMAGE_SYNC_VERSION = 4;",
  "image sync version",
);

const readerStart = sync.indexOf("async function readAllListingImages(");
const readerEnd = sync.indexOf("\nfunction chooseFinalImages", readerStart);
if (readerStart < 0 || readerEnd < 0) {
  throw new Error("The listing-image reader block was not found.");
}

const readerReplacement = `async function readItemImages(params: {
  environment: string;
  accessToken: string;
  itemId: string;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: \`<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ItemID>\${params.itemId}</ItemID>
</GetItemRequest>\`,
    signal: AbortSignal.timeout(30_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        \`eBay GetItem picture hydration failed with \${response.status}.\`,
    );
  }

  const item = xmlBlock(xml, "Item") || "";
  const pictureDetails = xmlBlock(item, "PictureDetails") || "";
  return normalizeListingImageUrls([
    ...xmlBlocks(pictureDetails, "PictureURL").map(decodeXml),
    xmlText(pictureDetails, "GalleryURL"),
  ]);
}

async function readAllListingImages(params: {
  environment: string;
  accessToken: string;
}) {
  const byItemId = new Map<string, string[]>();
  const endRange = activeSellerListEndRange();
  let totalPages = 1;
  let pagesRead = 0;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await readImagePage({ ...params, ...endRange, page });
    totalPages = result.totalPages;
    pagesRead = page;
    for (const listing of result.listings) {
      byItemId.set(listing.itemId, listing.imageUrls);
    }
  }

  const itemIds = Array.from(byItemId.keys());
  const hydrationErrors: Array<{ itemId: string; error: string }> = [];
  let getItemHydrated = 0;
  let getItemMultiPicture = 0;
  let getItemFailed = 0;

  await runWorkers(
    itemIds,
    async (itemId) => {
      const summaryImages = byItemId.get(itemId) || [];
      try {
        const itemImages = await readItemImages({ ...params, itemId });
        const finalImages = normalizeListingImageUrls([
          ...itemImages,
          ...summaryImages,
        ]);
        byItemId.set(itemId, finalImages);
        getItemHydrated += 1;
        if (finalImages.length >= 2) getItemMultiPicture += 1;
      } catch (error) {
        getItemFailed += 1;
        if (summaryImages.length < 2) {
          hydrationErrors.push({
            itemId,
            error: syncErrorMessage(error, "Unknown GetItem picture error"),
          });
        }
      }
    },
    GET_ITEM_CONCURRENCY,
  );

  return {
    byItemId,
    pagesRead,
    cycleComplete: pagesRead >= totalPages,
    sourceCall: "GetSellerList+GetItem" as const,
    getItemChecked: itemIds.length,
    getItemHydrated,
    getItemMultiPicture,
    getItemFailed,
    hydrationErrors,
  };
}
`;

sync = sync.slice(0, readerStart) + readerReplacement + sync.slice(readerEnd);

sync = replaceOnce(
  sync,
  "async function runWorkers<T>(items: T[], worker: (item: T) => Promise<void>) {",
  "async function runWorkers<T>(\n  items: T[],\n  worker: (item: T) => Promise<void>,\n  concurrency = APPLY_CONCURRENCY,\n) {",
  "worker signature",
);
sync = replaceOnce(
  sync,
  "{ length: Math.min(APPLY_CONCURRENCY, Math.max(items.length, 1)) },",
  "{ length: Math.min(concurrency, Math.max(items.length, 1)) },",
  "worker concurrency",
);

sync = replaceOnce(
  sync,
  "      cycleComplete: remote.cycleComplete,\n      maxImagesPerListing: 20,",
  "      cycleComplete: remote.cycleComplete,\n      sourceCall: remote.sourceCall,\n      getItemChecked: remote.getItemChecked,\n      getItemHydrated: remote.getItemHydrated,\n      getItemMultiPicture: remote.getItemMultiPicture,\n      getItemFailed: remote.getItemFailed,\n      maxImagesPerListing: 20,",
  "empty-store hydration metrics",
);

sync = replaceOnce(
  sync,
  "  const productById = new Map(products.map((product) => [Number(product.id), product]));",
  "  const productById = new Map(products.map((product) => [Number(product.id), product]));\n  const productByEbayItemId = new Map(\n    products.map((product) => [String(product.ebay_item_id || \"\"), product]),\n  );",
  "product maps",
);

sync = replaceOnce(
  sync,
  "  const errors: Array<{ legacyProductId: number; error: string }> = [];",
  `  const errors: Array<{ legacyProductId: number; error: string }> =
    remote.hydrationErrors.flatMap((entry) => {
      const product = productByEbayItemId.get(entry.itemId);
      return product
        ? [
            {
              legacyProductId: Number(product.id),
              error: \`GetItem picture hydration failed: \${entry.error}\`,
            },
          ]
        : [];
    });`,
  "hydration error mapping",
);

sync = replaceOnce(
  sync,
  "        ebay_all_image_sync_version: IMAGE_SYNC_VERSION,\n        ebay_all_image_sync_at: checkedAt,",
  "        ebay_all_image_sync_version: IMAGE_SYNC_VERSION,\n        ebay_all_image_sync_at: checkedAt,\n        ebay_image_source_call: remote.sourceCall,",
  "image source metadata",
);

sync = replaceOnce(
  sync,
  "    cycleComplete: remote.cycleComplete,\n    maxImagesPerListing: 20,",
  "    cycleComplete: remote.cycleComplete,\n    sourceCall: remote.sourceCall,\n    getItemChecked: remote.getItemChecked,\n    getItemHydrated: remote.getItemHydrated,\n    getItemMultiPicture: remote.getItemMultiPicture,\n    getItemFailed: remote.getItemFailed,\n    maxImagesPerListing: 20,",
  "final hydration metrics",
);

fs.writeFileSync(syncPath, sync);

const cronPath = "src/app/api/cron/ebay-store-fixed-price-sync/route.ts";
let cron = fs.readFileSync(cronPath, "utf8");
cron = replaceOnce(
  cron,
  "    cycleComplete: sync.cycleComplete,\n    remainingCandidates: sync.remainingCandidates,",
  "    cycleComplete: sync.cycleComplete,\n    sourceCall: sync.sourceCall,\n    getItemChecked: sync.getItemChecked,\n    getItemHydrated: sync.getItemHydrated,\n    getItemMultiPicture: sync.getItemMultiPicture,\n    getItemFailed: sync.getItemFailed,\n    remainingCandidates: sync.remainingCandidates,",
  "cron image hydration metrics",
);
fs.writeFileSync(cronPath, cron);

console.log("Patched eBay image sync to hydrate every active listing with GetItem.");
