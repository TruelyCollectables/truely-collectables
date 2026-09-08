import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem,
  reviseExistingEbayInventoryItem,
  type EbayExistingRevisionInput,
  type EbayInventoryPublishInput,
} from "../../../src/lib/ebay-inventory-publisher";

type RunnerMode = "readiness" | "publish" | "revise" | "oauth_exchange" | "inventory_snapshot";
type RunnerPayload = {
  mode?: RunnerMode;
  item?: EbayInventoryPublishInput;
  revision?: EbayExistingRevisionInput;
  code?: string;
  redirectUri?: string;
};
type LocalTokenRecord = {
  schema: "tcos.kingmaker.ebay-token.v1";
  refreshToken: string;
  scope: string[];
  refreshTokenExpiresAt: string | null;
  updatedAt: string;
};

const HEADQUARTERS_LOCATION = "dd4bd05a-0aee-4342-830e-dd227c1fca28";
const PAYMENT_POLICY = "252035124017";
const NO_RETURNS_POLICY = "252035125017";
const STANDARD_ENVELOPE_POLICY = "256363993017";
const GROUND_ADVANTAGE_POLICY = "256363912017";
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";
const ACCOUNT_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.account.readonly";
const TOKEN_PATH = String(process.env.KINGMAKER_EBAY_TOKEN_PATH || "").trim() ||
  join(homedir(), "Library/Application Support/TCOS-Current-Review/ebay-seller-token.json");

function apiRoot() {
  return String(process.env.EBAY_ENVIRONMENT || "production").toLowerCase() === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}
