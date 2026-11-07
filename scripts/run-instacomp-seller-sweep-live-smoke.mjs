import assert from "node:assert/strict";
import fs from "node:fs";

const DEFAULT_ORIGIN = "https://truelycollectables.com";
const QUERY_LADDER = ["WNBA lot", "sports card", "trading card"];
const LIVE_LISTING_LIMIT = 1;
const MAX_COLLECTION_ATTEMPTS = QUERY_LADDER.length;
const MAX_PROCESS_CALLS = 2;
const MAX_RANK_CALLS = 2;
const VERIFY_PATH = "/api/internal/instacomp-seller-sweep-live-verify";
const VERIFY_HEADER = "x-instacomp-seller-sweep-live-verify";

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

async function verifierPost(
  origin,
  secret,
  action,
  body = {},
  timeoutMs = 60_000,
) {
  const response = await fetchWithTimeout(
    `${origin}${VERIFY_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [VERIFY_HEADER]: secret,
      },
      body: JSON.stringify({ action, ...body }),
    },
    timeoutMs,
  );
  const payload = await responseJson(response, `Seller Sweep ${action}`);
  if (payload?.ok !== true || payload?.action !== action) {
    throw new Error(`Seller Sweep ${action} verifier returned an invalid result.`);
  }
  return payload.result;
}

async function verifyWorkbench(origin, secret) {
  const result = await verifierPost(origin, secret, "workbench");
  if (result?.available !== true) {
    throw new Error("Seller Sweep workbench verification did not pass.");
  }
}

async function finalizeNonProcessableSweep(origin, secret, sweepId) {
  await verifierPost(origin, secret, "rank", { sweepId });
}

async function collectOneProcessableListing(origin, secret) {
  for (let index = 0; index < MAX_COLLECTION_ATTEMPTS; index += 1) {
    const result = await verifierPost(
      origin,
      secret,
      "collect",
      { queryIndex: index },
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
      await finalizeNonProcessableSweep(origin, secret, result.sweepId);
    }
  }
  throw new Error(
    `Miss Mels returned no processable listing after ${MAX_COLLECTION_ATTEMPTS} bounded searches.`,
  );
}

async function processSweep(origin, secret, sweepId) {
  let remaining = 1;
  for (let calls = 0; remaining > 0 && calls < MAX_PROCESS_CALLS; calls += 1) {
    const result = await verifierPost(
      origin,
      secret,
      "process",
      { sweepId },
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

async function rankSweep(origin, secret, sweepId) {
  let remaining = 1;
  for (let calls = 0; remaining > 0 && calls < MAX_RANK_CALLS; calls += 1) {
    const result = await verifierPost(
      origin,
      secret,
      "rank",
      { sweepId },
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
  const secretFile = process.env.SELLER_SWEEP_LIVE_VERIFY_SECRET_FILE;
  if (!secretFile)
    throw new Error("SELLER_SWEEP_LIVE_VERIFY_SECRET_FILE is required.");
  const secret = fs.readFileSync(secretFile, "utf8").trim();
  if (!secret)
    throw new Error("The Seller Sweep live-verification secret file is empty.");

  await verifyWorkbench(origin, secret);
  const collected = await collectOneProcessableListing(origin, secret);
  await processSweep(origin, secret, collected.sweepId);
  await rankSweep(origin, secret, collected.sweepId);
  const snapshot = await verifierPost(
    origin,
    secret,
    "status",
    { sweepId: collected.sweepId },
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
  assert.equal(MAX_COLLECTION_ATTEMPTS, 3);
  assert.equal(LIVE_LISTING_LIMIT, 1);
  assert.equal(MAX_PROCESS_CALLS, 2);
  assert.equal(MAX_RANK_CALLS, 2);
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
