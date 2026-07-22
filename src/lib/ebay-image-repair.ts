import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoreSettings } from "./store-settings";

const TRADING_API_VERSION = "1409";
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const MAX_IMAGES_PER_LISTING = 12;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function decodeXml(value: string) {
  return value
    .trim()
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlBlock(xml: string, tag: string) {
  return (
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(
      xml,
    )?.[1] || null
  );
}

function xmlBlocks(xml: string, tag: string) {
  return Array.from(
    xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"),
    ),
    (match) => match[1],
  );
}

function xmlText(xml: string, tag: string) {
  const block = xmlBlock(xml, tag);
  return block === null ? null : decodeXml(block);
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function tradingEndpoint(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
}

function tokenEndpoint(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";
}

async function getAccessToken(params: {
  supabase: SupabaseClient;
  storeId: string;
  environment: string;
}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials.");
  }

  const { data, error } = await params.supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) {
    throw new Error("No store eBay refresh token is available.");
  }

  const response = await fetch(tokenEndpoint(params.environment), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(data.refresh_token),
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
      ].join(" "),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "eBay token refresh failed.",
    );
  }
  return String(payload.access_token);
}

async function readImagePage(params: {
  environment: string;
  accessToken: string;
  page: number;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <HideVariations>true</HideVariations>
  <ActiveList>
    <Include>true</Include>
    <ListingType>FixedPriceItem</ListingType>
    <Pagination>
      <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
      <PageNumber>${params.page}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`,
    signal: AbortSignal.timeout(35_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        `eBay image repair failed with ${response.status}.`,
    );
  }

  const activeList = xmlBlock(xml, "ActiveList") || "";
  const itemBlocks = xmlBlocks(xmlBlock(activeList, "ItemArray") || "", "Item");
  const listings = itemBlocks.flatMap((itemXml) => {
    const itemId = xmlText(itemXml, "ItemID")?.trim();
    if (!itemId) return [];
    const pictureDetails = xmlBlock(itemXml, "PictureDetails") || "";
    const imageUrls = Array.from(
      new Set(
        [
          xmlText(pictureDetails, "GalleryURL"),
          ...xmlBlocks(pictureDetails, "PictureURL").map(decodeXml),
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ).slice(0, MAX_IMAGES_PER_LISTING);
    return [{ itemId, imageUrls }];
  });

  return {
    totalPages: Math.max(
      nonNegativeInteger(xmlText(activeList, "TotalNumberOfPages")),
      1,
    ),
    listings,
  };
}

async function readAllListingImages(params: {
  environment: string;
  accessToken: string;
}) {
  const byItemId = new Map<string, string[]>();
  let totalPages = 1;
  let pagesRead = 0;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await readImagePage({ ...params, page });
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
  };
}

export async function repairEbayListingImages(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const checkedAt = new Date().toISOString();
  const { data: inventoryRows, error: inventoryError } = await params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,title,metadata")
    .eq("store_id", params.storeId)
    .not("legacy_product_id", "is", null);
  if (inventoryError) throw inventoryError;

  const pending = (inventoryRows || []).filter((row: any) => {
    const metadata = recordValue(row.metadata);
    const isEbay =
      metadata.source_marketplace === "ebay" ||
      typeof metadata.ebay_listing_id === "string";
    return isEbay && !metadata.ebay_image_repair_checked_at;
  });

  if (!pending.length) {
    return {
      skipped: true,
      reason: "All current eBay inventory rows have already completed image repair.",
      checked: 0,
      updated: 0,
      imagesAdded: 0,
      pagesRead: 0,
      errors: [],
    };
  }

  const legacyIds = pending
    .map((row: any) => Number(row.legacy_product_id || 0))
    .filter((id: number) => id > 0);
  const { data: products, error: productError } = await params.supabase
    .from("products")
    .select("id,ebay_item_id,title")
    .eq("store_id", params.storeId)
    .in("id", legacyIds);
  if (productError) throw productError;

  const productById = new Map(
    (products || []).map((row: any) => [Number(row.id), row] as const),
  );
  const settings = await getStoreSettings(params.supabase, params.storeId);
  const accessToken = await getAccessToken({
    ...params,
    environment: settings.ebayEnvironment,
  });
  const remote = await readAllListingImages({
    environment: settings.ebayEnvironment,
    accessToken,
  });

  let updated = 0;
  let imagesAdded = 0;
  const errors: Array<{ legacyProductId: number; error: string }> = [];

  for (const row of pending as any[]) {
    const legacyProductId = Number(row.legacy_product_id || 0);
    const product = productById.get(legacyProductId);
    const itemId = String(product?.ebay_item_id || "").trim();
    const imageUrls = itemId ? remote.byItemId.get(itemId) || [] : [];
    const metadata = {
      ...recordValue(row.metadata),
      ebay_image_urls: imageUrls,
      ebay_image_repair_checked_at: checkedAt,
      ebay_image_repair_cycle_complete: remote.cycleComplete,
    };

    try {
      const { error: metadataError } = await params.supabase
        .from("inventory_items")
        .update({ metadata, updated_at: checkedAt })
        .eq("id", row.id)
        .eq("store_id", params.storeId);
      if (metadataError) throw metadataError;

      const { data: existingImages, error: imagesError } = await params.supabase
        .from("inventory_images")
        .select("id,image_url")
        .eq("inventory_item_id", row.id);
      if (imagesError) throw imagesError;

      const existingByUrl = new Map(
        (existingImages || []).map((image: any) => [
          String(image.image_url),
          image,
        ]),
      );
      if (imageUrls.length) {
        const { error: clearPrimaryError } = await params.supabase
          .from("inventory_images")
          .update({ is_primary: false })
          .eq("inventory_item_id", row.id);
        if (clearPrimaryError) throw clearPrimaryError;
      }

      for (const [index, imageUrl] of imageUrls.entries()) {
        const existing = existingByUrl.get(imageUrl);
        const imageLabel =
          index === 0 ? "front" : index === 1 ? "back" : `detail ${index + 1}`;
        const altText = `${product?.title || row.title || "Sports card"} ${imageLabel}`;

        if (existing) {
          const { error } = await params.supabase
            .from("inventory_images")
            .update({
              sort_order: index,
              is_primary: index === 0,
              alt_text: altText,
            })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await params.supabase
            .from("inventory_images")
            .insert({
              inventory_item_id: row.id,
              image_url: imageUrl,
              sort_order: index,
              is_primary: index === 0,
              alt_text: altText,
            });
          if (error) throw error;
          imagesAdded += 1;
        }
      }
      updated += 1;
    } catch (error: any) {
      errors.push({
        legacyProductId,
        error: String(error?.message || error).slice(0, 400),
      });
    }
  }

  return {
    skipped: false,
    reason: null,
    checked: pending.length,
    updated,
    imagesAdded,
    pagesRead: remote.pagesRead,
    cycleComplete: remote.cycleComplete,
    errors,
  };
}
