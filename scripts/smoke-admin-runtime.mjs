import { spawn } from "node:child_process";

const args = new Set(process.argv.slice(2));
const existingOnly = args.has("--existing");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : 3000;
const origin = `http://127.0.0.1:${port}`;
const startupTimeoutMs = 45_000;
const requestTimeoutMs = 20_000;

const route = (path, expectedText, auth = true) => ({ path, auth, expectedText });
const smokeRoutes = [
  route("/admin/login", "Admin password", false),
  route("/admin/reset-password", "Choose a permanent admin password", false),
  route("/admin", "Command Center"),
  route("/admin/instacomp-direct", "InstaComp™ Direct Scan Lab"),
  route("/admin/instacomp/mobile", "InstaComp Mobile"),
  route("/admin/products", "Admin products"),
  route("/admin/products/new", "List Cards"),
  route("/admin/quick-list", "Accuracy Council + InstaComp™"),
  route("/admin/verified-reference-import", "Verified Reference → Pending Listings"),
  route("/admin/orders", "Orders"),
  route("/admin/order-notifications", "Order Notification Delivery"),
  route("/admin/sales-history", "Sold Collectibles"),
  route("/admin/offers", "Offers"),
  route("/admin/ebay/inventory-intake", "eBay Inventory Intake"),
  route("/admin/ebay/duplicates", "Duplicate cleanup queue"),
  route("/admin/financial-reconciliation", "Stripe Reconciliation"),
  route("/admin/market-intel", "Market Intel"),
  route("/admin/market-intel/kingmaker", "Capital Intelligence Command"),
  route("/admin/market-intel/kingmaker/capital-ledger", "Purchase Ledger Command"),
  route("/admin/production-smoke", "Production smoke"),
  route("/admin/live-payment-launch", "Live Payment"),
  route("/admin/live-shipping-launch", "Live Shipping"),
  route("/admin/settings", "Settings"),
  route("/admin/security", "Security"),
  {
    path: "/admin/accounts",
    auth: true,
    expectedTexts: ["Customer Account Lookup", "Customer Accounts"],
  },
  route("/admin/buyer-protection", "Buyer Protection Claims"),
  route("/admin/owner-seller-account", "Activate the owner seller account"),
  route("/admin/ebay", "eBay Reconciliation"),
  route("/admin/ebay/import-runner", "eBay Import Runner"),
  route("/admin/ebay/full-store-sync", "Full eBay Store Sync"),
  route("/admin/ebay/launch-ready-sync", "eBay Launch Readiness"),
  route("/admin/ebay/publish", "Pitch Black listing launcher"),
  route("/admin/ebay/sync-control", "eBay Sync Control"),
  route("/admin/files", "Admin Files"),
  route("/admin/instacomp", "InstaComp™ Scan Lab"),
  route("/admin/instacomp/v2", "InstaComp™ 2.0"),
  route("/admin/instacomp/seller-sweep", "InstaComp™ Seller Sweep"),
  route("/admin/pending-card-import", "Card Intake & Listing"),
  route("/admin/instacomp/checklists", "Checklist Registry"),
  route("/admin/inventory", "Inventory Bridge"),
  route("/admin/inventory/category-review", "Import Category Review"),
  route("/admin/launch-gate-drill", "Launch Gate Drill"),
  route("/admin/launch-readiness", "Launch Readiness"),
  route("/admin/market-intel/readiness", "Readiness Control Board"),
  route("/admin/market-intel/watchlist", "Player Watchlist"),
  route("/admin/market-intel/watch-center", "Who, What, and When to Investigate"),
  route("/admin/market-intel/comps", "Exact-Card Sold Comps"),
  route("/admin/market-intel/discovery", "Licensed-Card Discovery Desk"),
  route("/admin/market-intel/ebay", "eBay Active Listing Scanner"),
  route("/admin/market-intel/deals", "Shark List™ Deal Engine"),
  route("/admin/market-intel/growth-specs", "Growth Spec Lab™"),
  route("/admin/market-intel/growth-specs/prospects", "Licensed Pro Value Watchlists"),
  route("/admin/market-intel/buy", "Buy + Track Desk"),
  route("/admin/market-intel/portfolio", "Portfolio Intelligence"),
  route("/admin/market-intel/purchases", "Purchase Ledger"),
  route("/admin/market-intel/purchases/deleted", "Duplicate removed"),
  route("/admin/market-intel/purchases/new", "Card Show + Card Shop Purchase"),
  route("/admin/market-intel/purchases/ebay-intake", "eBay Purchase Inbox"),
  route("/admin/market-intel/ingestion", "Ingestion Health"),
  route("/admin/market-intel/reports", "Intelligence Report Desk"),
  route("/admin/market-intel/delivery", "Email Delivery Center"),
  route("/admin/market-intel/delivery/test", "Send a controlled test email"),
  route("/admin/order-review-cases", "Order Review Case Queue"),
  route("/admin/payment-simulations", "Payment Simulation Lab"),
  route("/admin/seller-payouts", "Seller Payout Review"),
  route("/admin/shipping", "Label + Coverage Control"),
  route("/admin/shipping/simulations", "Shipping Simulation Lab"),
];

