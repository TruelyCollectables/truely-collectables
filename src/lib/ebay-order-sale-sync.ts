import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalLegacyProductIdForEbayItemId } from "./ebay-merged-listing-groups";
import { getStoreSettings } from "./store-settings";

const TRADING_API_VERSION = "1409";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DEFAULT_LOOKBACK_DAYS = 2;

export type EbayOrderSaleSyncResult = {
  startedAt: string;
  completedAt: string;
  lookbackDays: number;
  pagesRead: number;
  ordersRead: number;
  transactionsRead: number;
  recorded: number;
  alreadyRecorded: number;
  unmatched: number;
  failed: number;
  errors: Array<{ reference: string; error: string }>;
};

type EbaySaleTransaction = {
  eventKey: string;
  orderId: string;
  orderLineItemId: string;
  itemId: string;
  quantity: number;
  unitPrice: number | null;
  currency: string;
  soldAt: string;
  title: string | null;
};

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

function xmlMoney(xml: string, tag: string) {
  const match = new RegExp(
    `<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  ).exec(xml);
  if (!match) return { value: null, currency: "USD" };

  return {
    value: nullableMoney(decodeXml(match[2].replace(/<[^>]+>/g, ""))),
    currency: /currencyID=["']([^"']+)["']/i.exec(match[1])?.[1] || "USD",
  };
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function nullableMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Unknown error"))
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
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
  if (!data?.refresh_token) throw new Error("No eBay refresh token is available.");

  const response = await fetch(tokenEndpoint(params.environment), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "eBay token refresh failed.",
    );
  }
  return String(payload.access_token);
}

function parseTransactions(xml: string): EbaySaleTransaction[] {
  const transactions: EbaySaleTransaction[] = [];
  const orderArray = xmlBlock(xml, "OrderArray") || "";

  for (const orderXml of xmlBlocks(orderArray, "Order")) {
    const orderId = xmlText(orderXml, "OrderID")?.trim() || "unknown-order";
    const orderCreated =
      xmlText(orderXml, "CreatedTime") || new Date().toISOString();
    const orderPaidAt = xmlText(orderXml, "PaidTime");
    const transactionArray = xmlBlock(orderXml, "TransactionArray") || "";

    for (const transactionXml of xmlBlocks(transactionArray, "Transaction")) {
      const itemXml = xmlBlock(transactionXml, "Item") || "";
      const itemId = xmlText(itemXml, "ItemID")?.trim() || "";
      if (!itemId) continue;

      const orderLineItemId =
        xmlText(transactionXml, "OrderLineItemID")?.trim() ||
        `${itemId}:${xmlText(transactionXml, "TransactionID") || "unknown"}`;
      const transactionPrice = xmlMoney(transactionXml, "TransactionPrice");
      const soldAt =
        orderPaidAt ||
        xmlText(transactionXml, "CreatedDate") ||
        orderCreated;

      transactions.push({
        eventKey: `ebay:order-line:${orderLineItemId}`,
        orderId,
        orderLineItemId,
        itemId,
        quantity: positiveInteger(xmlText(transactionXml, "QuantityPurchased")),
        unitPrice: transactionPrice.value,
        currency: transactionPrice.currency,
        soldAt,
        title: xmlText(itemXml, "Title")?.trim() || null,
      });
    }
  }

  return transactions;
}

async function fetchOrderPage(params: {
  environment: string;
  accessToken: string;
  page: number;
  createTimeFrom: string;
  createTimeTo: string;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetOrders",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <OrderRole>Seller</OrderRole>
  <OrderStatus>Completed</OrderStatus>
  <CreateTimeFrom>${params.createTimeFrom}</CreateTimeFrom>
  <CreateTimeTo>${params.createTimeTo}</CreateTimeTo>
  <Pagination>
    <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
    <PageNumber>${params.page}</PageNumber>
  </Pagination>
</GetOrdersRequest>`,
    signal: AbortSignal.timeout(40_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        `eBay GetOrders failed with ${response.status}.`,
    );
  }

  const pagination = xmlBlock(xml, "PaginationResult") || "";
  return {
    totalPages: Math.max(
      Number(xmlText(pagination, "TotalNumberOfPages") || 1),
      1,
    ),
    orderCount: xmlBlocks(xmlBlock(xml, "OrderArray") || "", "Order").length,
    transactions: parseTransactions(xml),
  };
}

