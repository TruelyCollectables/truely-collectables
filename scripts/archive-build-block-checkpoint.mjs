import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "build-block-checkpoint");
const commandText = "npm --silent run status:build-block:json";
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
      `Could not parse status:build-block:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.buildBlockCheckpoint.v1") missing.push("schema");
  if (!payload?.generatedAt) missing.push("generatedAt");
  if (payload?.sourceSchema !== "tcos.goLiveRunwayStatus.v1") {
    missing.push("sourceSchema");
  }
  if (!payload?.git?.head) missing.push("git.head");
  if (!payload?.git?.originMain) missing.push("git.originMain");
  if (typeof payload?.git?.workingTreeClean !== "boolean") {
    missing.push("git.workingTreeClean");
  }
  if (!payload?.goLiveReadiness?.state) {
    missing.push("goLiveReadiness.state");
  }
  if (typeof payload?.goLiveReadiness?.blockerCount !== "number") {
    missing.push("goLiveReadiness.blockerCount");
  }
  if (typeof payload?.goLiveReadiness?.watchItemCount !== "number") {
    missing.push("goLiveReadiness.watchItemCount");
  }
  if (!payload?.goLiveReadiness?.nextActionableStep) {
    missing.push("goLiveReadiness.nextActionableStep");
  }
  if (!payload?.goLiveReadiness?.nextDeployStep) {
    missing.push("goLiveReadiness.nextDeployStep");
  }
  if (!payload?.goLiveReadiness?.nextOperatorStep) {
    missing.push("goLiveReadiness.nextOperatorStep");
  }
  if (typeof payload?.goLiveEvidence?.available !== "boolean") {
    missing.push("goLiveEvidence.available");
  }
  if (typeof payload?.goLiveEvidence?.ok !== "boolean") {
    missing.push("goLiveEvidence.ok");
  }
  if (typeof payload?.goLiveEvidence?.capturedAtCurrentHead !== "boolean") {
    missing.push("goLiveEvidence.capturedAtCurrentHead");
  }
  if (!payload?.goLiveEvidence?.next) {
    missing.push("goLiveEvidence.next");
  }
  if (!payload?.recommendation?.focus) missing.push("recommendation.focus");
  if (!payload?.recommendation?.next) missing.push("recommendation.next");
  if (!Array.isArray(payload?.recommendation?.commands)) {
    missing.push("recommendation.commands");
  }
  if (typeof payload?.localBuildFallback?.available !== "boolean") {
    missing.push("localBuildFallback.available");
  }
  if (!payload?.localBuildFallback?.reason) {
    missing.push("localBuildFallback.reason");
  }
  if (!payload?.localBuildFallback?.next) {
    missing.push("localBuildFallback.next");
  }
  if (!Array.isArray(payload?.localBuildFallback?.commands)) {
    missing.push("localBuildFallback.commands");
  }
  if (!payload?.productionDeploymentQuota?.state) {
    missing.push("productionDeploymentQuota.state");
  }
  if (!payload?.productionDeploymentQuota?.reason) {
    missing.push("productionDeploymentQuota.reason");
  }
  if (!payload?.productionDeploymentQuota?.approximateRemaining) {
    missing.push("productionDeploymentQuota.approximateRemaining");
  }
  if (!("vercelUploadStarted" in (payload?.productionDeploymentQuota || {}))) {
    missing.push("productionDeploymentQuota.vercelUploadStarted");
  }
  if (!payload?.emergencyBackup?.scheduleHealth) {
    missing.push("emergencyBackup.scheduleHealth");
  }
  if (!payload?.emergencyBackup?.schedulerProof) {
    missing.push("emergencyBackup.schedulerProof");
  }
  if (typeof payload?.emergencyBackup?.verificationOk !== "boolean") {
    missing.push("emergencyBackup.verificationOk");
  }
  if (typeof payload?.emergencyBackup?.overRetentionCount !== "number") {
    missing.push("emergencyBackup.overRetentionCount");
  }
  if (typeof payload?.backupRunway?.available !== "boolean") {
    missing.push("backupRunway.available");
  }
  if (payload?.backupRunway?.schema !== "tcos.backupRunwayStatus.v1") {
    missing.push("backupRunway.schema");
  }
  if (typeof payload?.backupRunway?.acceptedBackupPosture !== "boolean") {
    missing.push("backupRunway.acceptedBackupPosture");
  }
  if (!payload?.backupRunway?.schedulerProofMode) {
    missing.push("backupRunway.schedulerProofMode");
  }
  if (typeof payload?.backupRunway?.operatorWatchRequired !== "boolean") {
    missing.push("backupRunway.operatorWatchRequired");
  }
  if (!payload?.backupRunway?.nextScheduledRunAtLocal) {
    missing.push("backupRunway.nextScheduledRunAtLocal");
  }
  if (!payload?.backupRunway?.verifiedArchive) {
    missing.push("backupRunway.verifiedArchive");
  }
  if (!payload?.backupRunway?.computedSha256) {
    missing.push("backupRunway.computedSha256");
  }
  if (!payload?.backupRunway?.next) {
    missing.push("backupRunway.next");
  }
  if (!payload?.liveMoney?.state) missing.push("liveMoney.state");
  if (typeof payload?.liveMoney?.readyForRuntimeSwitch !== "boolean") {
    missing.push("liveMoney.readyForRuntimeSwitch");
  }
  if (!Array.isArray(payload?.liveMoney?.missingBootstrapEnvironment)) {
    missing.push("liveMoney.missingBootstrapEnvironment");
  }
  if (!payload?.safeBuildBoundary) missing.push("safeBuildBoundary");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");

  if (missing.length) {
    throw new Error(
      `Build-block checkpoint JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "status:build-block:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-build-block-checkpoint.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Build-block checkpoint evidence archived:");
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
console.log(`- go-live state: ${payload.goLiveReadiness.state}`);
console.log(`- blocker count: ${payload.goLiveReadiness.blockerCount}`);
console.log(`- watch item count: ${payload.goLiveReadiness.watchItemCount}`);
console.log(
  `- go-live evidence available: ${payload.goLiveEvidence.available ? "yes" : "no"}`,
);
console.log(`- go-live evidence ok: ${payload.goLiveEvidence.ok ? "yes" : "no"}`);
console.log(
  `- go-live evidence current pushed HEAD: ${
    payload.goLiveEvidence.capturedAtCurrentHead ? "yes" : "no"
  }`,
);
console.log(`- go-live evidence next: ${payload.goLiveEvidence.next}`);
console.log(`- block focus: ${payload.recommendation.focus}`);
console.log(`- next: ${payload.recommendation.next}`);
if (payload.recommendation.commands.length) {
  console.log(`- commands: ${payload.recommendation.commands.join(" | ")}`);
}
console.log(
  `- local build fallback available: ${
    payload.localBuildFallback.available ? "yes" : "no"
  }`,
);
console.log(`- local build fallback next: ${payload.localBuildFallback.next}`);
if (payload.localBuildFallback.commands.length) {
  console.log(`- local build fallback commands: ${payload.localBuildFallback.commands.join(" | ")}`);
}
console.log(`- quota state: ${payload.productionDeploymentQuota.state}`);
if (payload.productionDeploymentQuota.retryAtLocal) {
  console.log(`- quota retry at local: ${payload.productionDeploymentQuota.retryAtLocal}`);
}
console.log(
  `- quota approximate remaining: ${
    payload.productionDeploymentQuota.approximateRemaining || "unknown"
  }`,
);
console.log(
  `- Vercel upload started: ${
    payload.productionDeploymentQuota.vercelUploadStarted ? "yes" : "no"
  }`,
);
console.log(`- emergency backup schedule health: ${payload.emergencyBackup.scheduleHealth}`);
console.log(`- emergency backup scheduler proof: ${payload.emergencyBackup.schedulerProof}`);
console.log(
  `- emergency backup verification ok: ${
    payload.emergencyBackup.verificationOk ? "yes" : "no"
  }`,
);
console.log(
  `- backup runway accepted posture: ${
    payload.backupRunway.acceptedBackupPosture ? "yes" : "no"
  }`,
);
console.log(`- backup runway scheduler proof mode: ${payload.backupRunway.schedulerProofMode}`);
console.log(
  `- backup runway operator watch required: ${
    payload.backupRunway.operatorWatchRequired ? "yes" : "no"
  }`,
);
console.log(
  `- backup runway next scheduled local: ${payload.backupRunway.nextScheduledRunAtLocal}`,
);
console.log(`- backup runway verified archive: ${payload.backupRunway.verifiedArchive}`);
console.log(`- backup runway computed sha256: ${payload.backupRunway.computedSha256}`);
console.log(`- live-money state: ${payload.liveMoney.state}`);
console.log(
  `- missing bootstrap environment: ${
    payload.liveMoney.missingBootstrapEnvironment.length
      ? payload.liveMoney.missingBootstrapEnvironment.join(", ")
      : "none detected"
  }`,
);
console.log(
  "- read-only source guarantee: status:build-block only reads status:go-live JSON and backup-runway JSON; this archive helper only writes the timestamped checkpoint file.",
);
