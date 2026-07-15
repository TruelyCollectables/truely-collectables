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
  const jsonResult = run("node", [
    "scripts/deploy-production.mjs",
    "--quota-status",
    "--json",
  ]);
  const jsonStdout = (jsonResult.stdout || "").trim();

  try {
    const payload = JSON.parse(jsonStdout);
    return {
      ok: jsonResult.status === 0,
      schema: payload.schema || "unknown",
      generatedAt: payload.generatedAt || "unknown",
      state: payload.state || "unknown",
      canRetry: payload.canRetry ? "yes" : "no",
      retryAllowedByLocalCooldown: Boolean(payload.canRetry),
      reason: payload.reason || "unknown",
      blockedAt: payload.blockedAt || null,
      retryAt: payload.retryAt || "unknown",
      approximateRemaining: payload.remaining || "none",
      marker: payload.marker || "unknown",
      uploadStarted: payload.vercelUploadStarted ? "yes" : "no",
      vercelUploadStarted: Boolean(payload.vercelUploadStarted),
      next: payload.next || "unknown",
      readOnlyGuarantee: payload.readOnlyGuarantee || "unknown",
      raw: payload,
    };
  } catch {
    // Fall back to the human status for older helper output or unexpected JSON errors.
  }

  const result = run("node", ["scripts/deploy-production.mjs", "--quota-status"]);
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    ok: result.status === 0,
    schema: "unknown",
    generatedAt: "unknown",
    state: parseLine(output, "state"),
    canRetry: parseLine(output, "deployment retry allowed by local cooldown"),
    retryAllowedByLocalCooldown:
      parseLine(output, "deployment retry allowed by local cooldown") === "yes",
    reason: parseLine(output, "reason"),
    blockedAt: parseLine(output, "blocked at"),
    retryAt: parseLine(output, "retry at or after"),
    approximateRemaining: parseLine(output, "approximate remaining"),
    marker: parseLine(output, "marker"),
    uploadStarted: parseLine(output, "Vercel upload started"),
    vercelUploadStarted: parseLine(output, "Vercel upload started") === "yes",
    next: parseLine(output, "next"),
    readOnlyGuarantee: "unknown",
    raw: null,
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

function statusItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    label: item.label,
    status: item.status,
  }));
}

function printStatusItems(title, items = []) {
  if (!items.length) return;
  console.log(`${title}:`);
  for (const item of items) {
    console.log(`- ${item.label}: ${item.status}`);
  }
}

function buildStatus() {
  const gitStatusShort = runGit(["status", "--short"]);
  const gitHead = runGit(["rev-parse", "--short", "HEAD"]);
  const gitOriginMain = runGit(["rev-parse", "--short", "origin/main"]);
  const quota = quotaStatus();
  const liveMoney = liveMoneyStatus();
  const payload = liveMoney.payload;
  const readOnlyGuarantee =
    "This command only reads Git state, local quota status, and live-money JSON evidence; it starts no deploy, upload, Checkout, postage, payout, launch approval, or revocation.";
  const safeNextCommands = [
    "npm run status:production",
    "npm --silent run status:production:json",
    "npm run status:live-money",
    "npm run live-money:env-packet",
    "npm run live-money:vercel-commands",
    "npm run archive:go-live-runway",
    "npm run archive:live-money",
  ];

  return {
    schema: "tcos.goLiveRunwayStatus.v1",
    generatedAt: new Date().toISOString(),
    ok: quota.ok && liveMoney.ok,
    git: {
      head: gitHead || "unknown",
      originMain: gitOriginMain || "unknown",
      workingTreeClean: gitStatusShort === "",
      workingTreeChanges: gitStatusShort ? gitStatusShort.split("\n") : [],
    },
    productionDeploymentQuota: quota,
    liveMoney: {
      ok: liveMoney.ok,
      state: payload.state || "unknown",
      readyForRuntimeSwitch: Boolean(payload.readyForRuntimeSwitch),
      detail: payload.detail || "unknown",
      next: payload.next || "unknown",
      missingBootstrapEnvironment:
        Array.isArray(payload.missingEnvironmentVariables) &&
        payload.missingEnvironmentVariables.length
          ? payload.missingEnvironmentVariables
          : [],
      localEnvironmentStatus: {
        supabaseBootstrap: statusItems(
          payload.localEnvironmentStatus?.supabaseBootstrap,
        ),
        finalLivePaymentRuntime: statusItems(
          payload.localEnvironmentStatus?.finalLivePaymentRuntime,
        ),
      },
      evidence: payload.liveMoneyEvidence || null,
      raw: payload,
    },
    safeNextCommands,
    readOnlyGuarantee,
  };
}

function printText(status) {
  const payload = status.liveMoney;

  console.log("TCOS go-live runway status:");
  console.log(`- git HEAD: ${status.git.head}`);
  console.log(`- git origin/main: ${status.git.originMain}`);
  console.log(`- git working tree clean: ${status.git.workingTreeClean ? "yes" : "no"}`);
  if (status.git.workingTreeChanges.length) {
    console.log("Git working tree changes:");
    for (const line of status.git.workingTreeChanges) {
      console.log(`- ${line}`);
    }
  }

  console.log("");
  console.log("Production deployment quota:");
  console.log(`- state: ${status.productionDeploymentQuota.state}`);
  console.log(
    `- retry allowed by local cooldown: ${status.productionDeploymentQuota.canRetry}`,
  );
  console.log(`- reason: ${status.productionDeploymentQuota.reason}`);
  console.log(`- retry at or after: ${status.productionDeploymentQuota.retryAt}`);
  console.log(`- approximate remaining: ${status.productionDeploymentQuota.approximateRemaining}`);
  console.log(`- Vercel upload started: ${status.productionDeploymentQuota.uploadStarted}`);
  console.log(`- next: ${status.productionDeploymentQuota.next}`);

  console.log("");
  console.log("Live money:");
  console.log(`- state: ${payload.state}`);
  console.log(`- ready for runtime switch: ${payload.readyForRuntimeSwitch ? "yes" : "no"}`);
  console.log(`- detail: ${payload.detail}`);
  console.log(`- next: ${payload.next}`);
  console.log(
    `- missing bootstrap environment: ${
      payload.missingBootstrapEnvironment.length
        ? payload.missingBootstrapEnvironment.join(", ")
        : "none detected"
    }`,
  );

  printStatusItems(
    "Local Supabase bootstrap status",
    payload.localEnvironmentStatus.supabaseBootstrap,
  );
  printStatusItems(
    "Local final live-payment runtime status",
    payload.localEnvironmentStatus.finalLivePaymentRuntime,
  );

  console.log("");
  console.log("Safe next commands:");
  for (const command of status.safeNextCommands) {
    console.log(`- ${command}`);
  }
  console.log("");
  console.log(`Read-only guarantee: ${status.readOnlyGuarantee}`);
}

function main() {
  const json = process.argv.includes("--json");
  const status = buildStatus();

  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printText(status);
  }

  if (!status.ok) {
    process.exitCode = 1;
  }
}

main();
