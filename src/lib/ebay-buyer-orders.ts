import "server-only";

import { getActiveStoreId } from "./stores";
import { getStoreSettings } from "./store-settings";
import { createSupabaseServerClient } from "./supabase-server";

const EBAY_BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const TRADING_API_VERSION = "1209";

export type EbayBuyerOrderLine = {
  orderLineItemId: string | null;
  transactionId: string | null;
  itemId: string;
  title: string;
  quantity: number;
  itemSubtotal: number;
  inboundShipping: number;
  salesTax: number;
  buyerFees: number;
  otherCost: number;
  totalPaid: number;
};

export type EbayBuyerOrder = {
  orderId: string;
  purchaseDate: string;
  currency: string;
  orderStatus: string | null;
  paymentStatus: string | null;
  totalPaid: number;
  lines: EbayBuyerOrderLine[];
};

export class EbayBuyerOrderError extends Error {
  code: "INVALID_ORDER_REFERENCE" | "RECONNECT_REQUIRED" | "ORDER_NOT_FOUND" | "EBAY_ERROR";

  constructor(code: EbayBuyerOrderError["code"], message: string) {
    super(message);
    this.name = "EbayBuyerOrderError";
    this.code = code;
  }
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function moneyValue(value: string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function positiveWholeNumber(value: string | null | undefined, fallback = 1) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : fallback;
}

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapedTagName(tag: string) {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlValue(source: string, tag: string) {
  const escapedTag = escapedTagName(tag);
  const match = source.match(
    new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : null;
}

function xmlBlocks(source: string, tag: string) {
  const escapedTag = escapedTagName(tag);
  return Array.from(
    source.matchAll(
      new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "gi"),
    ),
    (match) => match[1],
  );
}

function xmlCurrency(source: string, tag: string) {
  const escapedTag = escapedTagName(tag);
  const match = source.match(
    new RegExp(`<${escapedTag}[^>]*currencyID=["']([^"']+)["'][^>]*>`, "i"),
  );
  return match?.[1]?.trim() || null;
}

function validOrderId(value: string) {
  return /^\d{2}-\d{5}-\d{5}$/.test(value);
}

export function parseEbayOrderId(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (validOrderId(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host !== "ebay.com" && !host.endsWith(".ebay.com")) return null;
    const orderId = url.searchParams.get("orderId")?.trim() || "";
    return validOrderId(orderId) ? orderId : null;
  } catch {
    return null;
  }
}

function allocateMoney(total: number, weights: number[]) {
  const totalCents = Math.max(0, Math.round(roundMoney(total) * 100));
  if (weights.length === 0) return [];

  const normalized = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const sum = normalized.reduce((current, value) => current + value, 0);
  const effective = sum > 0 ? normalized : normalized.map(() => 1);
  const effectiveSum = effective.reduce((current, value) => current + value, 0);
  let remaining = totalCents;

  return effective.map((weight, index) => {
    const cents =
      index === effective.length - 1
        ? remaining
        : Math.min(remaining, Math.floor((totalCents * weight) / effectiveSum));
    remaining -= cents;
    return cents / 100;
  });
}

async function getBuyerAccessToken() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);
  const ebayApi =
    storeSettings.ebayEnvironment === "sandbox"
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

  const { data: tokenRow, error: tokenError } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenError || !tokenRow?.refresh_token) {
    throw new EbayBuyerOrderError(
      "RECONNECT_REQUIRED",
      "Connect or reconnect the eBay account before importing a private eBay order link.",
    );
  }

  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayBuyerOrderError("EBAY_ERROR", "Missing eBay client credentials.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${ebayApi}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(tokenRow.refresh_token),
      scope: EBAY_BASE_SCOPE,
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
    const reconnectRequired =
      response.status === 400 ||
      /invalid[_\s-]?(?:grant|scope)|insufficient|authorization/i.test(detail);
    throw new EbayBuyerOrderError(
      reconnectRequired ? "RECONNECT_REQUIRED" : "EBAY_ERROR",
      reconnectRequired
        ? "Reconnect eBay with buyer-order access, then submit the order link again."
        : `eBay buyer authorization failed: ${detail}`,
    );
  }

  return { accessToken: payload.access_token, ebayApi };
}

