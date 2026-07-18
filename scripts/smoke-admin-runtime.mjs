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
    path: "/admin/ebay/duplicates",
    auth: true,
    expectedText: "Duplicate cleanup queue",
  },
  {
    path: "/admin/production-smoke",
    auth: true,
    expectedText: "Production smoke",
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

  if (response.status >= 500) {
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

try {
  const serverMode = await ensureServer();
  const cookieHeader = await adminCookieHeader();
  const results = [];

  for (const route of smokeRoutes) {
    results.push(await smokeRoute(route, cookieHeader));
  }

  for (const result of results) {
    const prefix = result.ok ? "PASS" : "FAIL";
    const detail = result.failures.length
      ? ` - ${result.failures.join("; ")}`
      : "";

    console.log(`${prefix} ${result.path} HTTP ${result.status}${detail}`);
  }

  const failed = results.filter((result) => !result.ok);

  console.log(
    `Admin runtime smoke (${serverMode} dev server): ${results.length - failed.length}/${results.length} passed.`,
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
