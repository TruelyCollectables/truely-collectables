import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { inferAuthenticityProfileFromEbayListing } from "./authenticity";
import { classifyCollectibleCategory } from "./collectible-category-policy";
import { getStoreSettings } from "./store-settings";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const TRADING_API_VERSION = "1409";

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

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAspects(itemXml: string) {
  const aspects: Record<string, string[]> = {};
  const itemSpecifics = xmlBlock(itemXml, "ItemSpecifics");
  if (!itemSpecifics) return aspects;

  for (const pair of xmlBlocks(itemSpecifics, "NameValueList")) {
    const name = xmlText(pair, "Name")?.trim();
    const values = xmlBlocks(pair, "Value")
      .map(decodeXml)
      .map((value) => value.trim())
      .filter(Boolean);
    if (name && values.length) aspects[name] = values;
  }
  return aspects;
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

async function getStoreTradingToken(params: {
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
    throw new Error(
      "Store eBay authorization is missing. Reconnect eBay before full legacy intake.",
    );
  }

  const response = await fetch(tokenEndpoint(params.environment), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
      ].join(" "),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        "eBay token refresh failed.",
    );
  }
  return String(payload.access_token);
}

type LegacyCandidate = {
  itemId: string;
  sku: string;
  title: string;
  quantity: number;
  price: number;
  imageUrl: string;
  imageUrls: string[];
  condition: string | null;
  categoryName: string | null;
  categoryHint: "autographs" | "memorabilia";
  categoryConfidence: "high" | "medium" | "low";
  categoryReasons: string[];
  aspects: Record<string, string[]>;
};

function candidateFromItem(itemXml: string): LegacyCandidate | null {
  const itemId = xmlText(itemXml, "ItemID")?.trim() || "";
  const listingType = xmlText(itemXml, "ListingType")?.trim() || "";
  if (
    !itemId ||
    !["FixedPriceItem", "StoresFixedPrice"].includes(listingType)
  ) {
    return null;
  }

  const title = xmlText(itemXml, "Title")?.trim() || "Untitled";
  const sellingStatus = xmlBlock(itemXml, "SellingStatus") || "";
  const price = numberValue(
    xmlText(sellingStatus, "CurrentPrice") || xmlText(itemXml, "StartPrice"),
  );
  const available = xmlText(itemXml, "QuantityAvailable");
  const quantity =
    available === null
      ? Math.max(
          numberValue(xmlText(itemXml, "Quantity")) -
            numberValue(xmlText(sellingStatus, "QuantitySold")),
          0,
        )
      : numberValue(available);
  if (price <= 0 || quantity <= 0) return null;

  const primaryCategory = xmlBlock(itemXml, "PrimaryCategory") || "";
  const categoryName = xmlText(primaryCategory, "CategoryName")?.trim() || null;
  const aspects = parseAspects(itemXml);
  const text = normalized(
    `${title} ${categoryName || ""} ${JSON.stringify(aspects)}`,
  );
  const blocked =
    /\b(pants|jeans|trousers|shorts|shoes|sneakers|boots|watch|watches|air intake|fuel sensor|oxygen sensor|throttle body|automotive|auto part|car part|engine part|brake part|suspension part)\b/.test(
      text,
    );
  if (blocked) return null;

  const categoryDecision = classifyCollectibleCategory({
    title,
    category: categoryName,
    aspects,
  });

  // Trading cards are handled by the card importer. Autograph, patch, relic,
  // jersey-swatch, game-used, and memorabilia words describe card features and
  // must never move a card into the physical-memorabilia review lane.
  if (categoryDecision.isTradingCard) return null;

  const autographSignal =
    /\b(signed|autograph|autographed|inscribed|coa|psa dna|beckett|jsa)\b/.test(
      text,
    );
  if (!categoryDecision.isPhysicalMemorabilia && !autographSignal) return null;

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
  );
  if (!imageUrls[0]) return null;

  return {
    itemId,
    sku: xmlText(itemXml, "SKU")?.trim() || `legacy-ebay-${itemId}`,
    title,
    quantity: Math.floor(quantity),
    price,
    imageUrl: imageUrls[0],
    imageUrls,
    condition:
      xmlText(itemXml, "ConditionDisplayName") ||
      aspects.Condition?.[0] ||
      null,
    categoryName,
    categoryHint:
      categoryDecision.category === "autographs" ? "autographs" : "memorabilia",
    categoryConfidence: categoryDecision.confidence,
    categoryReasons: categoryDecision.reasons,
    aspects,
  };
}

