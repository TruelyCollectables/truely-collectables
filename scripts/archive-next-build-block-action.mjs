import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "next-build-block-action");
const commandText = "npm --silent run next:build-block:json";

function runLocalGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : null;
}

function archiveMetadata(archivedAt) {
  const gitStatusShort = runLocalGit(["status", "--short"]);
  return {
    archivedAt,
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
      `Could not parse next:build-block:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.nextBuildBlockAction.v1") missing.push("schema");
  if (!payload?.generatedAt) missing.push("generatedAt");
  if (payload?.sourceSchema !== "tcos.buildBlockCheckpoint.v1") {
    missing.push("sourceSchema");
  }
  if (!payload?.selectedLane) missing.push("selectedLane");
  if (!payload?.selectedReason) missing.push("selectedReason");
  if (!payload?.next) missing.push("next");
  if (!Array.isArray(payload?.commands)) missing.push("commands");
  if (!payload?.primaryRecommendation?.focus) {
    missing.push("primaryRecommendation.focus");
  }
  if (!payload?.primaryRecommendation?.next) {
    missing.push("primaryRecommendation.next");
  }
  if (!Array.isArray(payload?.primaryRecommendation?.commands)) {
    missing.push("primaryRecommendation.commands");
  }
  if (typeof payload?.localBuildFallback?.available !== "boolean") {
    missing.push("localBuildFallback.available");
  }
  if (!payload?.localBuildFallback?.reason) {
    missing.push("localBuildFallback.reason");
  }
  if (!payload?.git?.head) missing.push("git.head");
  if (!payload?.git?.originMain) missing.push("git.originMain");
  if (typeof payload?.git?.workingTreeClean !== "boolean") {
    missing.push("git.workingTreeClean");
  }
  if (!payload?.goLiveReadiness?.state) {
    missing.push("goLiveReadiness.state");
  }
  if (!payload?.productionDeploymentQuota?.state) {
    missing.push("productionDeploymentQuota.state");
  }
  if (!("vercelUploadStarted" in (payload?.productionDeploymentQuota || {}))) {
    missing.push("productionDeploymentQuota.vercelUploadStarted");
  }
  if (!payload?.emergencyBackup?.schedulerProof) {
    missing.push("emergencyBackup.schedulerProof");
  }
  if (!payload?.liveMoney?.state) missing.push("liveMoney.state");
  if (!Array.isArray(payload?.liveMoney?.missingBootstrapEnvironment)) {
    missing.push("liveMoney.missingBootstrapEnvironment");
  }
  if (!payload?.safeBuildBoundary) missing.push("safeBuildBoundary");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");

  if (missing.length) {
    throw new Error(
      `Next build-block action JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "next:build-block:json",
], {
  cwd: repoRoot,
  encoding: "utf8",
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
  `${archivedAt.replace(/[:.]/g, "-")}-next-build-block-action.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Next build-block action evidence archived:");
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
console.log(`- selected lane: ${payload.selectedLane}`);
console.log(`- selected reason: ${payload.selectedReason}`);
console.log(`- next: ${payload.next}`);
if (payload.commands.length) {
  console.log(`- commands: ${payload.commands.join(" | ")}`);
}
console.log(`- primary focus: ${payload.primaryRecommendation.focus}`);
console.log(
  `- local build fallback available: ${
    payload.localBuildFallback.available ? "yes" : "no"
  }`,
);
console.log(`- go-live state: ${payload.goLiveReadiness.state}`);
console.log(`- quota state: ${payload.productionDeploymentQuota.state}`);
if (payload.productionDeploymentQuota.retryAtLocal) {
  console.log(`- quota retry at local: ${payload.productionDeploymentQuota.retryAtLocal}`);
}
console.log(
  `- Vercel upload started: ${
    payload.productionDeploymentQuota.vercelUploadStarted ? "yes" : "no"
  }`,
);
console.log(`- emergency backup scheduler proof: ${payload.emergencyBackup.schedulerProof}`);
console.log(`- live-money state: ${payload.liveMoney.state}`);
console.log(
  `- missing bootstrap environment: ${
    payload.liveMoney.missingBootstrapEnvironment.length
      ? payload.liveMoney.missingBootstrapEnvironment.join(", ")
      : "none detected"
  }`,
);
console.log(
  "- read-only source guarantee: next:build-block only reads status:build-block JSON; this archive helper only writes the timestamped next-action evidence file.",
);
