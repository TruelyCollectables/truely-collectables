import assert from "node:assert/strict";
import fs from "node:fs";

const DEFAULT_ORIGIN = "https://truelycollectables.com";
const ADMIN_COOKIE_NAME = "tcos_admin_auth_v3";
const SELLER_URL = "https://www.ebay.com/str/missmelscards";
const QUERY_LADDER = ["WNBA lot", "sports card", "trading card"];
const LIVE_LISTING_LIMIT = 1;
const MAX_COLLECTION_ATTEMPTS = QUERY_LADDER.length;
const MAX_PROCESS_CALLS = 2;
const MAX_RANK_CALLS = 2;

function normalizeProductionOrigin(value) {
  const url = new URL(String(value || DEFAULT_ORIGIN));
  if (
    url.protocol !== "https:" ||
    url.hostname !== "truelycollectables.com" ||
    url.port ||
    url.username ||
    url.password ||
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "PRODUCTION_ORIGIN must be the root https://truelycollectables.com URL.",
    );
  }
  return DEFAULT_ORIGIN;
}

function adminSessionCookie(setCookies) {
  let selected = "";
  for (const value of setCookies) {
    const match = new RegExp(`^${ADMIN_COOKIE_NAME}=([^;]+)`).exec(value);
    if (match?.[1]) selected = `${ADMIN_COOKIE_NAME}=${match[1]}`;
  }
  if (!selected)
    throw new Error("Production admin login did not create an admin session.");
  return selected;
}

function diagnosticMessage(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 60_000) {
  return fetch(url, {
    redirect: "manual",
    cache: "no-store",
    ...init,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "TCOSSellerSweepProductionSmoke/1.0",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function responseJson(response, label) {
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(
      `${label} failed with HTTP ${response.status}: ${diagnosticMessage(body?.error)}`,
    );
  }
  return body;
}

async function apiPost(origin, cookie, path, body, timeoutMs = 60_000) {
  const response = await fetchWithTimeout(
    `${origin}${path}`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  return responseJson(response, path);
}

async function apiGet(origin, cookie, path, timeoutMs = 60_000) {
  const response = await fetchWithTimeout(
    `${origin}${path}`,
    { headers: { Cookie: cookie } },
    timeoutMs,
  );
  return responseJson(response, path);
}

async function login(origin, password) {
  const response = await fetchWithTimeout(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password,
      nextPath: "/admin/instacomp/seller-sweep",
    }),
  });
  const body = await responseJson(response, "Production admin login");
  if (body?.success !== true)
    throw new Error("Production admin login was not successful.");
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return adminSessionCookie(setCookies);
}

async function verifyWorkbench(origin, cookie) {
  const response = await fetchWithTimeout(
    `${origin}/admin/instacomp/seller-sweep?production_smoke=${Date.now()}`,
    { headers: { Cookie: cookie } },
  );
  const html = await response.text();
  if (!response.ok || !html.includes("Seller Sweep")) {
    throw new Error(
      `Seller Sweep workbench was unavailable (HTTP ${response.status}).`,
    );
  }
}

async function finalizeNonProcessableSweep(origin, cookie, sweepId) {
  await apiPost(origin, cookie, "/api/admin/instacomp/seller-sweep/rank", {
    sweepId,
    batchSize: 1,
  });
}

async function collectOneProcessableListing(origin, cookie) {
  for (let index = 0; index < MAX_COLLECTION_ATTEMPTS; index += 1) {
    const query = QUERY_LADDER[index];
    const result = await apiPost(
      origin,
      cookie,
      "/api/admin/instacomp/seller-sweep",
      { sellerUrl: SELLER_URL, query, limit: LIVE_LISTING_LIMIT },
      120_000,
    );
    if (result?.persistenceWarning) {
      throw new Error(
        `Seller Sweep persistence failed: ${diagnosticMessage(result.persistenceWarning)}`,
      );
    }
    if (
      result?.listingLimit !== LIVE_LISTING_LIMIT ||
      Number(result?.total) > LIVE_LISTING_LIMIT
    ) {
      throw new Error(
        "Seller Sweep did not enforce the one-listing production smoke limit.",
      );
    }
    if (Number(result?.total) === 1 && Number(result?.photosReady) === 1) {
      return result;
    }
    if (result?.sweepId) {
      await finalizeNonProcessableSweep(origin, cookie, result.sweepId);
    }
  }
  throw new Error(
    `Miss Mels returned no processable listing after ${MAX_COLLECTION_ATTEMPTS} bounded searches.`,
  );
}

