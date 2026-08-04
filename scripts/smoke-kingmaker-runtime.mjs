import { spawn } from "node:child_process";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : 3017;
const origin = `http://127.0.0.1:${port}`;
const requestTimeoutMs = 20_000;
const startupTimeoutMs = 60_000;
const routes = [
  {
    path: "/admin",
    expectedTexts: ["Project KINGMAKER Beta 1.0"],
  },
  {
    path: "/admin/market-intel/kingmaker",
    expectedTexts: ["Project KINGMAKER Beta 1.0", "Capital Intelligence Command", "Operating Doctrine"],
  },
  {
    path: "/admin/market-intel/kingmaker/capital-ledger",
    expectedTexts: ["Purchase Ledger Command", "Capital Deployed", "Canonical Positions"],
  },
];
const errorFragments = [
  "Build Error",
  "Runtime Error",
  "Unhandled Runtime Error",
  "Internal Server Error",
  "Module not found",
  "Failed to compile",
];
let server = null;
let serverOutput = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function reachable() {
  try {
    const response = await fetchWithTimeout(`${origin}/admin/login`, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function startServer() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  server = spawn(
    npmCommand,
    ["run", "dev:isolated", "--", "--hostname", "127.0.0.1", "--port", String(port), "--webpack"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  const append = (chunk) => {
    serverOutput += String(chunk);
    if (serverOutput.length > 16_000) serverOutput = serverOutput.slice(-16_000);
  };
  server.stdout.on("data", append);
  server.stderr.on("data", append);

  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`KINGMAKER smoke server exited early.\n${serverOutput}`);
    }
    if (await reachable()) return;
    await sleep(500);
  }
  throw new Error(`KINGMAKER smoke server timed out.\n${serverOutput}`);
}

function cookieHeader(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function login() {
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
    throw new Error(`KINGMAKER smoke login expected 303, received ${response.status}.\n${serverOutput}`);
  }
  const cookie = cookieHeader(response.headers);
  if (!cookie.includes("tcos_admin_auth_v3=")) {
    throw new Error("KINGMAKER smoke login did not return an admin session cookie.");
  }
  return cookie;
}

async function smokeRoute(route, cookie) {
  const response = await fetchWithTimeout(`${origin}${route.path}`, {
    redirect: "manual",
    headers: { cookie },
  });
  const body = await response.text().catch(() => "");
  const failures = [];
  if (response.status !== 200) failures.push(`HTTP ${response.status}`);
  for (const expectedText of route.expectedTexts) {
    if (!body.includes(expectedText)) failures.push(`missing ${JSON.stringify(expectedText)}`);
  }
  const errorFragment = errorFragments.find((fragment) => body.includes(fragment));
  if (errorFragment) failures.push(`rendered ${JSON.stringify(errorFragment)}`);
  return { ...route, status: response.status, failures, ok: failures.length === 0 };
}

try {
  await startServer();
  const cookie = await login();
  const results = [];
  for (const route of routes) results.push(await smokeRoute(route, cookie));
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.path} HTTP ${result.status}${result.failures.length ? ` - ${result.failures.join("; ")}` : ""}`);
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`KINGMAKER runtime smoke: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (server) {
    try {
      if (process.platform === "win32" || !server.pid) server.kill("SIGTERM");
      else process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGKILL");
    }
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      sleep(5_000),
    ]);
  }
}
