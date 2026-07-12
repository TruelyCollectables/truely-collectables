import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const baseUrl = (process.env.SMOKE_BASE_URL || "https://truely-collectables.vercel.app").replace(
  /\/$/,
  "",
);
const unwantedAliasUrl = (
  process.env.SMOKE_UNWANTED_ALIAS_URL ||
  "https://truely-collectables-tt3b.vercel.app"
).replace(/\/$/, "");

function optionalRun(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) return "";

  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function envValueFromLocalFile(key) {
  try {
    const raw = readFileSync(".env.local", "utf8");
    const line = raw
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));

    if (!line) return "";

    return line
      .replace(new RegExp(`^${key}\\s*=\\s*`), "")
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

const adminPassword =
  process.env.SMOKE_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  envValueFromLocalFile("ADMIN_PASSWORD");

if (!adminPassword) {
  console.error(
    "Missing admin password. Set SMOKE_ADMIN_PASSWORD or keep ADMIN_PASSWORD in .env.local.",
  );
  process.exit(1);
}

const localHead = optionalRun("git", ["rev-parse", "--short", "HEAD"]);
const remoteHead = optionalRun("git", ["rev-parse", "--short", "origin/main"]);

console.log(`Production smoke target: ${baseUrl}`);
console.log(`Local HEAD: ${localHead || "unknown"}`);
console.log(`origin/main: ${remoteHead || "unknown"}`);

function setCookieHeaderValue(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().join("; ");
  }

  return response.headers.get("set-cookie") || "";
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
  });
  const text = await response.text();

  return {
    path,
    status: response.status,
    ok: response.status >= 200 && response.status < 400,
    contentType: response.headers.get("content-type") || "",
    text,
    response,
  };
}

async function requestUrl(url, options = {}) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      ...options,
    });
    const text = await response.text();

    return {
      path: url,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      contentType: response.headers.get("content-type") || "",
      text,
      response,
      error: "",
    };
  } catch (error) {
    return {
      path: url,
      status: 0,
      ok: false,
      contentType: "",
      text: "",
      response: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function diagnosticSnippet(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

const login = await request("/api/admin/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: adminPassword }),
});
const cookie = setCookieHeaderValue(login.response);
const authHeaders = cookie ? { cookie } : {};

const checks = [
  {
    name: "admin dashboard",
    path: "/admin",
    expect: (result) => result.text.includes("Shipping Setup"),
  },
  {
    name: "launch readiness page",
    path: "/admin/launch-readiness",
    expect: (result) =>
      result.text.includes("Launch Readiness") &&
      result.text.includes("Production Deploy Queue") &&
      result.text.includes("npm run deploy:production") &&
      result.text.includes("npm run smoke:production") &&
      result.text.includes("truely-collectables.vercel.app") &&
      result.text.includes("tt3b"),
  },
  {
    name: "launch readiness json",
    path: "/api/admin/launch-readiness",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"brief"'),
  },
  {
    name: "launch readiness markdown",
    path: "/api/admin/launch-readiness?format=markdown",
    expect: (result) => result.text.includes("# TCOS Launch Readiness Brief"),
  },
  {
    name: "launch handoff bundle",
    path: "/api/admin/launch-readiness?format=handoff-bundle",
    expect: (result) => result.text.includes("# TCOS Launch Hand-off Bundle"),
  },
  {
    name: "live payment gate",
    path: "/admin/live-payment-launch",
    expect: (result) => result.text.includes("Live Payment Launch Gate"),
  },
  {
    name: "live shipping gate",
    path: "/admin/live-shipping-launch",
    expect: (result) => result.text.includes("Live Shipping Launch Gate"),
  },
  {
    name: "shipping provider setup json",
    path: "/api/admin/shipping/provider-setup",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"credentialGroups"') &&
      result.text.includes('"exports"'),
  },
  {
    name: "shipping provider env template",
    path: "/api/admin/shipping/provider-setup?format=env-template",
    expect: (result) =>
      result.text.includes("TCOS shipping provider setup template") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider vercel commands",
    path: "/api/admin/shipping/provider-setup?format=vercel-commands",
    expect: (result) =>
      result.text.includes("vercel env add") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider operator checklist",
    path: "/api/admin/shipping/provider-setup?format=operator-checklist",
    expect: (result) =>
      result.text.includes("# TCOS Shipping Provider Operator Checklist") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
];

const results = [
  {
    name: "admin login",
    path: "/api/admin/login",
    status: login.status,
    contentType: login.contentType,
    snippet: diagnosticSnippet(login.text),
    passed: login.ok && Boolean(cookie),
  },
];

for (const check of checks) {
  const result = await request(check.path, { headers: authHeaders });
  results.push({
    name: check.name,
    path: check.path,
    status: result.status,
    contentType: result.contentType,
    snippet: diagnosticSnippet(result.text),
    passed: result.ok && check.expect(result),
  });
}

const unwantedAlias = await requestUrl(unwantedAliasUrl);
results.push({
  name: "unwanted tt3b alias absent",
  path: unwantedAlias.path,
  status: unwantedAlias.status,
  contentType: unwantedAlias.contentType,
  snippet:
    diagnosticSnippet(unwantedAlias.text) ||
    unwantedAlias.error ||
    "alias did not return content",
  passed: !unwantedAlias.ok,
});

const failed = results.filter((result) => !result.passed);
const queuedFeatureFailures = failed.filter((result) =>
  [
    "launch handoff bundle",
    "launch readiness page",
    "shipping provider setup json",
    "shipping provider env template",
    "shipping provider vercel commands",
    "shipping provider operator checklist",
  ].includes(result.name),
);

console.table(results);

if (failed.length > 0) {
  console.error("Failed production smoke details:");
  console.table(
    failed.map((result) => ({
      name: result.name,
      path: result.path,
      status: result.status,
      contentType: result.contentType || "none",
      snippet: result.snippet || "empty response",
    })),
  );

  if (queuedFeatureFailures.length > 0) {
    console.error(
      "Queued launch features are not visible on production yet. If Vercel quota recently blocked deployment, rerun npm run deploy:production once quota resets, then rerun this smoke.",
    );
  }

  console.error(
    `Production smoke failed for ${failed.length} check(s): ${failed
      .map((result) => result.name)
      .join(", ")}`,
  );
  process.exit(1);
}

console.log(`Production smoke passed for ${baseUrl}.`);
