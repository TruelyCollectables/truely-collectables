import fs from "node:fs";

const path = "src/lib/ebay-all-image-sync.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`${label} was not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce("const PAGE_SIZE = 200;", "const PAGE_SIZE = 100;", "eBay image page size");
replaceOnce(
  "const MAX_ITEMS_PER_RUN = 250;",
  "const MAX_ITEMS_PER_RUN = 1500;",
  "eBay image apply limit",
);
replaceOnce(
  "const IMAGE_SYNC_VERSION = 2;",
  "const IMAGE_SYNC_VERSION = 3;",
  "eBay image sync version",
);

const start = source.indexOf("async function readImagePage(");
const end = source.indexOf("\nfunction chooseFinalImages", start);
if (start < 0 || end < 0) {
  throw new Error("The current eBay listing-image reader block was not found.");
}

const replacement = `function activeSellerListEndRange() {
  const now = Date.now();
  return {
    endTimeFrom: new Date(now - 5 * 60 * 1000).toISOString(),
    endTimeTo: new Date(now + 119 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function readImagePage(params: {
  environment: string;
  accessToken: string;
  page: number;
  endTimeFrom: string;
  endTimeTo: string;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetSellerList",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: \`<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <EndTimeFrom>\${params.endTimeFrom}</EndTimeFrom>
  <EndTimeTo>\${params.endTimeTo}</EndTimeTo>
  <IncludeVariations>false</IncludeVariations>
  <Pagination>
    <EntriesPerPage>\${PAGE_SIZE}</EntriesPerPage>
    <PageNumber>\${params.page}</PageNumber>
  </Pagination>
</GetSellerListRequest>\`,
    signal: AbortSignal.timeout(60_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        \`eBay GetSellerList image sync failed with \${response.status}.\`,
    );
  }

  const itemArray = xmlBlock(xml, "ItemArray") || "";
  const items = xmlBlocks(itemArray, "Item");
  const listings = items.flatMap((itemXml) => {
    const itemId = xmlText(itemXml, "ItemID")?.trim();
    if (!itemId) return [];
    const pictureDetails = xmlBlock(itemXml, "PictureDetails") || "";
    const imageUrls = normalizeListingImageUrls([
      ...xmlBlocks(pictureDetails, "PictureURL").map(decodeXml),
      xmlText(pictureDetails, "GalleryURL"),
    ]);
    return [{ itemId, imageUrls }];
  });
  const pagination = xmlBlock(xml, "PaginationResult") || "";
  const totalPages = Math.max(
    nonNegativeInteger(xmlText(pagination, "TotalNumberOfPages")),
    1,
  );
  const hasMoreItems = xmlText(xml, "HasMoreItems") === "true";

  return {
    totalPages: hasMoreItems ? Math.max(totalPages, params.page + 1) : totalPages,
    listings,
  };
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
  return {
    byItemId,
    pagesRead,
    cycleComplete: pagesRead >= totalPages,
    sourceCall: "GetSellerList" as const,
  };
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(path, source);
console.log("Patched eBay image import to retrieve every PictureURL with GetSellerList.");
