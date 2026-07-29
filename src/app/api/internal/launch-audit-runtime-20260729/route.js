import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "account.updated",
];

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "[REDACTED_STRIPE_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .slice(0, 2000);
}

function add(findings, severity, area, message, evidence = null) {
  findings.push({ severity, area, message, evidence });
}

async function fetchRows(supabase, table, columns = "*", maxRows = 50000) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) return { rows: [], error: sanitizeError(error) };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { rows, error: null };
}

function collectSecrets(value, keyPattern, output = new Set(), depth = 0) {
  if (depth > 6 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, keyPattern, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (keyPattern.test(key) && typeof child === "string" && child.length > 20) output.add(child);
    collectSecrets(child, keyPattern, output, depth + 1);
  }
  return output;
}

async function auditSupabase(findings) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const summary = {
    configured: Boolean(url && serviceRole),
    tableCounts: {},
    tokenRows: [],
  };
  if (!url || !serviceRole) {
    add(findings, "blocker", "supabase", "Production Supabase runtime credentials are unavailable.");
    return summary;
  }

  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const specs = {
    products: "*",
    inventory_items: "*",
    inventory_images: "*",
    orders: "*",
    order_items: "*",
    account_profiles: "*",
    account_store_memberships: "*",
    order_notification_outbox: "*",
    order_notification_deliveries: "*",
    ebay_quantity_sync_outbox: "*",
    checkout_inventory_reservations: "*",
    ebay_tokens: "*",
    connected_accounts: "*",
    store_accounts: "*",
  };
  const data = {};
  const required = new Set([
    "products",
    "inventory_items",
    "inventory_images",
    "orders",
    "order_items",
    "account_profiles",
    "account_store_memberships",
    "ebay_quantity_sync_outbox",
    "checkout_inventory_reservations",
  ]);
  for (const [table, columns] of Object.entries(specs)) {
    const result = await fetchRows(supabase, table, columns, 50000);
    if (result.error) {
      if (required.has(table)) add(findings, "blocker", "supabase-schema", `Required table ${table} could not be read.`, result.error);
      continue;
    }
    data[table] = result.rows;
    summary.tableCounts[table] = result.rows.length;
  }

  const products = data.products || [];
  const inventory = data.inventory_items || [];
  const images = data.inventory_images || [];
  const orders = data.orders || [];
  const orderItems = data.order_items || [];
  const profiles = data.account_profiles || [];
  const memberships = data.account_store_memberships || [];

  const ebayIds = new Map();
  for (const row of products) {
    if (!row.ebay_item_id) continue;
    const key = String(row.ebay_item_id);
    ebayIds.set(key, (ebayIds.get(key) || 0) + 1);
  }
  const duplicateEbay = [...ebayIds.values()].filter((count) => count > 1).length;
  if (duplicateEbay) add(findings, "blocker", "inventory", `${duplicateEbay} duplicate eBay item identities exist.`);
  else add(findings, "verified", "inventory", `No duplicate eBay item identity exists across ${products.length} products.`);

  const invalidProducts = products.filter((row) => Number(row.quantity) < 0 || Number(row.price) < 0);
  if (invalidProducts.length) add(findings, "blocker", "inventory", `${invalidProducts.length} products have negative quantity or price.`);

  const activeProducts = products.filter((row) =>
    Number(row.quantity) > 0 && Number(row.price) > 0 && !row.archived_at &&
    !["sold", "archived", "inactive"].includes(String(row.status || "").toLowerCase()),
  );
  const missingImages = activeProducts.filter((row) => !row.image_url).length;
  if (missingImages) add(findings, "blocker", "inventory", `${missingImages} active sellable products have no primary image.`);
  else add(findings, "verified", "inventory", `${activeProducts.length} active sellable products have primary images.`);

  const productIds = new Set(products.map((row) => String(row.id)));
  const inventoryKeys = new Map();
  for (const row of inventory) {
    const key = `${row.store_id || ""}:${row.legacy_product_id || ""}`;
    inventoryKeys.set(key, (inventoryKeys.get(key) || 0) + 1);
  }
  const duplicateInventory = [...inventoryKeys.entries()].filter(([key, count]) => !key.endsWith(":") && count > 1).length;
  if (duplicateInventory) add(findings, "blocker", "inventory", `${duplicateInventory} duplicate store/product inventory identities exist.`);
  const orphanInventory = inventory.filter((row) => row.legacy_product_id && !productIds.has(String(row.legacy_product_id))).length;
  if (orphanInventory) add(findings, "blocker", "inventory", `${orphanInventory} inventory rows reference missing products.`);

  const primaryByInventory = new Map();
  for (const row of images) {
    if (row.is_primary !== true) continue;
    const key = String(row.inventory_item_id || row.inventory_id || "");
    primaryByInventory.set(key, (primaryByInventory.get(key) || 0) + 1);
  }
  const multiplePrimary = [...primaryByInventory.values()].filter((count) => count > 1).length;
  if (multiplePrimary) add(findings, "blocker", "inventory-images", `${multiplePrimary} inventory rows have multiple primary images.`);

  const orderIds = new Set(orders.map((row) => String(row.id)));
  const orphanOrderItems = orderItems.filter((row) => row.order_id && !orderIds.has(String(row.order_id))).length;
  if (orphanOrderItems) add(findings, "blocker", "orders", `${orphanOrderItems} order items reference missing orders.`);
  const invalidOrderItems = orderItems.filter((row) => Number(row.quantity ?? 1) <= 0 || Number(row.price ?? row.unit_price ?? 0) < 0).length;
  if (invalidOrderItems) add(findings, "blocker", "orders", `${invalidOrderItems} order items have invalid quantity or price.`);

  const emails = new Map();
  for (const row of profiles) {
    if (!row.email) continue;
    const key = String(row.email).trim().toLowerCase();
    emails.set(key, (emails.get(key) || 0) + 1);
  }
  const duplicateEmails = [...emails.values()].filter((count) => count > 1).length;
  if (duplicateEmails) add(findings, "blocker", "buyer-accounts", `${duplicateEmails} duplicate normalized buyer emails exist.`);
  const blockedBuyers = profiles.filter((row) =>
    String(row.account_status || "").toLowerCase() === "payment_verification_required" &&
    String(row.default_account_type || "buyer").toLowerCase() === "buyer",
  ).length;
  if (blockedBuyers) add(findings, "warning", "buyer-accounts", `${blockedBuyers} legacy buyers remain in the retired verification status.`);

  const membershipKeys = new Map();
  for (const row of memberships) {
    const key = `${row.account_id}:${row.store_id}:${row.role}`;
    membershipKeys.set(key, (membershipKeys.get(key) || 0) + 1);
  }
  const duplicateMemberships = [...membershipKeys.values()].filter((count) => count > 1).length;
  if (duplicateMemberships) add(findings, "blocker", "accounts", `${duplicateMemberships} duplicate account/store/role memberships exist.`);

  const notificationRows = [
    ...(data.order_notification_outbox || []),
    ...(data.order_notification_deliveries || []),
  ];
  const terminalNotifications = notificationRows.filter((row) =>
    ["failed", "dead", "exhausted"].includes(String(row.status || "").toLowerCase()),
  ).length;
  if (terminalNotifications) add(findings, "blocker", "notifications", `${terminalNotifications} notification rows are terminally failed.`);

  const badQuantityOutbox = (data.ebay_quantity_sync_outbox || []).filter((row) => Number(row.desired_quantity) < 0).length;
  if (badQuantityOutbox) add(findings, "blocker", "post-sale-ebay", `${badQuantityOutbox} eBay quantity outbox rows have negative desired quantity.`);
  const pendingWithoutRetry = (data.ebay_quantity_sync_outbox || []).filter((row) =>
    String(row.status || "").toLowerCase() === "pending" && !row.next_attempt_at,
  ).length;
  if (pendingWithoutRetry) add(findings, "blocker", "post-sale-ebay", `${pendingWithoutRetry} pending eBay quantity corrections have no retry time.`);
  const invalidReservations = (data.checkout_inventory_reservations || []).filter((row) => Number(row.quantity) <= 0).length;
  if (invalidReservations) add(findings, "blocker", "reservations", `${invalidReservations} checkout reservations have invalid quantity.`);

  summary.tokenRows = [
    ...(data.ebay_tokens || []),
    ...(data.connected_accounts || []),
    ...(data.store_accounts || []),
  ];
  add(findings, "verified", "supabase", `Production service-role queries loaded ${Object.keys(summary.tableCounts).length} audit tables.`);
  return summary;
}