async function processSweep(origin, cookie, sweepId) {
  let remaining = 1;
  for (let calls = 0; remaining > 0 && calls < MAX_PROCESS_CALLS; calls += 1) {
    const result = await apiPost(
      origin,
      cookie,
      "/api/admin/instacomp/seller-sweep/process",
      { sweepId, batchSize: 1 },
      330_000,
    );
    remaining = Math.max(0, Number(result?.remaining) || 0);
    if (remaining > 0 && Number(result?.processedThisRun) < 1) {
      throw new Error("Live candidate extraction made no progress.");
    }
  }
  if (remaining > 0)
    throw new Error("Live candidate extraction exceeded its call limit.");
}

async function rankSweep(origin, cookie, sweepId) {
  let remaining = 1;
  for (let calls = 0; remaining > 0 && calls < MAX_RANK_CALLS; calls += 1) {
    const result = await apiPost(
      origin,
      cookie,
      "/api/admin/instacomp/seller-sweep/rank",
      { sweepId, batchSize: 1 },
      120_000,
    );
    remaining = Math.max(0, Number(result?.remaining) || 0);
    if (remaining > 0 && Number(result?.processedThisRun) < 1) {
      throw new Error("Live valuation made no progress.");
    }
  }
  if (remaining > 0) throw new Error("Live valuation exceeded its call limit.");
}

function verifyCompletedSnapshot(snapshot) {
  assert.equal(snapshot?.ok, true, "Seller Sweep status must return ok.");
  assert.equal(
    snapshot?.sweep?.status,
    "completed",
    "Seller Sweep must terminate.",
  );
  assert.equal(
    snapshot?.summary?.total,
    1,
    "Live verification must remain one listing.",
  );
  assert.equal(
    snapshot?.summary?.pending,
    0,
    "Live verification must leave no pending work.",
  );
  const terminal =
    Number(snapshot?.summary?.ranked || 0) +
    Number(snapshot?.summary?.review || 0) +
    Number(snapshot?.summary?.failed || 0);
  assert.equal(
    terminal,
    1,
    "The bounded listing must finish in a terminal state.",
  );
  assert.equal(
    snapshot?.listings?.length,
    1,
    "Exactly one result row must be returned.",
  );
}

async function runLive() {
  const origin = normalizeProductionOrigin(process.env.PRODUCTION_ORIGIN);
  const passwordFile = process.env.SELLER_SWEEP_ADMIN_PASSWORD_FILE;
  if (!passwordFile)
    throw new Error("SELLER_SWEEP_ADMIN_PASSWORD_FILE is required.");
  const password = fs.readFileSync(passwordFile, "utf8").trim();
  if (!password)
    throw new Error("The Production admin password file is empty.");

  const cookie = await login(origin, password);
  await verifyWorkbench(origin, cookie);
  const collected = await collectOneProcessableListing(origin, cookie);
  await processSweep(origin, cookie, collected.sweepId);
  await rankSweep(origin, cookie, collected.sweepId);
  const snapshot = await apiGet(
    origin,
    cookie,
    `/api/admin/instacomp/seller-sweep/status?sweepId=${encodeURIComponent(collected.sweepId)}`,
  );
  verifyCompletedSnapshot(snapshot);

  console.log(
    JSON.stringify({
      ok: true,
      sellerSweep: "production_live",
      seller: snapshot.sweep.seller,
      query: snapshot.sweep.query,
      sweepId: snapshot.sweep.id,
      total: snapshot.summary.total,
      cardsIdentified: snapshot.summary.cardsIdentified,
      ranked: snapshot.summary.ranked,
      review: snapshot.summary.review,
      failed: snapshot.summary.failed,
      pending: snapshot.summary.pending,
      automaticPublishing: false,
      automaticPriceChanges: false,
    }),
  );
  console.log("LIVE_SELLER_SWEEP=passed");
}

function selfTest() {
  assert.equal(normalizeProductionOrigin(DEFAULT_ORIGIN), DEFAULT_ORIGIN);
  assert.throws(() =>
    normalizeProductionOrigin("http://truelycollectables.com"),
  );
  assert.throws(() => normalizeProductionOrigin("https://example.com"));
  assert.throws(() => normalizeProductionOrigin(`${DEFAULT_ORIGIN}/admin`));
  assert.equal(
    adminSessionCookie([
      `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/`,
      `${ADMIN_COOKIE_NAME}=signed-session; Max-Age=86400; Path=/`,
    ]),
    `${ADMIN_COOKIE_NAME}=signed-session`,
  );
  verifyCompletedSnapshot({
    ok: true,
    sweep: { status: "completed" },
    summary: { total: 1, pending: 0, ranked: 0, review: 1, failed: 0 },
    listings: [{}],
  });
  console.log("Seller Sweep Production smoke self-test passed.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  await runLive();
}