const redBoxFragments = [
  "Build Error",
  "Runtime Error",
  "Unhandled Runtime Error",
  "Internal Server Error",
  "Next.js can't recognize",
  "Module not found",
  "Failed to compile",
];

const authBoundaryChecks = [
  {
    label: "unauthenticated admin page redirects to login",
    path: "/admin/products",
    expectedStatus: "redirect",
    expectedLocationFragment: "/admin/login?next=%2Fadmin%2Fproducts",
  },
  {
    label: "unauthenticated admin API returns JSON 401",
    path: "/api/admin/ebay-duplicates",
    expectedStatus: 401,
    expectedText: "Unauthorized",
  },
];

const authenticatedApiChecks = [
  { path: "/api/admin/ebay-duplicates", expectedText: '"success":true' },
  { path: "/api/admin/ebay-inventory-intake", expectedText: '"success":true' },
  { path: "/api/admin/launch-readiness", expectedText: '"success":true' },
  { path: "/api/admin/launch-gate-drill", expectedText: '"success":true' },
  { path: "/api/admin/live-payment-launch", expectedText: '"success":true' },
  { path: "/api/admin/live-shipping-launch", expectedText: '"success":true' },
  { path: "/api/admin/shipping/provider-setup", expectedText: '"exports":' },
];

