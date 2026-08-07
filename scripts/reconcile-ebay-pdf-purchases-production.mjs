import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_ORDERS = new Map([
  ["0801f6d8f7d5c6d75f480895169ad81d632d93f18b38c27df4cc380323090821", 23.37],
  ["5a5991524fa9acfd8dbb462cfaa9c8a1e0a057bd1977e7dd784060d323895bdb", 17.14],
  ["5ea3dc93db0c1b5b1a6178b1975c4de1bc0a1dd207a5ea7834f52e7188f4b1c9", 19.48],
  ["08973dda32e6ce2be4b8ebb7936f87092f86a17ab9fcb970c04c385c0b6932ab", 44.05],
  ["50dd91cb3343e85e0054443bd824f3eebd221475152f75b7d2e4c0d37a94a155", 4.77],
  ["e9cbb7d47e9788d139901c151ceb7ba828f8a42b857825304b82e5f71a38705a", 11.26],
  ["a040a23340a41ebdef6191fc640dec1d40569832f078b4a987dcade38a73ba8e", 23.95],
  ["759794aaf7e3e0071ce3a1fc270f3758714103558796f0f062971069834d5f9c", 5.46],
  ["b138931b1a42b8f943f4a1796fd81fdbe5d03b90242f37409a945ff47e635888", 14.74],
  ["968a2b0db00d023c7d7c70f9ddfc73f9141f1faec14faa6e16001a7efe403706", 23.37],
  ["87d248edf449251b855bf20ed9f140397b81edc37ec6b4a55b88b7fb5c90782c", 20.13],
  ["01806de13bb3b1334c73152afde1cffc7fa85000d06da6ac682b468f8bcd5e1f", 2.53],
  ["82e9bfa02f28ebe12ea29d79e41a82dba7605ce707fded0511b1b6223631b818", 99.51],
  ["accf4909164619d8f8a9e8741c247b98cbf3150b7ad9aadc2c77498035ba4d78", 3.13],
  ["42905016278441b82ae38caeb568d254221e6ac054e7d29ea0a53a264ac5f91d", 8.26],
  ["44d641deb737ffe158b4e57b55eb5604db1c0135c253f7f8adcd100952c08691", 3.40],
  ["59beb36cb3b94fb6674310d10761ab2411e70c35cc574f5c0428c5e4264c4dd2", 4.08],
  ["38acc32838f76f84706094296e51eec59fcf2d40f7e5fb4c91c270d0e22d7be5", 34.87],
  ["6da3952584541d60f62be91cf5e3347cacaea8de23a316582a14d4934299c0bf", 12.86],
  ["7cca87655edb6c06add807f09e0a6c5349133af97c890e97ae3c137d175fc13d", 33.57],
  ["293065c9c01f1a22b7c59234f9a75ac3f88b372ecda458eacf5ab255f906aff9", 32.38],
  ["b36036a4b340d1393282bba568e75886ff8af085fe8ff7e7b59db7566c1130d9", 20.56],
  ["19ad41fce4ef315dcd02e6a1ba202015a1382790f1a12386b88e8d888aa228fc", 61.83],
  ["b13eedb8abea93f56a3c49a72d472d9ccec8159c127fb40db9ef8792a98bc263", 0.31],
  ["53f65eb404ebf78f26cff6a213fdb2166b2c6b072f91582928d9be3966b6862c", 3.51],
]);

const EXPECTED_PDF_TOTAL = 528.52;
const TRADING_API_VERSION = "1209";
const EBAY_BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const RESULT_FILE = "ebay-purchase-reconcile-result.json";

function sha(value) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function loadEnvText(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n");
    if (!process.env[key]) process.env[key] = value;
  }
}