async function auditStripe(findings) {
  const liveKey = process.env.STRIPE_LIVE_SECRET_KEY ||
    (String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_") ? process.env.STRIPE_SECRET_KEY : null);
  const summary = { configured: Boolean(liveKey), chargesEnabled: false, webhookCount: 0, missingEvents: [] };
  if (!liveKey) {
    add(findings, "blocker", "stripe", "A live Stripe secret is unavailable in Production runtime.");
    return summary;
  }
  try {
    const stripe = new Stripe(liveKey);
    const account = await stripe.accounts.retrieve();
    summary.chargesEnabled = account.charges_enabled === true;
    if (!summary.chargesEnabled) add(findings, "blocker", "stripe", "Stripe reports charges disabled.");
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const targets = endpoints.data.filter((endpoint) =>
      endpoint.url === "https://truelycollectables.com/api/webhook" && endpoint.status === "enabled",
    );
    summary.webhookCount = targets.length;
    if (targets.length !== 1) {
      add(findings, "blocker", "stripe", `Expected exactly one enabled custom-domain webhook; found ${targets.length}.`);
    } else {
      summary.missingEvents = REQUIRED_STRIPE_EVENTS.filter((event) =>
        !targets[0].enabled_events.includes(event) && !targets[0].enabled_events.includes("*"),
      );
      if (summary.missingEvents.length) add(findings, "blocker", "stripe", "The live Stripe webhook is missing required events.", summary.missingEvents);
      else add(findings, "verified", "stripe", "The enabled custom-domain Stripe webhook contains every required event.");
    }
    if (summary.chargesEnabled) add(findings, "verified", "stripe", "Stripe reports charges enabled.");
  } catch (error) {
    add(findings, "blocker", "stripe", "Stripe read-only verification failed.", sanitizeError(error));
  }
  return summary;
}

async function auditResend(findings) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MARKET_INTEL_FROM_EMAIL;
  const summary = {
    configured: Boolean(apiKey), fromConfigured: Boolean(from), fromDomainMatches: false,
    domainListStatus: null, domainListErrorType: null, domains: [], verifiedDomain: false,
    testSendAccepted: false,
  };
  if (!apiKey) {
    add(findings, "blocker", "resend", "RESEND_API_KEY is unavailable in Production runtime.");
    return summary;
  }
  const emailMatch = String(from || "").match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  const fromEmail = emailMatch?.[1] || null;
  summary.fromDomainMatches = Boolean(fromEmail && /@(?:[a-z0-9-]+\.)*truelycollectables\.com$/i.test(fromEmail));
  if (!fromEmail || !summary.fromDomainMatches) {
    add(findings, "blocker", "resend", "The configured Production sender is missing or is not on truelycollectables.com.");
    return summary;
  }
  try {
    const result = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${apiKey}`, "user-agent": "TruelyCollectables-LaunchAudit/2.0" },
      cache: "no-store",
    });
    const value = await result.json().catch(() => ({}));
    summary.domainListStatus = result.status;
    summary.domainListErrorType = value.name || value.type || null;
    summary.domains = (value.data || []).map((domain) => ({
      name: String(domain.name || ""), status: String(domain.status || ""),
      sending: domain.capabilities?.sending || null,
    }));
    summary.verifiedDomain = result.ok && summary.domains.some((domain) =>
      /(?:^|\.)truelycollectables\.com$/i.test(domain.name) && domain.status === "verified",
    );
    if (summary.verifiedDomain) {
      add(findings, "verified", "resend", "Resend reports a verified Truely Collectables sending domain.");
      return summary;
    }
    if (result.status === 401 && /restricted_api_key/i.test(String(summary.domainListErrorType || value.message || ""))) {
      add(findings, "warning", "resend", "The Production Resend key is sending-only; a controlled Resend test address will verify sending capability.");
    }
  } catch (error) {
    add(findings, "warning", "resend", "Resend domain-list inspection was unavailable; a controlled test address will verify sending capability.", sanitizeError(error));
  }
  try {
    const idempotencyKey = `launch2-final-${process.env.VERCEL_GIT_COMMIT_SHA || "20260729"}`.slice(0, 200);
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`, "content-type": "application/json",
        "user-agent": "TruelyCollectables-LaunchAudit/2.0", "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        from, to: ["delivered+truely-launch-2@resend.dev"],
        subject: "Truely Collectables Launch 2 integration verification",
        html: "<p>Controlled Resend integration verification. No customer inbox receipt is claimed.</p>",
      }),
      cache: "no-store",
    });
    const value = await result.json().catch(() => ({}));
    summary.testSendAccepted = result.ok && Boolean(value.id);
    if (summary.testSendAccepted) {
      add(findings, "verified", "resend", "Resend accepted a controlled delivery to its designated test address from the configured Truely Collectables sender. This is API/send proof, not customer inbox-receipt proof.");
    } else {
      add(findings, "blocker", "resend", `Resend rejected the controlled test delivery with HTTP ${result.status}.`, sanitizeError(value.message || value.name || "unknown error"));
    }
  } catch (error) {
    add(findings, "blocker", "resend", "Resend controlled test delivery failed.", sanitizeError(error));
  }
  return summary;
}

