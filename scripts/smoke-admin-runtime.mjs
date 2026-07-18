import { spawn } from "node:child_process";

const args = new Set(process.argv.slice(2));
const existingOnly = args.has("--existing");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : 3000;
const origin = `http://127.0.0.1:${port}`;
const startupTimeoutMs = 45_000;
const requestTimeoutMs = 20_000;
const smokeRoutes = [
  {
    path: "/admin/login",
    auth: false,
    expectedText: "Admin password",
  },
  {
    path: "/admin",
    auth: true,
    expectedText: "Command Center",
  },
  {
    path: "/admin/instacomp-direct",
    auth: true,
    expectedText: "InstaComp™ Direct Scan Lab",
  },
  {
    path: "/admin/products",
    auth: true,
    expectedText: "Admin products",
  },
  {
    path: "/admin/products/new",
    auth: true,
    expectedText: "Add products",
  },
  {
    path: "/admin/orders",
    auth: true,
    expectedText: "Orders",
  },
  {
    path: "/admin/offers",
    auth: true,
    expectedText: "Offers",
  },
  {
    path: "/admin/ebay/inventory-intake",
    auth: true,
    expectedText: "eBay Inventory Intake",
  },
  {
    path: "/admin/ebay/duplicates",
    auth: true,
    expectedText: "Duplicate cleanup queue",
  },
  {
    path: "/admin/financial-reconciliation",
    auth: true,
    expectedText: "Stripe Reconciliation",
  },
  {
    path: "/admin/market-intel",
    auth: true,
    expectedText: "Market Intel",
  },
  {
    path: "/admin/production-smoke",
    auth: true,
    expectedText: "Production smoke",
  },
  {
    path: "/admin/live-payment-launch",
    auth: true,
    expectedText: "Live Payment",
  },
  {
    path: "/admin/live-shipping-launch",
    auth: true,
    expectedText: "Live Shipping",
  },
  {
    path: "/admin/settings",
    auth: true,
    expectedText: "Settings",
  },
  {
    path: "/admin/security",
    auth: true,
    expectedText: "Security",
  },
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
  {
    path: "/api/admin/ebay-duplicates",
    expectedText: "\"success\":true",
  },
  {
    path: "/api/admin/ebay-inventory-intake",
    expectedText: "\"success\":true",
  },
  {
    path: "/api/admin/launch-readiness",
    expectedText: "\"success\":true",
  },
  {
    path: "/api/admin/launch-gate-drill",
    expectedText: "\"success\":true",
  },
  {
    path: "/api/admin/live-payment-launch",
    expectedText: "\"success\":true",
  },
  {
    path: "/api/admin/live-shipping-launch",
    expectedText: "\"success\":true",
  },
  {
    path: "/api/admin/shipping/provider-setup",
    expectedText: "\"exports\":",
  },
];

let serverProcess = null;
let serverOutput = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk}`;
  if (serverOutput.length > 12_000) {
    serverOutput = serverOutput.slice(-12_000);
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function serverIsReachable() {
  try {
    const response = await fetchWithTimeout(`${origin}/admin/login`, {
      redirect: "manual",
    });

    return response.status < 500;
  } catch {
    return false;
  }
}

function startDevServer() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  serverProcess = spawn(
    npmCommand,
    [
      "run",
      "dev:isolated",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  serverProcess.stdout.on("data", (chunk) => appendServerOutput(String(chunk)));
  serverProcess.stderr.on("data", (chunk) => appendServerOutput(String(chunk)));
}

async function ensureServer() {
  if (await serverIsReachable()) {
    return "reused";
  }

  if (existingOnly) {
    throw new Error(
      `No existing Next dev server responded at ${origin}. Start npm run dev:isolated first, or rerun without --existing.`,
    );
  }

  startDevServer();

  const startedAt = Date.now();

  while (Date.now() - startedAt < startupTimeoutMs) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(
        `Next dev server exited before admin smoke could start.\n${serverOutput}`,
      );
    }

    if (await serverIsReachable()) {
      return "started";
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for Next dev server at ${origin}.\n${serverOutput}`,
  );
}

function setCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookieHeaderFromSetCookies(cookies) {
  return cookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function adminCookieHeader() {
  const response = await fetchWithTimeout(`${origin}/api/admin/login`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      password: "",
      localDevelopmentLogin: "1",
      next: "/admin",
    }),
  });

  if (response.status !== 303) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Local admin smoke login expected HTTP 303, received ${response.status}. ${body.slice(0, 240)}`,
    );
  }

  const cookieHeader = cookieHeaderFromSetCookies(setCookieHeaders(response.headers));

  if (!cookieHeader.includes("tcos_admin_auth_v3=")) {
    throw new Error("Local admin smoke login did not return an admin session cookie.");
  }

  return cookieHeader;
}

async function smokeRoute(route, cookieHeader) {
  const response = await fetchWithTimeout(`${origin}${route.path}`, {
    redirect: "manual",
    headers: route.auth ? { cookie: cookieHeader } : undefined,
  });
  const location = response.headers.get("location") || "";
  const body = await response.text().catch(() => "");
  const failures = [];

  if (response.status !== 200) {
    failures.push(`HTTP ${response.status}`);
  }

  if (route.auth && response.status >= 300 && response.status < 400) {
    failures.push(`unexpected redirect to ${location || "unknown location"}`);
  }

  if (route.expectedText && !body.includes(route.expectedText)) {
    failures.push(`missing expected text ${JSON.stringify(route.expectedText)}`);
  }

  const redBoxFragment = redBoxFragments.find((fragment) => body.includes(fragment));

  if (redBoxFragment) {
    failures.push(`rendered error fragment ${JSON.stringify(redBoxFragment)}`);
  }

  return {
    ...route,
    status: response.status,
    ok: failures.length === 0,
    failures,
  };
}

async function smokeAuthBoundary(check) {
  const response = await fetchWithTimeout(`${origin}${check.path}`, {
    redirect: "manual",
  });
  const location = response.headers.get("location") || "";
  const contentType = response.headers.get("content-type") || "";
  const cacheControl = response.headers.get("cache-control") || "";
  const body = await response.text().catch(() => "");
  const failures = [];

  if (check.expectedStatus === "redirect") {
    if (response.status < 300 || response.status >= 400) {
      failures.push(`expected redirect, received HTTP ${response.status}`);
    }

    if (
      check.expectedLocationFragment &&
      !location.includes(check.expectedLocationFragment)
    ) {
      failures.push(
        `redirect location ${JSON.stringify(location || "missing")} did not include ${JSON.stringify(
          check.expectedLocationFragment,
        )}`,
      );
    }
  } else if (response.status !== check.expectedStatus) {
    failures.push(`expected HTTP ${check.expectedStatus}, received HTTP ${response.status}`);
  }

  if (check.expectedText && !body.includes(check.expectedText)) {
    failures.push(`missing expected text ${JSON.stringify(check.expectedText)}`);
  }

  if (check.path.startsWith("/api/") && !contentType.includes("application/json")) {
    failures.push(`expected JSON response, received ${contentType || "missing content-type"}`);
  }

  if (!cacheControl.includes("no-store")) {
    failures.push("missing no-store cache header");
  }

  return {
    ...check,
    status: response.status,
    location,
    ok: failures.length === 0,
    failures,
  };
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

  if (response.status !== 200) {
    failures.push(`HTTP ${response.status}`);
  }

  if (response.status >= 300 && response.status < 400) {
    failures.push(`unexpected redirect to ${location || "unknown location"}`);
  }

  if (!contentType.includes("application/json")) {
    failures.push(`expected JSON response, received ${contentType || "missing content-type"}`);
  }

  if (!cacheControl.includes("no-store")) {
    failures.push("missing no-store cache header");
  }

  if (check.expectedText && !body.includes(check.expectedText)) {
    failures.push(`missing expected text ${JSON.stringify(check.expectedText)}`);
  }

  const redBoxFragment = redBoxFragments.find((fragment) => body.includes(fragment));

  if (redBoxFragment) {
    failures.push(`rendered error fragment ${JSON.stringify(redBoxFragment)}`);
  }

  return {
    ...check,
    status: response.status,
    ok: failures.length === 0,
    failures,
  };
}

try {
  const serverMode = await ensureServer();
  const authBoundaryResults = [];

  for (const check of authBoundaryChecks) {
    authBoundaryResults.push(await smokeAuthBoundary(check));
  }

  const cookieHeader = await adminCookieHeader();
  const apiResults = [];
  const results = [];

  for (const check of authenticatedApiChecks) {
    apiResults.push(await smokeAuthenticatedApi(check, cookieHeader));
  }

  for (const route of smokeRoutes) {
    results.push(await smokeRoute(route, cookieHeader));
  }

  for (const result of authBoundaryResults) {
    const prefix = result.ok ? "PASS" : "FAIL";
    const locationDetail = result.location ? ` -> ${result.location}` : "";
    const detail = result.failures.length
      ? ` - ${result.failures.join("; ")}`
      : "";

    console.log(`${prefix} ${result.label} HTTP ${result.status}${locationDetail}${detail}`);
  }

  for (const result of apiResults) {
    const prefix = result.ok ? "PASS" : "FAIL";
    const detail = result.failures.length
      ? ` - ${result.failures.join("; ")}`
      : "";

    console.log(`${prefix} ${result.path} API HTTP ${result.status}${detail}`);
  }

  for (const result of results) {
    const prefix = result.ok ? "PASS" : "FAIL";
    const detail = result.failures.length
      ? ` - ${result.failures.join("; ")}`
      : "";

    console.log(`${prefix} ${result.path} HTTP ${result.status}${detail}`);
  }

  const allResults = [...authBoundaryResults, ...apiResults, ...results];
  const failed = allResults.filter((result) => !result.ok);

  console.log(
    `Admin runtime smoke (${serverMode} dev server): ${allResults.length - failed.length}/${allResults.length} passed.`,
  );

  if (failed.length) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
}