async function getTradingPage(params: {
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
        `eBay GetMyeBaySelling failed with ${response.status}.`,
    );
  }

  const activeList = xmlBlock(xml, "ActiveList") || "";
  const itemBlocks = xmlBlocks(
    xmlBlock(activeList, "ItemArray") || "",
    "Item",
  );
  return {
    totalPages: Math.max(
      numberValue(xmlText(activeList, "TotalNumberOfPages")),
      1,
    ),
    totalEntries: numberValue(xmlText(activeList, "TotalNumberOfEntries")),
    candidates: itemBlocks
      .map(candidateFromItem)
      .filter((value): value is LegacyCandidate => Boolean(value)),
  };
}

export async function stageLegacySellerAutographIntake(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  connectionId: string;
}) {
  const settings = await getStoreSettings(params.supabase, params.storeId);
  const accessToken = await getStoreTradingToken({
    supabase: params.supabase,
    storeId: params.storeId,
    environment: settings.ebayEnvironment,
  });

  const candidates = new Map<string, LegacyCandidate>();
  let totalPages = 1;
  let totalEntries = 0;
  let pagesRead = 0;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await getTradingPage({
      environment: settings.ebayEnvironment,
      accessToken,
      page,
    });
    totalPages = result.totalPages;
    totalEntries = result.totalEntries;
    pagesRead = page;
    result.candidates.forEach((candidate) =>
      candidates.set(candidate.itemId, candidate),
    );
  }

  const candidateRows = Array.from(candidates.values());
  if (!candidateRows.length) {
    return { totalEntries, pagesRead, candidateCount: 0, stagedCount: 0 };
  }

  const sourceIds = candidateRows.map((candidate) => candidate.itemId);
  const { data: existing, error: existingError } = await params.supabase
    .from("seller_marketplace_staged_items")
    .select("source_item_id,stage_status")
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .in("source_item_id", sourceIds);
  if (existingError) throw existingError;
  const mapped = new Set(
    (existing || [])
      .filter((row) => row.stage_status === "mapped")
      .map((row) => String(row.source_item_id)),
  );

  const now = new Date().toISOString();
  const rows = candidateRows
    .filter((candidate) => !mapped.has(candidate.itemId))
    .map((candidate) => ({
      account_id: params.accountId,
      store_id: params.storeId,
      connection_id: params.connectionId,
      import_job_id: null,
      provider: "ebay",
      source_item_id: candidate.itemId,
      sku: candidate.sku,
      title: candidate.title,
      quantity: candidate.quantity,
      price: candidate.price,
      currency: "USD",
      offer_status: "PUBLISHED",
      listing_status: "ACTIVE",
      item_condition: candidate.condition,
      image_url: candidate.imageUrl,
      stage_status: "needs_review",
      metadata: {
        source_marketplace: "ebay",
        source_listing_id: candidate.itemId,
        source_sku: candidate.sku,
        category_hint: candidate.categoryHint,
        category_confidence: candidate.categoryConfidence,
        category_policy: {
          schema: "truely.collectibleCategoryPolicy.v1",
          category: candidate.categoryHint,
          is_trading_card: false,
          is_physical_memorabilia: candidate.categoryHint === "memorabilia",
          reasons: candidate.categoryReasons,
          evaluated_at: now,
        },
        review_required: true,
        authenticity: inferAuthenticityProfileFromEbayListing({
          title: candidate.title,
          category: candidate.categoryHint,
          aspects: candidate.aspects,
        }),
        source_aspects: candidate.aspects,
        ebay_image_urls: candidate.imageUrls,
        intake_lane: "autograph_review",
        intake_reason:
          "legacy Trading API physical autograph or memorabilia requires seller approval",
        trading_api_legacy_intake: true,
        trading_api_category_name: candidate.categoryName,
        staged_at: now,
      },
      updated_at: now,
    }));

  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const { error } = await params.supabase
      .from("seller_marketplace_staged_items")
      .upsert(batch, {
        onConflict: "store_id,account_id,provider,source_item_id",
      });
    if (error) throw error;
  }

  return {
    totalEntries,
    pagesRead,
    candidateCount: candidateRows.length,
    stagedCount: rows.length,
  };
}