function parseBuyerOrderXml(xml: string, requestedOrderId: string): EbayBuyerOrder {
  const ack = xmlValue(xml, "Ack");
  if (ack !== "Success" && ack !== "Warning") {
    const message =
      xmlValue(xml, "LongMessage") ||
      xmlValue(xml, "ShortMessage") ||
      "eBay did not return the requested buyer order.";
    throw new EbayBuyerOrderError("EBAY_ERROR", message);
  }

  const orderBlocks = xmlBlocks(xml, "Order");
  const orderBlock =
    orderBlocks.find((block) => xmlValue(block, "OrderID") === requestedOrderId) ||
    orderBlocks[0];

  if (!orderBlock) {
    throw new EbayBuyerOrderError(
      "ORDER_NOT_FOUND",
      "That order was not returned for the connected eBay account. Reconnect the eBay ID that made the purchase or verify the order number.",
    );
  }

  const orderSummary = orderBlock.split(/<TransactionArray(?:\s[^>]*)?>/i)[0] || orderBlock;
  const transactionBlocks = xmlBlocks(orderBlock, "Transaction");
  const rawLines = transactionBlocks
    .map((transaction) => {
      const item = xmlBlocks(transaction, "Item")[0] || transaction;
      const itemId = xmlValue(item, "ItemID") || "";
      const title = xmlValue(item, "Title") || `eBay item ${itemId || "purchase"}`;
      const quantity = positiveWholeNumber(xmlValue(transaction, "QuantityPurchased"));
      const unitPrice = moneyValue(xmlValue(transaction, "TransactionPrice"));
      return {
        orderLineItemId: xmlValue(transaction, "OrderLineItemID"),
        transactionId: xmlValue(transaction, "TransactionID"),
        itemId,
        title,
        quantity,
        rawSubtotal: roundMoney(unitPrice * quantity),
      };
    })
    .filter((line) => Boolean(line.itemId));

  if (rawLines.length === 0) {
    throw new EbayBuyerOrderError(
      "ORDER_NOT_FOUND",
      "eBay returned the order but did not expose any importable line items.",
    );
  }

  const rawSubtotal = roundMoney(
    rawLines.reduce((total, line) => total + line.rawSubtotal, 0),
  );
  const shippingBlock = xmlBlocks(orderSummary, "ShippingServiceSelected")[0] || orderSummary;
  const inboundShipping = moneyValue(xmlValue(shippingBlock, "ShippingServiceCost"));
  const explicitTax = moneyValue(xmlValue(orderSummary, "TotalTaxAmount"));
  const amountPaid = moneyValue(xmlValue(orderSummary, "AmountPaid"));
  const orderTotal = amountPaid || moneyValue(xmlValue(orderSummary, "Total"));
  const orderSubtotalField = moneyValue(xmlValue(orderSummary, "Subtotal"));
  const derivedTax = Math.max(
    0,
    roundMoney(orderTotal - (orderSubtotalField || rawSubtotal) - inboundShipping),
  );
  const salesTax = explicitTax || derivedTax;
  const itemSubtotal =
    orderSubtotalField || Math.max(0, roundMoney(orderTotal - inboundShipping - salesTax));
  const otherCost = Math.max(
    0,
    roundMoney(orderTotal - itemSubtotal - inboundShipping - salesTax),
  );
  const weights = rawLines.map((line) => line.rawSubtotal);
  const itemAllocations = allocateMoney(itemSubtotal, weights);
  const shippingAllocations = allocateMoney(inboundShipping, weights);
  const taxAllocations = allocateMoney(salesTax, weights);
  const otherAllocations = allocateMoney(otherCost, weights);

  const lines = rawLines.map((line, index): EbayBuyerOrderLine => {
    const lineItemSubtotal = itemAllocations[index] || 0;
    const lineShipping = shippingAllocations[index] || 0;
    const lineTax = taxAllocations[index] || 0;
    const lineOther = otherAllocations[index] || 0;
    return {
      orderLineItemId: line.orderLineItemId,
      transactionId: line.transactionId,
      itemId: line.itemId,
      title: line.title,
      quantity: line.quantity,
      itemSubtotal: lineItemSubtotal,
      inboundShipping: lineShipping,
      salesTax: lineTax,
      buyerFees: 0,
      otherCost: lineOther,
      totalPaid: roundMoney(lineItemSubtotal + lineShipping + lineTax + lineOther),
    };
  });

  const purchaseDate =
    xmlValue(orderSummary, "PaidTime") ||
    xmlValue(orderSummary, "CreatedTime") ||
    new Date().toISOString();
  const totalTag = amountPaid ? "AmountPaid" : "Total";

  return {
    orderId: xmlValue(orderSummary, "OrderID") || requestedOrderId,
    purchaseDate,
    currency:
      xmlCurrency(orderSummary, totalTag) ||
      xmlCurrency(orderSummary, "Subtotal") ||
      "USD",
    orderStatus: xmlValue(orderSummary, "OrderStatus"),
    paymentStatus: xmlValue(orderSummary, "Status"),
    totalPaid: roundMoney(lines.reduce((total, line) => total + line.totalPaid, 0)),
    lines,
  };
}

export async function fetchEbayBuyerOrder(reference: string) {
  const orderId = parseEbayOrderId(reference);
  if (!orderId) {
    throw new EbayBuyerOrderError(
      "INVALID_ORDER_REFERENCE",
      "Enter an eBay order-details link or an order number like 14-14906-11959.",
    );
  }

  const { accessToken, ebayApi } = await getBuyerAccessToken();
  const response = await fetch(`${ebayApi}/ws/api.dll`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-EBAY-API-CALL-NAME": "GetOrders",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_VERSION}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <OrderIDArray>
    <OrderID>${escapeXml(orderId)}</OrderID>
  </OrderIDArray>
  <OrderRole>Buyer</OrderRole>
</GetOrdersRequest>`,
    cache: "no-store",
  });
  const xml = await response.text();

  if (!response.ok) {
    throw new EbayBuyerOrderError(
      response.status === 401 || response.status === 403
        ? "RECONNECT_REQUIRED"
        : "EBAY_ERROR",
      response.status === 401 || response.status === 403
        ? "Reconnect eBay with buyer-order access, then submit the order link again."
        : `eBay buyer-order lookup failed (${response.status}).`,
    );
  }

  return parseBuyerOrderXml(xml, orderId);
}