function applyVerifiedStoreDefaults(price = 0) {
  process.env.EBAY_MARKETPLACE_ID ||= "EBAY_US";
  process.env.EBAY_MERCHANT_LOCATION_KEY ||= HEADQUARTERS_LOCATION;
  process.env.EBAY_PAYMENT_POLICY_ID ||= PAYMENT_POLICY;
  process.env.EBAY_RETURN_POLICY_ID ||= NO_RETURNS_POLICY;
  process.env.EBAY_FULFILLMENT_POLICY_ID =
    price > 0 && price <= 20 ? STANDARD_ENVELOPE_POLICY : GROUND_ADVANTAGE_POLICY;
}
async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}
function readLocalToken(): LocalTokenRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
  } catch {
    throw new Error("The Mac-local eBay seller token is not configured. Reconnect eBay once from TCOS.");
  }
  const record = parsed as Partial<LocalTokenRecord>;
  const refreshToken = String(record?.refreshToken || "").trim();
  if (!refreshToken) throw new Error("The Mac-local eBay seller token file is invalid. Reconnect eBay once from TCOS.");
  return {
    schema: "tcos.kingmaker.ebay-token.v1",
    refreshToken,
    scope: Array.isArray(record.scope) ? record.scope.map(String).filter(Boolean) : [],
    refreshTokenExpiresAt: record.refreshTokenExpiresAt ? String(record.refreshTokenExpiresAt) : null,
    updatedAt: String(record.updatedAt || ""),
  };
}
function persistLocalToken(data: Record<string, any>) {
  const refreshToken = String(data.refresh_token || "").trim();
  if (!refreshToken) throw new Error("eBay authorization did not return a refresh token.");
  const now = Date.now();
  const expiresSeconds = Number(data.refresh_token_expires_in || 0);
  const record: LocalTokenRecord = {
    schema: "tcos.kingmaker.ebay-token.v1",
    refreshToken,
    scope: String(data.scope || "").split(" ").map((value) => value.trim()).filter(Boolean),
    refreshTokenExpiresAt: expiresSeconds > 0 ? new Date(now + expiresSeconds * 1000).toISOString() : null,
    updatedAt: new Date(now).toISOString(),
  };
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const temp = `${TOKEN_PATH}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, TOKEN_PATH);
  chmodSync(TOKEN_PATH, 0o600);
  return record;
}
function clientCredentials() {
  const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.EBAY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("Mac-local eBay app credentials are unavailable.");
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}
async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(`${apiRoot()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${clientCredentials()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(String(data?.error_description || data?.error || `eBay token HTTP ${response.status}`));
  }
  return data as Record<string, any>;
}
async function refreshAccessToken(refreshToken: string, scopes = [INVENTORY_SCOPE, ACCOUNT_SCOPE]) {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  }));
}
function tradingXmlBlocks(xml: string, tag: string) {
  return Array.from(
    xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi")),
    (match) => match[1],
  );
}
function tradingNumber(value: string, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function tradingAspects(itemXml: string) {
  const aspects: Record<string, string[]> = {};
  const specifics = tradingXmlText(itemXml, "ItemSpecifics");
  if (!specifics) return aspects;
  for (const pair of tradingXmlBlocks(specifics, "NameValueList")) {
    const name = tradingXmlText(pair, "Name").trim();
    const values = tradingXmlBlocks(pair, "Value")
      .map((value) => tradingXmlText(`<Value>${value}</Value>`, "Value").trim())
      .filter(Boolean);
    if (name && values.length) aspects[name] = values;
  }
  return aspects;
}
function firstTradingAspect(aspects: Record<string, string[]>, name: string) {
  return String(aspects[name]?.[0] || "").trim();
}
function parseTradingSnapshotItem(itemXml: string, syncedAt: string) {
  const listingId = tradingXmlText(itemXml, "ItemID").trim();
  if (!listingId) return null;
  const listingType = tradingXmlText(itemXml, "ListingType").trim();
  if (listingType && !["FixedPriceItem", "StoresFixedPrice"].includes(listingType)) return null;
  const sellingStatus = tradingXmlText(itemXml, "SellingStatus");
  const currentPrice = tradingXmlText(sellingStatus, "CurrentPrice") || tradingXmlText(itemXml, "StartPrice");
  const price = Math.max(0, tradingNumber(currentPrice, 0));
  const available = tradingXmlText(itemXml, "QuantityAvailable");
  const quantity = Math.max(
    0,
    Math.floor(
      available
        ? tradingNumber(available, 0)
        : tradingNumber(tradingXmlText(itemXml, "Quantity"), 0) -
            tradingNumber(tradingXmlText(sellingStatus, "QuantitySold"), 0),
    ),
  );
  const picture = tradingXmlText(itemXml, "PictureDetails");
  const imageUrls = Array.from(
    new Set(
      [
        tradingXmlText(picture, "GalleryURL"),
        ...tradingXmlBlocks(picture, "PictureURL").map((value) =>
          tradingXmlText(`<PictureURL>${value}</PictureURL>`, "PictureURL"),
        ),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const aspects = tradingAspects(itemXml);
  const category = tradingXmlText(itemXml, "PrimaryCategory");
  const sku = tradingXmlText(itemXml, "SKU").trim() || `legacy-ebay-${listingId}`;
  return {
    inventoryItemId: `ebay:${listingId}`,
    legacyProductId: null,
    ownershipScope: "store",
    canEdit: true,
    sku,
    offerId: null,
    ebayItemId: listingId,
    title: tradingXmlText(itemXml, "Title").trim() || sku,
    description: tradingXmlText(itemXml, "Description"),
    player: firstTradingAspect(aspects, "Player") || null,
    sport: firstTradingAspect(aspects, "Sport") || null,
    category: tradingXmlText(category, "CategoryID").trim() || "other_collectable",
    condition:
      tradingXmlText(itemXml, "ConditionDisplayName").trim() ||
      firstTradingAspect(aspects, "Condition") ||
      "unknown",
    status: "active",
    quantity,
    price,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    authenticity: {},
    under20SellerProtectionOptIn: false,
    updatedAt: syncedAt,
    createdAt: null,
    syncedAt,
  };
}
async function inventorySnapshot(refreshToken: string) {
  const token = await refreshAccessToken(refreshToken, [BASE_SCOPE, INVENTORY_SCOPE]);
  const accessToken = String(token.access_token || "");
  const syncedAt = new Date().toISOString();
  const listings: any[] = [];
  let totalPages = 1;
  let totalEntries = 0;
  let pagesRead = 0;
  for (let page = 1; page <= Math.min(totalPages, 100); page += 1) {
    const xml = await tradingCall(
      accessToken,
      "GetMyeBaySelling",
      `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <HideVariations>true</HideVariations>
  <ActiveList>
    <Include>true</Include>
    <ListingType>FixedPriceItem</ListingType>
    <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`,
    );
    const activeList = tradingXmlText(xml, "ActiveList");
    totalPages = Math.max(1, Math.floor(tradingNumber(tradingXmlText(activeList, "TotalNumberOfPages"), 1)));
    totalEntries = Math.max(0, Math.floor(tradingNumber(tradingXmlText(activeList, "TotalNumberOfEntries"), 0)));
    pagesRead = page;
    const itemArray = tradingXmlText(activeList, "ItemArray");
    for (const itemXml of tradingXmlBlocks(itemArray, "Item")) {
      const listing = parseTradingSnapshotItem(itemXml, syncedAt);
      if (listing) listings.push(listing);
    }
  }
  return {
    listings,
    inventoryItemCount: listings.length,
    offerCount: listings.length,
    totalEntries,
    pagesRead,
    source: "trading_api_get_my_ebay_selling",
    syncedAt,
  };
}


function escapeTradingXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tradingXmlText(xml: string, tag: string) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  let value = String(match?.[1] || "").trim();
  if (value.startsWith("<![CDATA[") && value.endsWith("]]>") ) {
    value = value.slice(9, -3);
  }
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function tradingCall(accessToken: string, callName: string, requestXml: string) {
  const response = await fetch(`${apiRoot()}/ws/api.dll`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1363",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: requestXml,
    signal: AbortSignal.timeout(30_000),
  });
  const xml = await response.text();
  const ack = tradingXmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const detail = tradingXmlText(xml, "LongMessage") || tradingXmlText(xml, "ShortMessage") || `eBay ${callName} HTTP ${response.status}`;
    throw new Error(detail);
  }
  return xml;
}

async function reviseLegacyTradingListing(refreshToken: string, revision: EbayExistingRevisionInput) {
  const listingId = String(revision.listingId || "").trim();
  const sku = String(revision.sku || "").trim();
  if (!listingId) throw new Error("An exact existing eBay listing ID is required for a legacy revision.");
  const token = await refreshAccessToken(refreshToken, [INVENTORY_SCOPE]);
  const fields = [`<ItemID>${escapeTradingXml(listingId)}</ItemID>`];
  if (revision.title != null) fields.push(`<Title>${escapeTradingXml(String(revision.title).slice(0, 80))}</Title>`);
  if (revision.description != null) fields.push(`<Description>${escapeTradingXml(String(revision.description))}</Description>`);
  if (revision.quantity != null) {
    const quantity = Math.max(0, Math.floor(Number(revision.quantity) || 0));
    if (quantity < 1) throw new Error("eBay quantity must be at least 1 for a live legacy revision.");
    fields.push(`<Quantity>${quantity}</Quantity>`);
  }
  if (revision.price != null) {
    const price = Math.round((Number(revision.price) || 0) * 100) / 100;
    if (price <= 0) throw new Error("eBay price must be greater than 0 for a live legacy revision.");
    fields.push(`<StartPrice>${price.toFixed(2)}</StartPrice>`);
  }
  await tradingCall(
    String(token.access_token || ""),
    "ReviseFixedPriceItem",
    `<?xml version="1.0" encoding="utf-8"?><ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item>${fields.join("")}</Item></ReviseFixedPriceItemRequest>`,
  );
  return { offerId: "legacy-trading", listingId, sku, updated: true as const, warnings: [] as string[] };
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw || "{}") as RunnerPayload;
  const mode = payload.mode || "publish";
  const price = Number(payload.item?.price ?? payload.revision?.price ?? 0);
  applyVerifiedStoreDefaults(price);

  if (mode === "oauth_exchange") {
    const code = String(payload.code || "").trim();
    const redirectUri = String(payload.redirectUri || "").trim();
    if (!code || !redirectUri) throw new Error("eBay OAuth code and redirect URI are required.");
    const data = await tokenRequest(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }));
    const record = persistLocalToken(data);
    process.stdout.write(JSON.stringify({
      ok: true,
      mode,
      tokenStored: true,
      access_token: String(data.access_token || ""),
      expires_in: Number(data.expires_in || 0),
      refresh_token_expires_in: Number(data.refresh_token_expires_in || 0),
      scope: record.scope.join(" "),
      refreshTokenExpiresAt: record.refreshTokenExpiresAt,
    }));
    return;
  }

  const tokenRecord = readLocalToken();
  if (mode === "readiness") {
    const readiness = await getEbayPublishingReadiness({ refreshToken: tokenRecord.refreshToken });
    process.stdout.write(JSON.stringify({ ok: true, mode, readiness }));
    return;
  }
  if (mode === "inventory_snapshot") {
    const snapshot = await inventorySnapshot(tokenRecord.refreshToken);
    process.stdout.write(JSON.stringify({ ok: true, mode, ...snapshot }));
    return;
  }
  if (mode === "revise") {
    if (!payload.revision) throw new Error("KINGMAKER eBay revision payload is missing.");
    const legacySku = String(payload.revision.sku || "").startsWith("legacy-ebay-");
    let result;
    if (legacySku) {
      result = await reviseLegacyTradingListing(tokenRecord.refreshToken, payload.revision);
    } else {
      try {
        result = await reviseExistingEbayInventoryItem({
          refreshToken: tokenRecord.refreshToken,
          revision: payload.revision,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const exactListingId = String(payload.revision.listingId || "").trim();
        const missingInventoryModel = /not found|does not exist|inventory item.*(?:missing|exist)|status 404|http 404|could not find the existing published ebay offer/i.test(message);
        if (!exactListingId || !missingInventoryModel) throw error;
        result = await reviseLegacyTradingListing(tokenRecord.refreshToken, payload.revision);
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, mode, ...result }));
    return;
  }
  if (!payload.item) throw new Error("KINGMAKER eBay publish payload is missing the listing item.");
  const result = await publishEbayInventoryItem({
    refreshToken: tokenRecord.refreshToken,
    item: payload.item,
  });
  process.stdout.write(JSON.stringify({ ok: true, mode, ...result }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
