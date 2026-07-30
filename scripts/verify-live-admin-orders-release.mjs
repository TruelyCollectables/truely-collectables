import { createHmac } from "node:crypto";

const expectedDeployment =
  process.env.EXPECTED_ADMIN_RELEASE ||
  "admin-session-refund-fee-fix-2026-07-29-2115-mt";
const baseUrl = "https://truelycollectables.com";
const storeId = "00000000-0000-4000-8000-000000000001";
const sessionSecret = process.env.ADMIN_SESSION_SECRET?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!sessionSecret || !supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Production verification requires ADMIN_SESSION_SECRET, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

function adminSessionValue() {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", sessionSecret)
    .update(issuedAt)
    .digest("base64url");
  return `${issuedAt}.${signature}`;
}

const cookie = `tcos_admin_auth_v3=${encodeURIComponent(adminSessionValue())}`;

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "follow",
    cache: "no-store",
    ...options,
    headers: {
      Cookie: cookie,
      "User-Agent": "TCOS-Production-Release-Verification/1.0",
      ...(options.headers || {}),
    },
  });
}

async function waitForDeployment() {
  for (let attempt = 1; attempt <= 72; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/build-info`, {
      cache: "no-store",
      headers: { "User-Agent": "TCOS-Production-Release-Verification/1.0" },
    }).catch(() => null);
    const body = response ? await response.text() : "";

    if (response?.ok && body.includes(expectedDeployment)) {
      return;
    }

    console.log(
      `Attempt ${attempt}/72: waiting for Production marker ${expectedDeployment}.`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  throw new Error(
    `Production never served expected deployment marker ${expectedDeployment}.`,
  );
}

async function latestOrderId() {
  const endpoint = new URL(`${supabaseUrl}/rest/v1/orders`);
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("store_id", `eq.${storeId}`);
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const body = await response.json().catch(() => []);

  if (!response.ok || !Array.isArray(body) || !body[0]?.id) {
    throw new Error("Unable to resolve a live order for Production navigation checks.");
  }

  return Number(body[0].id);
}

async function assertAdminPage(path, expectedText) {
  const response = await request(path);
  const body = await response.text();
  const finalPath = new URL(response.url).pathname;

  if (
    response.status !== 200 ||
    finalPath === "/admin/login" ||
    body.includes("Admin login") ||
    !body.includes(expectedText)
  ) {
    throw new Error(
      `Live admin navigation failed for ${path}: status=${response.status}, finalPath=${finalPath}.`,
    );
  }

  const refreshedCookie = response.headers.get("set-cookie") || "";
  if (!refreshedCookie.includes("tcos_admin_auth_v3=")) {
    throw new Error(`Live admin session was not refreshed while loading ${path}.`);
  }
}

async function reconcileDirectStoreFees() {
  const response = await request("/api/admin/reconcile-platform-fees", {
    method: "POST",
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.success !== true) {
    throw new Error(
      `Live direct-store fee reconciliation failed with status ${response.status}.`,
    );
  }

  const endpoint = new URL(`${supabaseUrl}/rest/v1/platform_fee_ledger_entries`);
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("store_id", `eq.${storeId}`);
  endpoint.searchParams.set("source_type", "eq.tcos_website_checkout");
  endpoint.searchParams.set("seller_account_id", "is.null");

  const remainingResponse = await fetch(endpoint, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const rows = await remainingResponse.json().catch(() => null);

  if (!remainingResponse.ok || !Array.isArray(rows) || rows.length !== 0) {
    throw new Error(
      "Legacy direct-store TCOS platform fee rows remain after reconciliation.",
    );
  }
}

async function assertRefundGuard(orderId) {
  const response = await request("/api/orders/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      reason: "Production verification only; refund confirmation intentionally withheld.",
      confirmed: false,
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (
    response.status !== 400 ||
    !String(body.error || "").toLowerCase().includes("confirm")
  ) {
    throw new Error(
      `Refund safety guard failed: expected a confirmation-required 400, received ${response.status}.`,
    );
  }
}

await waitForDeployment();
const orderId = await latestOrderId();
await assertAdminPage("/admin", "Admin Dashboard");
await assertAdminPage("/admin/orders", "Fulfillment center");
await assertAdminPage(`/admin/orders/${orderId}`, `Order #${orderId}`);
await assertAdminPage(
  `/admin/orders/${orderId}/packing-slip`,
  `Order #${orderId}`,
);
await reconcileDirectStoreFees();
await assertRefundGuard(orderId);

console.log(`LIVE_PRODUCTION_MARKER=${expectedDeployment}`);
console.log("LIVE_ADMIN_SESSION_NAVIGATION=passed");
console.log("LIVE_REFUND_CONFIRMATION_GUARD=passed");
console.log("LIVE_DIRECT_STORE_TCOS_FEES=zero");