async function auditEbay(findings, tokenRows) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const summary = { appToken: false, browse: false, sellerTokenPresent: false, tradingRead: false, activeEntries: null };
  if (!clientId || !clientSecret) {
    add(findings, "blocker", "ebay", "eBay Production client credentials are unavailable.");
    return summary;
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  try {
    const tokenResult = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
      cache: "no-store",
    });
    const token = await tokenResult.json();
    summary.appToken = tokenResult.ok && Boolean(token.access_token);
    if (!summary.appToken) throw new Error(`application token HTTP ${tokenResult.status}`);
    const browse = await fetch("https://api.ebay.com/buy/browse/v1/item_summary/search?q=sports%20card&limit=1", {
      headers: { authorization: `Bearer ${token.access_token}`, "x-ebay-c-marketplace-id": "EBAY_US" },
      cache: "no-store",
    });
    summary.browse = browse.ok;
    if (!summary.browse) add(findings, "blocker", "ebay", `eBay Browse returned HTTP ${browse.status}.`);
    else add(findings, "verified", "ebay", "eBay application-token minting and Browse search succeeded.");
  } catch (error) {
    add(findings, "blocker", "ebay", "eBay application-token verification failed.", sanitizeError(error));
  }

  const refreshTokens = [...collectSecrets(tokenRows, /refresh.*token|token.*refresh/i)];
  summary.sellerTokenPresent = refreshTokens.length > 0;
  if (!refreshTokens.length) {
    add(findings, "warning", "ebay", "No seller refresh token was discoverable in known account tables; direct Trading proof is unavailable as credentials permit.");
    return summary;
  }
  const failures = [];
  for (let index = 0; index < refreshTokens.length && !summary.tradingRead; index += 1) {
    const refreshToken = refreshTokens[index];
    for (const scope of [null, "https://api.ebay.com/oauth/api_scope"]) {
      try {
        const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
        if (scope) body.set("scope", scope);
        const refreshResult = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
          method: "POST",
          headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
          body, cache: "no-store",
        });
        const refreshed = await refreshResult.json().catch(() => ({}));
        if (!refreshResult.ok || !refreshed.access_token) {
          failures.push({ candidate: index + 1, scope: scope ? "base" : "default", status: refreshResult.status });
          continue;
        }
        const xml = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList><DetailLevel>ReturnAll</DetailLevel></GetMyeBaySellingRequest>`;
        const trading = await fetch("https://api.ebay.com/ws/api.dll", {
          method: "POST",
          headers: {
            "x-ebay-api-call-name": "GetMyeBaySelling", "x-ebay-api-compatibility-level": "1231",
            "x-ebay-api-siteid": "0", "x-ebay-api-iaf-token": refreshed.access_token,
            "content-type": "text/xml",
          }, body: xml, cache: "no-store",
        });
        const text = await trading.text();
        const ack = text.match(/<Ack>([^<]+)<\/Ack>/)?.[1] || null;
        summary.activeEntries = Number(text.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)?.[1] || 0);
        summary.tradingRead = trading.ok && ["Success", "Warning"].includes(ack);
        if (!summary.tradingRead) failures.push({ candidate: index + 1, scope: scope ? "base" : "default", status: trading.status, ack });
      } catch (error) {
        failures.push({ candidate: index + 1, scope: scope ? "base" : "default", error: sanitizeError(error) });
      }
    }
  }
  if (!summary.tradingRead) add(findings, "blocker", "ebay", "Every discoverable seller refresh-token candidate failed read-only Trading verification.", failures);
  else add(findings, "verified", "ebay", `Seller-authorized Trading read succeeded and reports ${summary.activeEntries} active entries.`);
  return summary;
}

export async function POST(request) {
  if (!safeEqual(request.headers.get("x-tcos-launch-audit-token"), process.env.TCOS_LAUNCH_AUDIT_TOKEN)) {
    return response({ ok: false, code: "UNAUTHORIZED" }, 401);
  }
  const findings = [];
  const environment = process.env.VERCEL_ENV || null;
  if (environment !== "production") add(findings, "blocker", "vercel", `Runtime target is ${environment || "unknown"}, not production.`);
  else add(findings, "verified", "vercel", "The isolated audit deployment is Production-targeted.");

  const supabase = await auditSupabase(findings);
  const stripe = await auditStripe(findings);
  const resend = await auditResend(findings);
  const ebay = await auditEbay(findings, supabase.tokenRows);
  delete supabase.tokenRows;
  const blockers = findings.filter((finding) => finding.severity === "blocker");
  return response({
    ok: blockers.length === 0,
    checkedAt: new Date().toISOString(),
    environment,
    summaries: { supabase, stripe, resend, ebay },
    findings,
    blockerCount: blockers.length,
  });
}
