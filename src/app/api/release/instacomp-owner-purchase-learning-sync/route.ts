import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  ["44d641deb737ffe158b4e57b55eb5604db1c0135c253f7f8adcd100952c08691", 3.4],
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

const EXPECTED_POSITIONS = 28;
const EXPECTED_ALL_IN_TOTAL = 528.52;
const TRADING_API_VERSION = "1209";
const EBAY_BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const RECEIPT_SCHEMA = "tcos.instacomp.ownerPurchaseLearningReceipt.v1";
const EVENT_SCHEMA = "tcos.instacomp-ai.ownerPurchaseLearningEvent.v1";

type PurchaseLot = {
  id: string;
  purchase_number: number | null;
  purchased_at: string;
  quantity_purchased: number | null;
  total_acquisition_cost: number | null;
  unit_cost_basis: number | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  collectible_identity_id: string | null;
};

type PurchaseInbox = {
  id: string;
  external_order_id: string | null;
  external_listing_id: string | null;
  title: string | null;
  purchase_lot_id: string | null;
  metadata: Record<string, unknown> | null;
};

type BuyerLine = {
  orderLineItemId: string | null;
  transactionId: string | null;
  itemId: string;
  title: string;
  ebayQuantity: number;
  rawSubtotal: number;
};

type BuyerOrder = {
  orderId: string;
  orderHash: string;
  purchaseDate: string;
  lines: BuyerLine[];
};

type LearningTarget = {
  lot: PurchaseLot;
  line: BuyerLine;
  orderHash: string;
  allIn: number;
  quantity: number;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function sha(value: unknown) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function itemIdFromUrl(value: unknown) {
  return (
    String(value || "").match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})(?:[/?]|$)/i)?.[1] ||
    null
  );
}