function escapedTagName(tag) {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlValue(source, tag) {
  const escapedTag = escapedTagName(tag);
  const match = String(source || "").match(
    new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : null;
}

function xmlBlocks(source, tag) {
  const escapedTag = escapedTagName(tag);
  return Array.from(
    String(source || "").matchAll(
      new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "gi"),
    ),
    (match) => match[1],
  );
}

function xmlCurrency(source, tag) {
  const escapedTag = escapedTagName(tag);
  const match = String(source || "").match(
    new RegExp(`<${escapedTag}[^>]*currencyID=["']([^"']+)["'][^>]*>`, "i"),
  );
  return match?.[1]?.trim() || null;
}

function allocateMoney(total, weights) {
  const totalCents = Math.max(0, Math.round(roundMoney(total) * 100));
  if (!weights.length) return [];
  const normalized = weights.map((weight) =>
    Number.isFinite(Number(weight)) && Number(weight) > 0 ? Number(weight) : 0,
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

function quantityFromTitle(title, ebayQuantity) {
  const text = String(title || "");
  const lower = text.toLowerCase();
  const patterns = [
    /\blot\s+of\s+(\d+)\b/i,
    /\((\d+)\s*cards?\)/i,
    /\b(\d+)\s*[- ]?card\s+lot\b/i,
    /\b(\d+)\s+different\s+card\s+lot\b/i,
    /\b(\d+)\s*cards?\b/i,
  ];
  let lotSize = 1;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 10000) {
        lotSize = parsed;
        break;
      }
    }
  }
  if (lotSize === 1 && /\bfive\s+posters\b/i.test(text)) lotSize = 5;
  if (
    lotSize === 1 &&
    lower.includes("rc lot") &&
    lower.includes("net marvels") &&
    lower.includes("rated rookie")
  ) {
    lotSize = 2;
  }
  return Math.max(1, lotSize * Math.max(1, Number(ebayQuantity || 1)));
}

function sportFromTitle(title) {
  const value = normalize(title);
  if (/\bwnba\b|panini prizm|panini select|mystics|angel reese|sonia citron|kiki iriafen|dominique malonga/.test(value)) {
    return "Basketball";
  }
  if (/upper deck|ivan demidov|hockey/.test(value)) return "Hockey";
  if (/bowman|brandon compton|george lombard/.test(value)) return "Baseball";
  return "Other Collectible";
}

function itemIdFromUrl(value) {
  return String(value || "").match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})(?:[/?]|$)/i)?.[1] || null;
}

function metadataRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function candidateOrderIds(metadata) {
  const row = metadataRecord(metadata);
  return [
    row.external_order_id,
    row.order_number,
    row.ebay_order_id,
    row.order_id,
    row.receipt_order_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function parseOrderBlock(orderBlock) {
  const orderId = xmlValue(orderBlock, "OrderID") || "";
  const orderSummary = orderBlock.split(/<TransactionArray(?:\s[^>]*)?>/i)[0] || orderBlock;
  const transactionBlocks = xmlBlocks(orderBlock, "Transaction");
  const lines = transactionBlocks
    .map((transaction) => {
      const item = xmlBlocks(transaction, "Item")[0] || transaction;
      const itemId = xmlValue(item, "ItemID") || "";
      const title = xmlValue(item, "Title") || `eBay item ${itemId || "purchase"}`;
      const quantity = Math.max(1, Number(xmlValue(transaction, "QuantityPurchased") || 1));
      const unitPrice = money(xmlValue(transaction, "TransactionPrice"));
      return {
        orderLineItemId: xmlValue(transaction, "OrderLineItemID"),
        transactionId: xmlValue(transaction, "TransactionID"),
        itemId,
        title,
        ebayQuantity: quantity,
        rawSubtotal: roundMoney(unitPrice * quantity),
      };
    })
    .filter((line) => Boolean(line.itemId));

  const shippingBlock = xmlBlocks(orderSummary, "ShippingServiceSelected")[0] || orderSummary;
  const shipping = money(xmlValue(shippingBlock, "ShippingServiceCost"));
  const tax = money(xmlValue(orderSummary, "TotalTaxAmount"));
  const amountPaid = money(xmlValue(orderSummary, "AmountPaid"));
  const total = amountPaid || money(xmlValue(orderSummary, "Total"));
  const subtotal = money(xmlValue(orderSummary, "Subtotal"));
  const purchaseDate =
    xmlValue(orderSummary, "PaidTime") ||
    xmlValue(orderSummary, "CreatedTime") ||
    new Date().toISOString();

  return {
    orderId,
    orderHash: sha(orderId),
    purchaseDate,
    currency:
      xmlCurrency(orderSummary, amountPaid ? "AmountPaid" : "Total") ||
      xmlCurrency(orderSummary, "Subtotal") ||
      "USD",
    orderStatus: xmlValue(orderSummary, "OrderStatus"),
    paymentStatus: xmlValue(orderSummary, "Status"),
    ebayReported: { subtotal, shipping, tax, total },
    lines,
  };
}

async function fetchBuyerOrders(accessToken) {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const orders = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_VERSION}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <CreateTimeFrom>${from.toISOString()}</CreateTimeFrom>
  <CreateTimeTo>${now.toISOString()}</CreateTimeTo>
  <OrderRole>Buyer</OrderRole>
  <OrderStatus>All</OrderStatus>
  <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
</GetOrdersRequest>`;
    const response = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-EBAY-API-CALL-NAME": "GetOrders",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body,
    });
    const xml = await response.text();
    if (!response.ok) throw new Error(`eBay GetOrders failed with HTTP ${response.status}.`);
    const ack = xmlValue(xml, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      throw new Error(xmlValue(xml, "LongMessage") || xmlValue(xml, "ShortMessage") || "eBay GetOrders failed.");
    }
    for (const block of xmlBlocks(xml, "Order")) orders.push(parseOrderBlock(block));
    const totalPages = Math.max(1, Number(xmlValue(xml, "TotalNumberOfPages") || 1));
    if (page >= totalPages) break;
  }
  return orders;
}

async function getEbayBuyerToken(supabase) {
  const { data: tokenRows, error: tokenError } = await supabase
    .from("ebay_tokens")
    .select("store_id,refresh_token,created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (tokenError) throw new Error(tokenError.message);
  const tokenRow = (tokenRows || []).find((row) => String(row.refresh_token || "").trim());
  if (!tokenRow?.refresh_token) throw new Error("No connected eBay refresh token is available.");
  const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.EBAY_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET_KEY || "").trim();
  if (!clientId || !clientSecret) throw new Error("Production eBay client credentials are missing.");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
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
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `eBay token refresh failed (${response.status}).`);
  }
  return String(payload.access_token);
}

async function main() {
  const envPath = process.env.PRODUCTION_ENV_FILE || ".env.production.local";
  loadEnvText(await readFile(envPath, "utf8"));
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) throw new Error("Production Supabase credentials are missing.");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const expectedTotal = roundMoney([...EXPECTED_ORDERS.values()].reduce((sum, value) => sum + value, 0));
  if (expectedTotal !== EXPECTED_PDF_TOTAL) {
    throw new Error(`Embedded PDF reconciliation total drifted: ${expectedTotal} != ${EXPECTED_PDF_TOTAL}.`);
  }

  const accessToken = await getEbayBuyerToken(supabase);
  const allOrders = await fetchBuyerOrders(accessToken);
  const matchedOrders = allOrders.filter((order) => EXPECTED_ORDERS.has(order.orderHash));
  const matchedHashes = new Set(matchedOrders.map((order) => order.orderHash));
  const missingHashes = [...EXPECTED_ORDERS.keys()].filter((hash) => !matchedHashes.has(hash));
  if (missingHashes.length) {
    throw new Error(`Fail-closed: eBay did not return ${missingHashes.length} PDF order(s): ${missingHashes.map((hash) => hash.slice(0, 10)).join(", ")}`);
  }
  if (matchedOrders.length !== EXPECTED_ORDERS.size) {
    throw new Error(`Fail-closed: expected ${EXPECTED_ORDERS.size} unique PDF orders, received ${matchedOrders.length}.`);
  }

  const { data: marketplaces, error: marketplaceError } = await supabase
    .from("tcos_mi_marketplaces")
    .select("id,name,slug")
    .eq("slug", "ebay")
    .limit(2);
  if (marketplaceError) throw new Error(marketplaceError.message);
  if (!marketplaces || marketplaces.length !== 1) throw new Error("Exactly one eBay marketplace row is required.");
  const ebayMarketplaceId = String(marketplaces[0].id);

  const { data: subjects, error: subjectError } = await supabase
    .from("tcos_mi_subjects")
    .select("name")
    .eq("subject_type", "player")
    .eq("active", true)
    .limit(2000);
  if (subjectError) throw new Error(subjectError.message);
  const playerNames = (subjects || [])
    .map((row) => String(row.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => normalize(b).length - normalize(a).length);

  const { data: inboxRows, error: inboxError } = await supabase
    .from("tcos_mi_purchase_inbox")
    .select("id,external_order_id,external_listing_id,direct_url,title,purchased_at,quantity,total_paid,purchase_lot_id,status,metadata")
    .limit(5000);
  if (inboxError) throw new Error(inboxError.message);

  const { data: lotRows, error: lotError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("id,purchase_number,purchased_at,quantity_purchased,total_acquisition_cost,source_url,metadata")
    .order("purchase_number", { ascending: false })
    .limit(5000);
  if (lotError) throw new Error(lotError.message);

  const existingInbox = [...(inboxRows || [])];
  const existingLots = [...(lotRows || [])];
  const result = {
    schema: "tcos.ebay-pdf-purchase-reconciliation.v1",
    generatedAt: new Date().toISOString(),
    expectedPdfOrders: EXPECTED_ORDERS.size,
    expectedPdfAllInTotal: EXPECTED_PDF_TOTAL,
    matchedEbayOrders: matchedOrders.length,
    linesSeen: 0,
    purchaseLotsCreated: 0,
    inboxRowsCreated: 0,
    existingPurchaseLotsReused: 0,
    existingInboxRowsLinked: 0,
    duplicateLinesSkipped: 0,
    capitalAdded: 0,
    unitsAdded: 0,
    items: [],
  };

  for (const order of matchedOrders.sort((a, b) => String(a.purchaseDate).localeCompare(String(b.purchaseDate)))) {
    const authoritativeOrderTotal = Number(EXPECTED_ORDERS.get(order.orderHash));
    const lineAllocations = allocateMoney(authoritativeOrderTotal, order.lines.map((line) => line.rawSubtotal));
    if (roundMoney(lineAllocations.reduce((sum, value) => sum + value, 0)) !== authoritativeOrderTotal) {
      throw new Error(`Allocation failure for order ${order.orderHash.slice(0, 10)}.`);
    }

    for (let index = 0; index < order.lines.length; index += 1) {
      const line = order.lines[index];
      const allIn = roundMoney(lineAllocations[index] || 0);
      const expandedQuantity = quantityFromTitle(line.title, line.ebayQuantity);
      result.linesSeen += 1;
      const directUrl = `https://www.ebay.com/itm/${line.itemId}`;
      const playerName =
        playerNames.find((name) => normalize(line.title).includes(normalize(name))) ||
        "Needs Player Review";
      const keyMatch = (row) => {
        const metadata = metadataRecord(row.metadata);
        const sameOrder = String(row.external_order_id || "").trim() === order.orderId;
        const sameItem = String(row.external_listing_id || "").trim() === line.itemId;
        const sameLine =
          String(metadata.receipt_order_line_item_id || "").trim() === String(line.orderLineItemId || "").trim() &&
          Boolean(line.orderLineItemId);
        const sameTransaction =
          String(metadata.receipt_transaction_id || "").trim() === String(line.transactionId || "").trim() &&
          Boolean(line.transactionId);
        return sameLine || sameTransaction || (sameOrder && sameItem);
      };

      let inbox = existingInbox.find(keyMatch) || null;
      let purchaseLot = null;

      if (inbox?.purchase_lot_id) {
        purchaseLot = existingLots.find((lot) => String(lot.id) === String(inbox.purchase_lot_id)) || null;
      }

      if (!purchaseLot) {
        purchaseLot = existingLots.find((lot) => {
          const metadata = metadataRecord(lot.metadata);
          const orderIdMatch = candidateOrderIds(metadata).includes(order.orderId);
          const itemIdMatch =
            String(metadata.ebay_item_id || metadata.external_listing_id || metadata.ebay_legacy_item_id || "").trim() === line.itemId ||
            itemIdFromUrl(lot.source_url) === line.itemId;
          const titleMatch = normalize(metadata.source_listing_title || metadata.purchase_title) === normalize(line.title);
          const dateMatch = dateOnly(lot.purchased_at) === dateOnly(order.purchaseDate);
          const totalMatch = Math.abs(Number(lot.total_acquisition_cost || 0) - allIn) <= 0.02;
          return (orderIdMatch && itemIdMatch) || (itemIdMatch && dateMatch && totalMatch) || (titleMatch && dateMatch && totalMatch);
        }) || null;
      }

      if (purchaseLot) {
        result.duplicateLinesSkipped += 1;
        result.existingPurchaseLotsReused += 1;
        if (inbox && !inbox.purchase_lot_id) {
          const { error } = await supabase
            .from("tcos_mi_purchase_inbox")
            .update({
              purchase_lot_id: purchaseLot.id,
              metadata: {
                ...metadataRecord(inbox.metadata),
                provisional_purchase_lot_id: purchaseLot.id,
                reconciliation_linked_at: new Date().toISOString(),
              },
            })
            .eq("id", inbox.id);
          if (error) throw new Error(error.message);
          inbox.purchase_lot_id = purchaseLot.id;
          result.existingInboxRowsLinked += 1;
        }
        result.items.push({
          order: order.orderHash.slice(0, 10),
          itemId: line.itemId,
          title: line.title,
          allIn,
          units: expandedQuantity,
          action: "existing_purchase_lot",
          purchaseNumber: Number(purchaseLot.purchase_number || 0),
        });
        continue;
      }

      if (!inbox) {
        const inboxMetadata = {
          source: "ebay_purchase_history_pdf_reconciliation",
          connected_buyer_order_verified: true,
          pdf_purchase_history_verified: true,
          pdf_order_hash_sha256: order.orderHash,
          pdf_expected_order_all_in: authoritativeOrderTotal,
          receipt_order_line_count: order.lines.length,
          receipt_order_line_item_id: line.orderLineItemId || null,
          receipt_transaction_id: line.transactionId || null,
          ebay_legacy_item_id: line.itemId,
          currency: order.currency || "USD",
          source_listing_title: line.title,
          ebay_reported_order_total: order.ebayReported.total,
          all_in_price_authoritative: allIn,
          original_ebay_quantity: line.ebayQuantity,
          expanded_collectible_quantity: expandedQuantity,
          exact_identity_status: "pending",
        };
        const { data: insertedInbox, error: insertInboxError } = await supabase
          .from("tcos_mi_purchase_inbox")
          .insert({
            marketplace_id: ebayMarketplaceId,
            external_order_id: order.orderId,
            external_listing_id: line.itemId,
            direct_url: directUrl,
            title: line.title,
            image_urls: [],
            player_name: playerName,
            sport_or_category: sportFromTitle(line.title),
            purchased_at: new Date(order.purchaseDate).toISOString(),
            quantity: expandedQuantity,
            item_subtotal: allIn,
            inbound_shipping: 0,
            sales_tax: 0,
            buyer_fees: 0,
            other_cost: 0,
            target_bucket: "resale",
            status: "pending",
            metadata: inboxMetadata,
          })
          .select("id,external_order_id,external_listing_id,direct_url,title,purchased_at,quantity,total_paid,purchase_lot_id,status,metadata")
          .single();
        if (insertInboxError) throw new Error(insertInboxError.message);
        inbox = insertedInbox;
        existingInbox.push(inbox);
        result.inboxRowsCreated += 1;
      }

      const purchaseMetadata = {
        beta_one_purchase_source: "ebay_purchase_history_pdf_reconciliation",
        purchase_inbox_id: inbox.id,
        portfolio_bucket: "resale",
        provisional_identity: true,
        exact_identity_status: "pending",
        external_order_id: order.orderId,
        external_order_hash_sha256: order.orderHash,
        ebay_item_id: line.itemId,
        receipt_order_line_item_id: line.orderLineItemId || null,
        receipt_transaction_id: line.transactionId || null,
        source_listing_title: line.title,
        actual_item_subtotal: allIn,
        actual_inbound_shipping: 0,
        actual_sales_tax: 0,
        actual_buyer_fees: 0,
        actual_other_cost: 0,
        actual_out_the_door_cost: allIn,
        all_in_price_source: "uploaded_ebay_purchase_history_pdf",
        pdf_expected_order_all_in: authoritativeOrderTotal,
        ebay_reported_order_total: order.ebayReported.total,
        original_ebay_quantity: line.ebayQuantity,
        expanded_collectible_quantity: expandedQuantity,
        imported_at: new Date().toISOString(),
      };

      const { data: insertedLot, error: insertLotError } = await supabase
        .from("tcos_mi_purchase_lots")
        .insert({
          collectible_identity_id: null,
          marketplace_id: ebayMarketplaceId,
          source_listing_id: null,
          purchased_at: new Date(order.purchaseDate).toISOString(),
          status: "awaiting_receipt",
          quantity_purchased: expandedQuantity,
          item_subtotal: allIn,
          inbound_shipping: 0,
          buyer_fees: 0,
          sales_tax: 0,
          other_acquisition_cost: 0,
          received_at: null,
          source_url: directUrl,
          deal_label: "EBAY PURCHASE",
          notes: `eBay buyer-history purchase: ${line.title}. ALL-IN paid $${allIn.toFixed(2)} for ${expandedQuantity} tracked unit${expandedQuantity === 1 ? "" : "s"}. Exact identity remains pending; do not infer a card variant from the purchase title alone.`,
          metadata: purchaseMetadata,
        })
        .select("id,purchase_number,total_acquisition_cost,unit_cost_basis")
        .single();
      if (insertLotError) throw new Error(insertLotError.message);
      existingLots.push({
        ...insertedLot,
        purchased_at: order.purchaseDate,
        quantity_purchased: expandedQuantity,
        source_url: directUrl,
        metadata: purchaseMetadata,
      });

      const { error: linkError } = await supabase
        .from("tcos_mi_purchase_inbox")
        .update({
          purchase_lot_id: insertedLot.id,
          metadata: {
            ...metadataRecord(inbox.metadata),
            provisional_purchase_lot_id: insertedLot.id,
            reconciliation_linked_at: new Date().toISOString(),
          },
        })
        .eq("id", inbox.id);
      if (linkError) throw new Error(linkError.message);
      inbox.purchase_lot_id = insertedLot.id;

      result.purchaseLotsCreated += 1;
      result.capitalAdded = roundMoney(result.capitalAdded + allIn);
      result.unitsAdded += expandedQuantity;
      result.items.push({
        order: order.orderHash.slice(0, 10),
        itemId: line.itemId,
        title: line.title,
        allIn,
        units: expandedQuantity,
        action: "created_provisional_purchase_lot",
        purchaseNumber: Number(insertedLot.purchase_number || 0),
      });
    }
  }

  const coveredOrderHashes = new Set(result.items.map((item) => item.order));
  if (coveredOrderHashes.size !== EXPECTED_ORDERS.size) {
    throw new Error(`Fail-closed after reconciliation: only ${coveredOrderHashes.size}/${EXPECTED_ORDERS.size} PDF orders were represented.`);
  }

  await writeFile(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`PDF orders matched: ${result.matchedEbayOrders}/${result.expectedPdfOrders}`);
  console.log(`Purchase lots created: ${result.purchaseLotsCreated}`);
  console.log(`Existing purchase lots reused: ${result.existingPurchaseLotsReused}`);
  console.log(`Capital newly added: $${result.capitalAdded.toFixed(2)}`);
  console.log(`Units newly added: ${result.unitsAdded}`);
  console.log(`Reconciliation artifact: ${RESULT_FILE}`);
}

main().catch(async (error) => {
  const failure = {
    schema: "tcos.ebay-pdf-purchase-reconciliation.v1",
    generatedAt: new Date().toISOString(),
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  await writeFile(RESULT_FILE, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => {});
  console.error(failure.error);
  process.exitCode = 1;
});
