#!/usr/bin/env node

import { spawnSync } from "node:child_process";

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

console.log(
  `${label} deployment succeeded. Raw Wrangler stdout/stderr was intentionally withheld to prevent remote Worker variable disclosure.`,
);
if (versionMatch?.[1]) {
  console.log(`Cloudflare deployment version: ${versionMatch[1]}`);
}
