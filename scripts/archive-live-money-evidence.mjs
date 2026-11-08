import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "live-money-evidence");
const mode = process.argv.includes("--preflight") ? "preflight" : "status";
const scriptName =
  mode === "preflight" ? "preflight:live-money:json" : "status:live-money:json";
const commandText = `npm --silent run ${scriptName}`;
const statusJsonMaxBuffer = 64 * 1024 * 1024;

function runLocalGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || "").trim();
}

function archiveMetadata(archivedAt) {
  const gitStatusShort = runLocalGit(["status", "--short"]);
  return {
    archivedAt,
    mode,
    command: commandText,
    gitHead: runLocalGit(["rev-parse", "--short", "HEAD"]) || "unknown",
    gitOriginMain:
      runLocalGit(["rev-parse", "--short", "origin/main"]) || "unknown",
    gitWorkingTreeClean: gitStatusShort === "",
    gitStatusShort: gitStatusShort ? gitStatusShort.split("\n") : [],
  };
}

function parseEvidence(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Could not parse ${scriptName} output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.liveMoneyGoNoGo.v1") missing.push("schema");
  if (!payload?.state) missing.push("state");
  if (typeof payload?.readyForRuntimeSwitch !== "boolean") {
    missing.push("readyForRuntimeSwitch");
  }
  if (payload?.liveMoneyEvidence?.schema !== "tcos.liveMoneyGoNoGo.v1") {
    missing.push("liveMoneyEvidence.schema");
  }
  if (!payload?.liveMoneyEvidence?.statusCommand) {
    missing.push("liveMoneyEvidence.statusCommand");
  }
  if (!payload?.liveMoneyEvidence?.preflightCommand) {
    missing.push("liveMoneyEvidence.preflightCommand");
  }
  if (!Array.isArray(payload?.liveMoneyEvidence?.readyStates)) {
    missing.push("liveMoneyEvidence.readyStates");
  }
  if (!Array.isArray(payload?.liveMoneyEvidence?.blockedStates)) {
    missing.push("liveMoneyEvidence.blockedStates");
  }
  if (!Array.isArray(payload?.liveMoneyEvidence?.environmentChecklist?.supabaseBootstrap)) {
    missing.push("liveMoneyEvidence.environmentChecklist.supabaseBootstrap");
  }
  if (
    !Array.isArray(
      payload?.liveMoneyEvidence?.environmentChecklist?.finalLivePaymentRuntime,
    )
  ) {
    missing.push("liveMoneyEvidence.environmentChecklist.finalLivePaymentRuntime");
  }
  if (!Array.isArray(payload?.localEnvironmentStatus?.supabaseBootstrap)) {
    missing.push("localEnvironmentStatus.supabaseBootstrap");
  }
  if (!Array.isArray(payload?.localEnvironmentStatus?.finalLivePaymentRuntime)) {
    missing.push("localEnvironmentStatus.finalLivePaymentRuntime");
  }
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");

  if (missing.length) {
    throw new Error(
      `Live-money evidence JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  scriptName,
], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: statusJsonMaxBuffer,
});

const stdout = (result.stdout || "").trim();
const stderr = (result.stderr || "").trim();

if (!stdout) {
  if (stderr) console.error(stderr);
  console.error(`No JSON evidence was produced by ${commandText}.`);
  process.exit(result.status || 1);
}

let payload;
try {
  payload = parseEvidence(stdout);
  assertEvidenceContract(payload);
} catch (error) {
  if (stderr) console.error(stderr);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(result.status || 1);
}

mkdirSync(evidenceDir, { recursive: true });
const archivedAt = new Date().toISOString();
const filePath = join(
  evidenceDir,
  `${archivedAt.replace(/[:.]/g, "-")}-${mode}.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Live money evidence archived:");
console.log(`- mode: ${mode}`);
console.log(`- command: ${commandText}`);
console.log(`- path: ${filePath}`);
console.log(`- archived at: ${archivedPayload.archive.archivedAt}`);
console.log(`- git HEAD: ${archivedPayload.archive.gitHead}`);
console.log(`- git origin/main: ${archivedPayload.archive.gitOriginMain}`);
console.log(
  `- git working tree clean: ${
    archivedPayload.archive.gitWorkingTreeClean ? "yes" : "no"
  }`,
);
console.log(`- state: ${payload.state}`);
console.log(
  `- ready for runtime switch: ${payload.readyForRuntimeSwitch ? "yes" : "no"}`,
);
console.log(
  `- missing bootstrap environment: ${
    Array.isArray(payload.missingEnvironmentVariables) &&
    payload.missingEnvironmentVariables.length
      ? payload.missingEnvironmentVariables.join(", ")
      : "none detected"
  }`,
);
console.log(
  `- Supabase bootstrap environment: ${payload.liveMoneyEvidence.environmentChecklist.supabaseBootstrap.join("; ")}`,
);
console.log(
  `- final live-payment runtime environment: ${payload.liveMoneyEvidence.environmentChecklist.finalLivePaymentRuntime.join("; ")}`,
);
console.log(
  `- local Supabase bootstrap status: ${payload.localEnvironmentStatus.supabaseBootstrap
    .map((item) => `${item.label}: ${item.status}`)
    .join("; ")}`,
);
console.log(
  `- local final live-payment runtime status: ${payload.localEnvironmentStatus.finalLivePaymentRuntime
    .map((item) => `${item.label}: ${item.status}`)
    .join("; ")}`,
);
console.log(`- read-only guarantee: ${payload.readOnlyGuarantee}`);

if (stderr) console.error(stderr);

process.exitCode = result.status || 0;
