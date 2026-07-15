import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function runGit(args) {
  const result = run("git", args);
  if (result.status !== 0) return "unknown";
  return (result.stdout || "").trim();
}

function parseLine(output, label) {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`- ${label}:`));
  return line ? line.replace(new RegExp(`^\\s*- ${label}:\\s*`), "").trim() : "unknown";
}

function quotaStatus() {
  const result = run("node", ["scripts/deploy-production.mjs", "--quota-status"]);
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    ok: result.status === 0,
    state: parseLine(output, "state"),
    canRetry: parseLine(output, "deployment retry allowed by local cooldown"),
    reason: parseLine(output, "reason"),
    retryAt: parseLine(output, "retry at or after"),
    approximateRemaining: parseLine(output, "approximate remaining"),
    uploadStarted: parseLine(output, "Vercel upload started"),
    next: parseLine(output, "next"),
  };
}

function liveMoneyStatus() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = run(npm, ["--silent", "run", "status:live-money:json"]);
  const stdout = (result.stdout || "").trim();

  try {
    const payload = JSON.parse(stdout);
    return {
      ok: result.status === 0,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      payload: {
        state: "BLOCKED_UNEVALUATED",
        readyForRuntimeSwitch: false,
        detail: `Could not parse live-money JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        next: "Run npm run status:live-money directly.",
      },
    };
  }
}

function printStatusItems(title, items = []) {
  if (!items.length) return;
  console.log(`${title}:`);
  for (const item of items) {
    console.log(`- ${item.label}: ${item.status}`);
  }
}

function main() {
  const gitStatusShort = runGit(["status", "--short"]);
  const gitHead = runGit(["rev-parse", "--short", "HEAD"]);
  const gitOriginMain = runGit(["rev-parse", "--short", "origin/main"]);
  const quota = quotaStatus();
  const liveMoney = liveMoneyStatus();
  const payload = liveMoney.payload;

  console.log("TCOS go-live runway status:");
  console.log(`- git HEAD: ${gitHead || "unknown"}`);
  console.log(`- git origin/main: ${gitOriginMain || "unknown"}`);
  console.log(`- git working tree clean: ${gitStatusShort === "" ? "yes" : "no"}`);
  if (gitStatusShort) {
    console.log("Git working tree changes:");
    for (const line of gitStatusShort.split("\n")) {
      console.log(`- ${line}`);
    }
  }

  console.log("");
  console.log("Production deployment quota:");
  console.log(`- state: ${quota.state}`);
  console.log(`- retry allowed by local cooldown: ${quota.canRetry}`);
  console.log(`- reason: ${quota.reason}`);
  console.log(`- retry at or after: ${quota.retryAt}`);
  console.log(`- approximate remaining: ${quota.approximateRemaining}`);
  console.log(`- Vercel upload started: ${quota.uploadStarted}`);
  console.log(`- next: ${quota.next}`);

  console.log("");
  console.log("Live money:");
  console.log(`- state: ${payload.state || "unknown"}`);
  console.log(`- ready for runtime switch: ${payload.readyForRuntimeSwitch ? "yes" : "no"}`);
  console.log(`- detail: ${payload.detail || "unknown"}`);
  console.log(`- next: ${payload.next || "unknown"}`);
  console.log(
    `- missing bootstrap environment: ${
      Array.isArray(payload.missingEnvironmentVariables) &&
      payload.missingEnvironmentVariables.length
        ? payload.missingEnvironmentVariables.join(", ")
        : "none detected"
    }`,
  );

  printStatusItems(
    "Local Supabase bootstrap status",
    payload.localEnvironmentStatus?.supabaseBootstrap,
  );
  printStatusItems(
    "Local final live-payment runtime status",
    payload.localEnvironmentStatus?.finalLivePaymentRuntime,
  );

  console.log("");
  console.log("Safe next commands:");
  console.log("- npm run status:production");
  console.log("- npm run status:live-money");
  console.log("- npm run live-money:env-packet");
  console.log("- npm run live-money:vercel-commands");
  console.log("- npm run archive:live-money");
  console.log("");
  console.log(
    "Read-only guarantee: This command only reads Git state, local quota status, and live-money JSON evidence; it starts no deploy, upload, Checkout, postage, payout, launch approval, or revocation.",
  );

  if (!quota.ok || !liveMoney.ok) {
    process.exitCode = 1;
  }
}

main();