function candidateOrderIds(metadata: unknown) {
  const row = record(metadata);
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

function escapedTagName(tag: string) {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value: string) {
  return String(value || "")
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlValue(source: string, tag: string) {
  const escapedTag = escapedTagName(tag);
  const match = String(source || "").match(
    new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : null;
}

function xmlBlocks(source: string, tag: string) {
  const escapedTag = escapedTagName(tag);
  return Array.from(
    String(source || "").matchAll(
      new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "gi"),
    ),
    (match) => match[1],
  );
}

function allocateMoney(total: number, weights: number[]) {
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

function quantityFromTitle(title: string, ebayQuantity: number) {
  const patterns = [
    /\blot\s+of\s+(\d+)\b/i,
    /\((\d+)\s*cards?\)/i,
    /\b(\d+)\s*[- ]?card\s+lot\b/i,
    /\b(\d+)\s+different\s+card\s+lot\b/i,
    /\b(\d+)\s*cards?\b/i,
  ];
  let lotSize = 1;
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 10000) {
        lotSize = parsed;
        break;
      }
    }
  }
  if (lotSize === 1 && /\bfive\s+posters\b/i.test(title)) lotSize = 5;
  const lower = title.toLowerCase();
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

function parseOrderBlock(orderBlock: string): BuyerOrder {
  const orderId = xmlValue(orderBlock, "OrderID") || "";
  const orderSummary = orderBlock.split(/<TransactionArray(?:\s[^>]*)?>/i)[0] || orderBlock;
  const lines = xmlBlocks(orderBlock, "Transaction")
    .map((transaction): BuyerLine => {
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
  const purchaseDate =
    xmlValue(orderSummary, "PaidTime") ||
    xmlValue(orderSummary, "CreatedTime") ||
    new Date().toISOString();
  return { orderId, orderHash: sha(orderId), purchaseDate, lines };
}

async function getEbayBuyerToken(supabase: any) {
  const { data: tokenRows, error: tokenError } = await supabase
    .from("ebay_tokens")
    .select("refresh_token,created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (tokenError) throw new Error(tokenError.message);
  const tokenRow = ((tokenRows || []) as Array<{ refresh_token?: string | null }>).find(
    (row) => String(row.refresh_token || "").trim(),
  );
  if (!tokenRow?.refresh_token) {
    throw new Error("No connected eBay refresh token is available.");
  }

  const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = String(
    process.env.EBAY_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET_KEY || "",
  ).trim();
  if (!clientId || !clientSecret) {
    throw new Error("Production eBay client credentials are missing.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
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
    throw new Error(
      payload.error_description || payload.error || `eBay refresh failed (${response.status}).`,
    );
  }
  return payload.access_token;
}

async function fetchBuyerOrders(accessToken: string) {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const orders: BuyerOrder[] = [];
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
      cache: "no-store",
    });
    const xml = await response.text();
    if (!response.ok) throw new Error(`eBay GetOrders failed with HTTP ${response.status}.`);
    const ack = xmlValue(xml, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      throw new Error(
        xmlValue(xml, "LongMessage") ||
          xmlValue(xml, "ShortMessage") ||
          "eBay GetOrders failed.",
      );
    }
    for (const block of xmlBlocks(xml, "Order")) orders.push(parseOrderBlock(block));
    const totalPages = Math.max(1, Number(xmlValue(xml, "TotalNumberOfPages") || 1));
    if (page >= totalPages) break;
  }
  return orders;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function authorized(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function macBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    throw new Error(
      "Production InstaComp Mac tunnel URL is missing or not on truelycollectables.com.",
    );
  }
  return configured;
}

function macHeaders() {
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!key) throw new Error("Production InstaComp Mac shared key is missing.");
  return {
    "X-InstaComp-AI-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function learningReceipt(metadata: Record<string, any>) {
  return record(metadata.owner_purchase_learning);
}

function isSynced(metadata: Record<string, any>) {
  const value = learningReceipt(metadata);
  return value.schema === RECEIPT_SCHEMA && value.status === "synced";
}

function isInFlight(metadata: Record<string, any>) {
  const value = learningReceipt(metadata);
  return value.schema === RECEIPT_SCHEMA && value.status === "sending";
}

async function postTrustedBuyEvent(params: {
  baseUrl: string;
  headers: Record<string, string>;
  candidateKey: string;
  payload: Record<string, unknown>;
}) {
  const response = await fetch(`${params.baseUrl}/v1/training/deal-hunter/feedback`, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify({
      eventType: "BUY",
      candidateKey: params.candidateKey,
      payload: params.payload,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let parsed: any = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = { raw: body.slice(0, 1000) };
  }
  if (
    !response.ok ||
    parsed?.ok !== true ||
    parsed?.trusted !== true ||
    String(parsed?.event_type || "").toUpperCase() !== "BUY"
  ) {
    throw new Error(
      `Physical Mac rejected trusted BUY learning event: HTTP ${response.status} ${JSON.stringify(parsed).slice(0, 1200)}`,
    );
  }
}

async function deriveTargets(supabase: any) {
  const [accessToken, inboxRead, lotRead] = await Promise.all([
    getEbayBuyerToken(supabase),
    supabase
      .from("tcos_mi_purchase_inbox")
      .select("id,external_order_id,external_listing_id,title,purchase_lot_id,metadata")
      .limit(5000),
    supabase
      .from("tcos_mi_purchase_lots")
      .select(
        "id,purchase_number,purchased_at,quantity_purchased,total_acquisition_cost,unit_cost_basis,source_url,metadata,collectible_identity_id",
      )
      .order("purchase_number", { ascending: false })
      .limit(5000),
  ]);
  if (inboxRead.error) throw new Error(`Purchase Inbox read failed: ${inboxRead.error.message}`);
  if (lotRead.error) throw new Error(`Purchase Ledger read failed: ${lotRead.error.message}`);

  const buyerOrders = await fetchBuyerOrders(accessToken);
  const matchedOrders = buyerOrders.filter((order) => EXPECTED_ORDERS.has(order.orderHash));
  const coveredOrderHashes = new Set(matchedOrders.map((order) => order.orderHash));
  if (coveredOrderHashes.size !== EXPECTED_ORDERS.size) {
    throw new Error(
      `Owner-purchase source gate found only ${coveredOrderHashes.size}/${EXPECTED_ORDERS.size} verified eBay orders.`,
    );
  }

  const existingInbox = (inboxRead.data || []) as PurchaseInbox[];
  const existingLots = (lotRead.data || []) as PurchaseLot[];
  const targets: LearningTarget[] = [];
  const usedLotIds = new Set<string>();

  for (const order of matchedOrders.sort((a, b) =>
    String(a.purchaseDate).localeCompare(String(b.purchaseDate)),
  )) {
    const authoritativeOrderTotal = Number(EXPECTED_ORDERS.get(order.orderHash));
    const lineAllocations = allocateMoney(
      authoritativeOrderTotal,
      order.lines.map((line) => line.rawSubtotal),
    );
    if (
      roundMoney(lineAllocations.reduce((sum, value) => sum + value, 0)) !==
      authoritativeOrderTotal
    ) {
      throw new Error(`Allocation failure for eBay order ${order.orderHash.slice(0, 10)}.`);
    }

    for (let index = 0; index < order.lines.length; index += 1) {
      const line = order.lines[index];
      const allIn = lineAllocations[index];
      const expandedQuantity = quantityFromTitle(line.title, line.ebayQuantity);
      const keyMatch = (row: PurchaseInbox) => {
        const metadata = record(row.metadata);
        const sameOrder = String(row.external_order_id || "").trim() === order.orderId;
        const sameItem = String(row.external_listing_id || "").trim() === line.itemId;
        const sameLine =
          String(metadata.receipt_order_line_item_id || "").trim() ===
            String(line.orderLineItemId || "").trim() && Boolean(line.orderLineItemId);
        const sameTransaction =
          String(metadata.receipt_transaction_id || "").trim() ===
            String(line.transactionId || "").trim() && Boolean(line.transactionId);
        return sameLine || sameTransaction || (sameOrder && sameItem);
      };

      const inbox = existingInbox.find(keyMatch) || null;
      let lot: PurchaseLot | null = null;
      if (inbox?.purchase_lot_id) {
        lot =
          existingLots.find(
            (candidate) => String(candidate.id) === String(inbox.purchase_lot_id),
          ) || null;
      }
      if (!lot) {
        lot =
          existingLots.find((candidate) => {
            const metadata = record(candidate.metadata);
            const orderIdMatch = candidateOrderIds(metadata).includes(order.orderId);
            const itemIdMatch =
              String(
                metadata.ebay_item_id ||
                  metadata.external_listing_id ||
                  metadata.ebay_legacy_item_id ||
                  "",
              ).trim() === line.itemId || itemIdFromUrl(candidate.source_url) === line.itemId;
            const titleMatch =
              normalize(metadata.source_listing_title || metadata.purchase_title) ===
              normalize(line.title);
            const dateMatch = dateOnly(candidate.purchased_at) === dateOnly(order.purchaseDate);
            const totalMatch =
              Math.abs(Number(candidate.total_acquisition_cost || 0) - allIn) <= 0.02;
            return (
              (orderIdMatch && itemIdMatch) ||
              (itemIdMatch && dateMatch && totalMatch) ||
              (titleMatch && dateMatch && totalMatch)
            );
          }) || null;
      }

      if (!lot) {
        throw new Error(`Verified eBay line ${line.itemId} has no canonical Purchase Ledger position.`);
      }
      if (usedLotIds.has(lot.id)) {
        throw new Error(`Canonical Purchase Ledger position ${lot.id} matched more than one eBay line.`);
      }
      if (Math.abs(Number(lot.total_acquisition_cost || 0) - allIn) > 0.02) {
        throw new Error(
          `Purchase #${lot.purchase_number || "?"} ALL-IN cost no longer matches its verified eBay receipt.`,
        );
      }
      if (Number(lot.quantity_purchased || 0) !== expandedQuantity) {
        throw new Error(
          `Purchase #${lot.purchase_number || "?"} quantity no longer matches its verified eBay receipt.`,
        );
      }

      usedLotIds.add(lot.id);
      targets.push({
        lot,
        line,
        orderHash: order.orderHash,
        allIn,
        quantity: expandedQuantity,
      });
    }
  }

  const allInTotal = money(
    targets.reduce((sum, target) => sum + Number(target.lot.total_acquisition_cost || 0), 0),
  );
  if (
    targets.length !== EXPECTED_POSITIONS ||
    usedLotIds.size !== EXPECTED_POSITIONS ||
    allInTotal !== EXPECTED_ALL_IN_TOTAL
  ) {
    throw new Error(
      `Owner-purchase truth gate failed: ${targets.length}/${EXPECTED_POSITIONS} positions, ${usedLotIds.size}/${EXPECTED_POSITIONS} unique lots, $${allInTotal.toFixed(2)}/$${EXPECTED_ALL_IN_TOTAL.toFixed(2)} ALL-IN.`,
    );
  }

  return { targets, matchedOrders: coveredOrderHashes.size, allInTotal };
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const mode = String(url.searchParams.get("mode") || "inspect").toLowerCase();
    if (!new Set(["inspect", "sync"]).has(mode)) {
      return Response.json(
        { success: false, error: "mode must be inspect or sync" },
        { status: 400 },
      );
    }

    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) {
      throw new Error("Production Supabase service role is not configured.");
    }
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { targets, matchedOrders, allInTotal } = await deriveTargets(supabase);
    const alreadySynced = targets.filter(({ lot }) => isSynced(record(lot.metadata))).length;
    const inFlight = targets.filter(({ lot }) => isInFlight(record(lot.metadata)));

    if (mode === "inspect") {
      return Response.json(
        {
          success: true,
          truthGatePassed: true,
          schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
          mode,
          matchedOrders,
          eligible: targets.length,
          allInTotal,
          alreadySynced,
          pending: targets.length - alreadySynced - inFlight.length,
          inFlight: inFlight.length,
          verified: alreadySynced,
          purchaseTruth: "owner_confirmed_100_percent",
          identityBoundary:
            "Purchase, listing title, quantity, date, and ALL-IN cost are trusted. Exact visual/checklist identity remains gated until Registry evidence exists.",
          checkedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (inFlight.length) {
      return Response.json(
        {
          success: false,
          error:
            "A prior learning write is marked in-flight. Sync stopped rather than risk duplicating a trusted learning event.",
          eligible: targets.length,
          allInTotal,
          alreadySynced,
          inFlight: inFlight.length,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const baseUrl = macBaseUrl();
    const headers = macHeaders();
    let sent = 0;

    for (const target of targets) {
      const { lot, line, orderHash, allIn, quantity } = target;
      const metadata = record(lot.metadata);
      if (isSynced(metadata)) continue;

      const candidateKey = `owner-ebay-purchase:${lot.id}`;
      const startedAt = new Date().toISOString();
      const sendingReceipt = {
        schema: RECEIPT_SCHEMA,
        status: "sending",
        eventType: "BUY",
        candidateKey,
        verificationSource: "owner_confirmed_ebay_purchase_history",
        purchaseTruthConfidence: 1,
        sourceOrderHashSha256: orderHash,
        startedAt,
      };

      const { error: sendingError } = await supabase
        .from("tcos_mi_purchase_lots")
        .update({
          metadata: {
            ...metadata,
            owner_purchase_learning: sendingReceipt,
          },
        })
        .eq("id", lot.id);
      if (sendingError) {
        throw new Error(
          `Could not reserve Purchase #${lot.purchase_number || "?"} for exactly-once learning: ${sendingError.message}`,
        );
      }

      const unit = money(lot.unit_cost_basis || allIn / quantity);
      await postTrustedBuyEvent({
        baseUrl,
        headers,
        candidateKey,
        payload: {
          schema_version: EVENT_SCHEMA,
          source: "owner_confirmed_ebay_purchase_history",
          verificationSource: "owner_confirmed_purchase_ledger_reconciliation",
          ownerConfirmed: true,
          purchaseTruth: true,
          truthConfidence: 1,
          purchaseLotId: lot.id,
          purchaseNumber: Number(lot.purchase_number || 0),
          title: line.title,
          marketplace: "eBay",
          ebayItemId: line.itemId,
          sourceOrderHashSha256: orderHash,
          purchasedAt: lot.purchased_at,
          quantity,
          allInTotal: allIn,
          allInUnitCost: unit,
          currency: text(metadata.currency) || "USD",
          allInPriceAuthoritative: true,
          identityTruthStatus: lot.collectible_identity_id
            ? "structured_market_intel_identity_present"
            : "pending_exact_registry_identity",
          exactRegistryIdentityTrainingAllowed: false,
          note:
            "Trusted owner purchase example. Do not convert this receipt/listing title into visual exact-card identity truth without Registry-backed image evidence.",
        },
      });

      const { error: syncedError } = await supabase
        .from("tcos_mi_purchase_lots")
        .update({
          metadata: {
            ...metadata,
            owner_purchase_learning: {
              ...sendingReceipt,
              status: "synced",
              syncedAt: new Date().toISOString(),
              localDecisionLearning: true,
              identityTrainingMutated: false,
            },
          },
        })
        .eq("id", lot.id);
      if (syncedError) {
        throw new Error(
          `Mac accepted Purchase #${lot.purchase_number || "?"}, but its durable ledger learning receipt could not be finalized: ${syncedError.message}`,
        );
      }
      sent += 1;
    }

    const targetIds = targets.map(({ lot }) => lot.id);
    const { data: verifyRows, error: verifyError } = await supabase
      .from("tcos_mi_purchase_lots")
      .select("id,metadata")
      .in("id", targetIds);
    if (verifyError) throw new Error(`Learning verification read failed: ${verifyError.message}`);
    const verified = (verifyRows || []).filter((row: any) =>
      isSynced(record(row.metadata)),
    ).length;

    if (verified !== EXPECTED_POSITIONS) {
      throw new Error(
        `Learning verification failed closed: expected ${EXPECTED_POSITIONS} synced purchases, found ${verified}.`,
      );
    }

    return Response.json(
      {
        success: true,
        truthGatePassed: true,
        schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
        mode,
        matchedOrders,
        eligible: targets.length,
        allInTotal,
        sent,
        alreadySynced: targets.length - sent,
        verified,
        inFlight: 0,
        purchaseTruth: "owner_confirmed_100_percent",
        learningLayer: "trusted_deal_hunter_purchase_decision_memory",
        identityBoundary:
          "All purchase facts are trusted. Visual exact-card identity remains fail-closed until Registry-backed image evidence exists.",
        completedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
