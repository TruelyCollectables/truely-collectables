import { selectFrontBackListingImages } from "../../lib/listing-image-utils";
import { configuredSiteOrigin } from "../../lib/site-origin";
import { createServerInventoryEngine } from "../../lib/server-inventory-engine";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 300;

const GOOGLE_COLLECTIBLE_TRADING_CARD_CATEGORY = "6997";
const INVENTORY_IMAGE_QUERY_BATCH_SIZE = 250;
const TRADING_CARD_CATEGORIES = new Set([
  "sports_cards",
  "trading_cards",
  "sealed_wax",
]);

type InventoryImageRow = {
  inventory_item_id: string;
  image_url: string | null;
};

function xmlText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function absoluteUrl(origin: string, value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

function highestResolutionEbayImageUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (/(^|\.)ebayimg\.com$/i.test(url.hostname)) {
      url.pathname = url.pathname.replace(/\$_1\.JPG$/i, "$_57.JPG");
    }
    return url.toString();
  } catch {
    return value;
  }
}

async function loadInventoryImageUrls(inventoryItemIds: Array<string | null>) {
  const uniqueIds = Array.from(
    new Set(inventoryItemIds.filter((id): id is string => Boolean(id))),
  );
  const imageUrlsByInventoryItemId = new Map<string, string[]>();
  if (!uniqueIds.length) return imageUrlsByInventoryItemId;

  try {
    const supabase = createSupabaseServerClient({ admin: true });

    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += INVENTORY_IMAGE_QUERY_BATCH_SIZE
    ) {
      const batch = uniqueIds.slice(
        offset,
        offset + INVENTORY_IMAGE_QUERY_BATCH_SIZE,
      );
      const { data, error } = await supabase
        .from("inventory_images")
        .select("inventory_item_id,image_url")
        .in("inventory_item_id", batch)
        .order("inventory_item_id", { ascending: true })
        .order("sort_order", { ascending: true });

      if (error) throw error;

      for (const row of (data || []) as InventoryImageRow[]) {
        const imageUrl = String(row.image_url || "").trim();
        if (!imageUrl) continue;

        const current = imageUrlsByInventoryItemId.get(row.inventory_item_id) || [];
        current.push(imageUrl);
        imageUrlsByInventoryItemId.set(row.inventory_item_id, current);
      }
    }
  } catch (error) {
    console.error("Could not load additional Google Merchant feed images", error);
  }

  return imageUrlsByInventoryItemId;
}

function isCollectibleTradingCard(product: {
  title: string;
  category: string | null;
  storefrontSection: string;
  sport: string | null;
}) {
  const category = String(product.category || "")
    .trim()
    .toLowerCase();
  if (TRADING_CARD_CATEGORIES.has(category)) return true;

  const searchable = [product.title, product.storefrontSection, product.sport]
    .filter(Boolean)
    .join(" ");

  return /\b(?:sports?|trading|baseball|basketball|football|hockey|soccer|wrestling|pokemon|pokémon) cards?\b|\bTCG\b/i.test(
    searchable,
  );
}

function feedDescription(product: {
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number;
}) {
  const supplied = product.description?.trim();
  if (supplied) return supplied.slice(0, 5000);

  return [
    product.title,
    product.player ? `Player or subject: ${product.player}.` : "",
    product.sport ? `Category: ${product.sport}.` : "",
    `In-stock collectible available from Truely Collectables for $${Number(product.price).toFixed(2)}.`,
    "Review the listing photos and product details before purchasing.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 5000);
}

export async function GET() {
  const origin = configuredSiteOrigin();

  try {
    const inventoryEngine = createServerInventoryEngine();
    const products = await inventoryEngine.listAvailable();
    const inventoryImageUrls = await loadInventoryImageUrls(
      products.map((product) => product.inventoryItemId),
    );
    const items = products
      .filter(
        (product) =>
          product.status === "active" &&
          product.quantity > 0 &&
          Number.isFinite(Number(product.price)) &&
          Number(product.price) > 0 &&
          Boolean(product.imageUrl),
      )
      .map((product) => {
        const productUrl = `${origin}/product/${product.legacyProductId}`;
        const listingImages = selectFrontBackListingImages([
          product.imageUrl,
          ...(product.inventoryItemId
            ? inventoryImageUrls.get(product.inventoryItemId) || []
            : []),
        ])
          .map((imageUrl) =>
            highestResolutionEbayImageUrl(absoluteUrl(origin, imageUrl)),
          )
          .filter((imageUrl): imageUrl is string => Boolean(imageUrl));
        const [imageUrl, additionalImageUrl] = listingImages;
        if (!imageUrl) return null;

        const productType =
          product.storefrontSection || product.sport || product.category || "Collectibles";

        return [
          "    <item>",
          `      <g:id>${xmlText(`tc-${product.legacyProductId}`)}</g:id>`,
          `      <g:title>${xmlText(product.title.slice(0, 150))}</g:title>`,
          `      <g:description>${xmlText(feedDescription(product))}</g:description>`,
          `      <g:link>${xmlText(productUrl)}</g:link>`,
          `      <g:image_link>${xmlText(imageUrl)}</g:image_link>`,
          ...(additionalImageUrl
            ? [
                `      <g:additional_image_link>${xmlText(additionalImageUrl)}</g:additional_image_link>`,
              ]
            : []),
          "      <g:condition>used</g:condition>",
          "      <g:availability>in stock</g:availability>",
          `      <g:price>${xmlText(`${Number(product.price).toFixed(2)} USD`)}</g:price>`,
          "      <g:identifier_exists>no</g:identifier_exists>",
          ...(isCollectibleTradingCard(product)
            ? [
                `      <g:google_product_category>${GOOGLE_COLLECTIBLE_TRADING_CARD_CATEGORY}</g:google_product_category>`,
              ]
            : []),
          `      <g:product_type>${xmlText(productType)}</g:product_type>`,
          "    </item>",
        ].join("\n");
      })
      .filter((item): item is string => Boolean(item));

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
      "  <channel>",
      "    <title>Truely Collectables Live Inventory</title>",
      `    <link>${xmlText(origin)}</link>`,
      "    <description>Currently available cards and collectibles from Truely Collectables.</description>",
      `    <lastBuildDate>${xmlText(new Date().toUTCString())}</lastBuildDate>`,
      ...items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Could not build Google Merchant inventory feed", error);

    return new Response("Google Merchant inventory feed is temporarily unavailable.\n", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