let serverProcess = null;
let serverOutput = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function appendServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk}`;
  if (serverOutput.length > 12_000) serverOutput = serverOutput.slice(-12_000);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function serverIsReachable() {
  try {
    const response = await fetchWithTimeout(`${origin}/admin/login`, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function startDevServer() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  serverProcess = spawn(
    npmCommand,
    ["run", "dev:isolated", "--", "--hostname", "127.0.0.1", "--port", String(port), "--webpack"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProcess.stdout.on("data", (chunk) => appendServerOutput(String(chunk)));
  serverProcess.stderr.on("data", (chunk) => appendServerOutput(String(chunk)));
}

async function ensureServer() {
  if (await serverIsReachable()) return "reused";
  if (existingOnly) {
    throw new Error(`No existing Next dev server responded at ${origin}. Start npm run dev:isolated first, or rerun without --existing.`);
  }
  startDevServer();
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Next dev server exited before admin smoke could start.\n${serverOutput}`);
    }
    if (await serverIsReachable()) return "started";
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Next dev server at ${origin}.\n${serverOutput}`);
}

function setCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookieHeaderFromSetCookies(cookies) {
  return cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

async function adminCookieHeader() {
  const response = await fetchWithTimeout(`${origin}/api/admin/login`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ password: "", localDevelopmentLogin: "1", next: "/admin" }),
  });
  if (response.status !== 303) {
    const body = await response.text().catch(() => "");
    throw new Error(`Local admin smoke login expected HTTP 303, received ${response.status}. ${body.slice(0, 240)}`);
  }
  const cookieHeader = cookieHeaderFromSetCookies(setCookieHeaders(response.headers));
  if (!cookieHeader.includes("tcos_admin_auth_v3=")) {
    throw new Error("Local admin smoke login did not return an admin session cookie.");
  }
  return cookieHeader;
}

async function smokeRoute(check, cookieHeader) {
  const response = await fetchWithTimeout(`${origin}${check.path}`, {
    redirect: "manual",
    headers: check.auth ? { cookie: cookieHeader } : undefined,
  });
  const location = response.headers.get("location") || "";
  const body = await response.text().catch(() => "");
  const failures = [];
  if (response.status !== 200) failures.push(`HTTP ${response.status}`);
  if (check.auth && response.status >= 300 && response.status < 400) {
    failures.push(`unexpected redirect to ${location || "unknown location"}`);
  }
  const expectedTexts = check.expectedTexts || [check.expectedText].filter(Boolean);
  if (expectedTexts.length && !expectedTexts.some((text) => body.includes(text))) {
    failures.push(`missing expected text ${expectedTexts.map((text) => JSON.stringify(text)).join(" or ")}`);
  }
  const redBoxFragment = redBoxFragments.find((fragment) => body.includes(fragment));
  if (redBoxFragment) failures.push(`rendered error fragment ${JSON.stringify(redBoxFragment)}`);
  return { ...check, status: response.status, ok: failures.length === 0, failures };
}

async function smokeFirstDetail(listPath, pattern, expectedText, cookieHeader) {
  const response = await fetchWithTimeout(`${origin}${listPath}`, {
    redirect: "manual",
    headers: { cookie: cookieHeader },
  });
  const body = await response.text().catch(() => "");
  if (response.status !== 200) {
    return { path: `${listPath}/[first]`, status: response.status, ok: false, failures: ["could not load list for detail-route discovery"] };
  }
  const match = body.match(pattern);
  if (!match) return null;
  return smokeRoute({ path: match[1].replaceAll("&amp;", "&"), auth: true, expectedText }, cookieHeader);
}

async function smokeAuthBoundary(check) {
  const response = await fetchWithTimeout(`${origin}${check.path}`, { redirect: "manual" });
  const location = response.headers.get("location") || "";
  const contentType = response.headers.get("content-type") || "";
  const cacheControl = response.headers.get("cache-control") || "";
  const body = await response.text().catch(() => "");
  const failures = [];
  if (check.expectedStatus === "redirect") {
    if (response.status < 300 || response.status >= 400) failures.push(`expected redirect, received HTTP ${response.status}`);
    if (check.expectedLocationFragment && !location.includes(check.expectedLocationFragment)) {
      failures.push(`redirect location ${JSON.stringify(location || "missing")} did not include ${JSON.stringify(check.expectedLocationFragment)}`);
    }
  } else if (response.status !== check.expectedStatus) {
    failures.push(`expected HTTP ${check.expectedStatus}, received HTTP ${response.status}`);
  }
  if (check.expectedText && !body.includes(check.expectedText)) failures.push(`missing expected text ${JSON.stringify(check.expectedText)}`);
  if (check.path.startsWith("/api/") && !contentType.includes("application/json")) failures.push(`expected JSON response, received ${contentType || "missing content-type"}`);
  if (!cacheControl.includes("no-store")) failures.push("missing no-store cache header");
  return { ...check, status: response.status, location, ok: failures.length === 0, failures };
}

async function smokeAuthenticatedApi(check, cookieHeader) {
  const response = await fetchWithTimeout(`${origin}${check.path}`, {
    redirect: "manual",
    headers: { cookie: cookieHeader },
  });
  const location = response.headers.get("location") || "";
  const contentType = response.headers.get("content-type") || "";
  const cacheControl = response.headers.get("cache-control") || "";
  const body = await response.text().catch(() => "");
  const failures = [];
  if (response.status !== 200) failures.push(`HTTP ${response.status}`);
  if (response.status >= 300 && response.status < 400) failures.push(`unexpected redirect to ${location || "unknown location"}`);
  if (!contentType.includes("application/json")) failures.push(`expected JSON response, received ${contentType || "missing content-type"}`);
  if (!cacheControl.includes("no-store")) failures.push("missing no-store cache header");
  if (check.expectedText && !body.includes(check.expectedText)) failures.push(`missing expected text ${JSON.stringify(check.expectedText)}`);
  const redBoxFragment = redBoxFragments.find((fragment) => body.includes(fragment));
  if (redBoxFragment) failures.push(`rendered error fragment ${JSON.stringify(redBoxFragment)}`);
  return { ...check, status: response.status, ok: failures.length === 0, failures };
}

try {
  const serverMode = await ensureServer();
  const authBoundaryResults = [];
  for (const check of authBoundaryChecks) authBoundaryResults.push(await smokeAuthBoundary(check));

  const cookieHeader = await adminCookieHeader();
  const apiResults = [];
  const results = [];
  for (const check of authenticatedApiChecks) apiResults.push(await smokeAuthenticatedApi(check, cookieHeader));

  const productDetailResult = await smokeFirstDetail(
    "/admin/products",
    /href="(\/admin\/products\/\d+(?:\?[^\"]*)?)"/,
    "Product command desk",
    cookieHeader,
  );
  if (productDetailResult) results.push(productDetailResult);

  const orderDetailResult = await smokeFirstDetail(
    "/admin/orders",
    /href="(\/admin\/orders\/\d+(?:\?[^\"]*)?)"/,
    "Order command desk",
    cookieHeader,
  );
  if (orderDetailResult) results.push(orderDetailResult);

  for (const check of smokeRoutes) results.push(await smokeRoute(check, cookieHeader));

  for (const result of authBoundaryResults) {
    const detail = result.failures.length ? ` - ${result.failures.join("; ")}` : "";
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label} HTTP ${result.status}${result.location ? ` -> ${result.location}` : ""}${detail}`);
  }
  for (const result of apiResults) {
    const detail = result.failures.length ? ` - ${result.failures.join("; ")}` : "";
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.path} API HTTP ${result.status}${detail}`);
  }
  for (const result of results) {
    const detail = result.failures.length ? ` - ${result.failures.join("; ")}` : "";
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.path} HTTP ${result.status}${detail}`);
  }

  const allResults = [...authBoundaryResults, ...apiResults, ...results];
  const failed = allResults.filter((result) => !result.ok);
  console.log(`Admin runtime smoke (${serverMode} dev server): ${allResults.length - failed.length}/${allResults.length} passed.`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (serverProcess) serverProcess.kill("SIGTERM");
}