async function findSaleProduct(params: {
  supabase: SupabaseClient;
  storeId: string;
  ebayItemId: string;
}) {
  const canonicalLegacyProductId =
    canonicalLegacyProductIdForEbayItemId(params.ebayItemId);
  const query = params.supabase
    .from("products")
    .select("id,quantity,ebay_item_id")
    .eq("store_id", params.storeId);
  const result = canonicalLegacyProductId
    ? await query.eq("id", canonicalLegacyProductId).maybeSingle()
    : await query.eq("ebay_item_id", params.ebayItemId).maybeSingle();
  if (result.error) throw result.error;

  return {
    product: result.data,
    canonicalLegacyProductId,
  };
}

export async function syncRecentEbayOrderSales(params: {
  supabase: SupabaseClient;
  storeId: string;
  lookbackDays?: number;
}): Promise<EbayOrderSaleSyncResult> {
  const startedAt = new Date().toISOString();
  const settings = await getStoreSettings(params.supabase, params.storeId);
  if (!settings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store.");
  }

  const environment = settings.ebayEnvironment;
  const accessToken = await getAccessToken({
    supabase: params.supabase,
    storeId: params.storeId,
    environment,
  });
  const lookbackDays = Math.min(
    Math.max(Math.floor(params.lookbackDays || DEFAULT_LOOKBACK_DAYS), 1),
    90,
  );
  const createTimeTo = new Date().toISOString();
  const createTimeFrom = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result: EbayOrderSaleSyncResult = {
    startedAt,
    completedAt: startedAt,
    lookbackDays,
    pagesRead: 0,
    ordersRead: 0,
    transactionsRead: 0,
    recorded: 0,
    alreadyRecorded: 0,
    unmatched: 0,
    failed: 0,
    errors: [],
  };

  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const pageResult = await fetchOrderPage({
      environment,
      accessToken,
      page,
      createTimeFrom,
      createTimeTo,
    });
    totalPages = pageResult.totalPages;
    result.pagesRead = page;
    result.ordersRead += pageResult.orderCount;
    result.transactionsRead += pageResult.transactions.length;

    for (const sale of pageResult.transactions) {
      try {
        const { data: existing, error: existingError } = await params.supabase
          .from("collectible_sales")
          .select("id")
          .eq("store_id", params.storeId)
          .eq("event_key", sale.eventKey)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing?.id) {
          result.alreadyRecorded += 1;
          continue;
        }

        const { product, canonicalLegacyProductId } = await findSaleProduct({
          supabase: params.supabase,
          storeId: params.storeId,
          ebayItemId: sale.itemId,
        });
        if (!product?.id) {
          result.unmatched += 1;
          continue;
        }

        const { error: applyError } = await params.supabase.rpc(
          "apply_ebay_order_collectible_sale",
          {
            p_store_id: params.storeId,
            p_legacy_product_id: Number(product.id),
            p_event_key: sale.eventKey,
            p_source_reference: sale.orderLineItemId,
            p_sold_quantity: sale.quantity,
            p_sold_price: sale.unitPrice,
            p_currency: sale.currency,
            p_sold_at: sale.soldAt,
            p_evidence_status:
              sale.unitPrice === null ? "unresolved" : "verified",
            p_evidence: {
              order_id: sale.orderId,
              order_line_item_id: sale.orderLineItemId,
              ebay_item_id: sale.itemId,
              matched_product_ebay_item_id: product.ebay_item_id,
              canonical_legacy_product_id: canonicalLegacyProductId,
              title: sale.title,
              order_status_filter: "Completed",
              evidence_source: "ebay_get_orders",
            },
          },
        );
        if (applyError) throw applyError;
        result.recorded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          reference: sale.orderLineItemId,
          error: cleanError(error),
        });
      }
    }
  }

  result.completedAt = new Date().toISOString();
  return result;
}

export const ebayOrderSaleSyncTestHelpers = {
  parseTransactions,
  xmlText,
  xmlBlocks,
  xmlMoney,
  findSaleProduct,
};
