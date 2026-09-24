#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  const sample = [
    'The local configuration differs from the remote configuration:',
    '  -    SHIPSTATION_API_KEY: "do-not-print-this"',
    '  -    SOME_TOKEN: "also-do-not-print-this"',
    'Current Version ID: 11111111-2222-3333-4444-555555555555',
  ].join("\n");

  const secretLike = /(?:api[_-]?key|token|secret|password|credential|authorization)/i;
  if (!secretLike.test(sample)) {
    throw new Error("Wrangler output containment self-test did not recognize secret-bearing output.");
  }

  console.log("Wrangler deploy output containment self-test passed; raw child output remains non-streamed.");
  process.exit(0);
}

const configIndex = args.indexOf("--config");
const labelIndex = args.indexOf("--label");
const config = configIndex >= 0 ? args[configIndex + 1] : "";
const label = labelIndex >= 0 ? args[labelIndex + 1] : "Cloudflare Worker";

if (!config) {
  console.error("Usage: node scripts/run-wrangler-deploy-redacted.mjs --config <wrangler-config> [--label <label>]");
  process.exit(2);
}

async function cloudflareJson(url, options = {}) {
  const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!token) throw new Error("Cloudflare API token is unavailable.");
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success !== true) {
    throw new Error(`Cloudflare route API request failed with HTTP ${response.status}.`);
  }
  return data.result;
}

async function ensureProductionRoutes(configPath) {
  if (!/wrangler\.production-route\.jsonc$/.test(configPath)) return;
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (!accountId) throw new Error("Cloudflare account ID is unavailable.");

  const deployment = JSON.parse(readFileSync(configPath, "utf8"));
  const worker = String(deployment.name || "").trim();
  const desired = (Array.isArray(deployment.routes) ? deployment.routes : [])
    .map((route) => ({
      pattern: String(route?.pattern || "").trim(),
      zoneName: String(route?.zone_name || "").trim(),
    }))
    .filter((route) => route.pattern && route.zoneName);
  if (!worker || desired.length === 0) {
    throw new Error("Production Worker route configuration is incomplete.");
  }

  const zoneName = desired[0].zoneName;
  let zoneId = "";
  try {
    const zones = await cloudflareJson(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
    );
    zoneId = String(Array.isArray(zones) ? zones[0]?.id || "" : "").trim();
  } catch {
    zoneId = "";
  }

  if (!zoneId) {
    const domains = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`;
    const probe = await cloudflareJson(domains, {
      method: "PUT",
      body: JSON.stringify({
        hostname: `route-probe-${Date.now()}.${zoneName}`,
        service: worker,
        zone_name: zoneName,
      }),
    });
    zoneId = String(probe?.zone_id || "").trim();
    const probeId = String(probe?.id || "").trim();
    if (probeId) {
      await cloudflareJson(`${domains}/${encodeURIComponent(probeId)}`, {
        method: "DELETE",
      });
    }
  }
  if (!zoneId) throw new Error("Cloudflare production zone could not be resolved.");

  const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`;
  let routes = await cloudflareJson(base);
  routes = Array.isArray(routes) ? routes : [];
  for (const route of desired) {
    const existing = routes.find((candidate) => candidate?.pattern === route.pattern);
    await cloudflareJson(existing?.id ? `${base}/${existing.id}` : base, {
      method: existing?.id ? "PUT" : "POST",
      body: JSON.stringify({ pattern: route.pattern, script: worker }),
    });
  }

  const verified = await cloudflareJson(base);
  for (const route of desired) {
    const active = Array.isArray(verified)
      ? verified.find((candidate) => candidate?.pattern === route.pattern)
      : null;
    if (!active || String(active.script || "") !== worker) {
      throw new Error(`Cloudflare production route is not active: ${route.pattern}`);
    }
  }
  console.log(
    `Cloudflare production routes verified for ${worker}: ${desired.map((route) => route.pattern).join(", ")}`,
  );
}

const result = spawnSync(
  "npx",
  ["--no-install", "wrangler", "deploy", "--config", config, "--keep-vars"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (result.error) {
  console.error(`${label} deployment process could not start: ${result.error.message}`);
  process.exit(1);
}

const combinedOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
const versionMatch = combinedOutput.match(/^Current Version ID:\s+([A-Za-z0-9-]+)\s*$/m);

if (result.status !== 0) {
  console.error(
    `${label} deployment failed with exit code ${result.status ?? "unknown"}. ` +
      "Raw Wrangler stdout/stderr was intentionally withheld because Wrangler can print remote Worker variable values in configuration diffs.",
  );
  process.exit(result.status || 1);
}

try {
  await ensureProductionRoutes(config);
} catch (error) {
  console.error(
    `${label} route enforcement failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

console.log(
  `${label} deployment succeeded. Raw Wrangler stdout/stderr was intentionally withheld to prevent remote Worker variable disclosure.`,
);
if (versionMatch?.[1]) {
  console.log(`Cloudflare deployment version: ${versionMatch[1]}`);
}
