import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "go-live-runway");
const commandText = "npm --silent run status:go-live:json";

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
      `Could not parse status:go-live:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.goLiveRunwayStatus.v1") missing.push("schema");
  if (!payload?.generatedAt) missing.push("generatedAt");
  if (typeof payload?.ok !== "boolean") missing.push("ok");
  if (!payload?.git?.head) missing.push("git.head");
  if (!payload?.git?.originMain) missing.push("git.originMain");
  if (typeof payload?.git?.workingTreeClean !== "boolean") {
    missing.push("git.workingTreeClean");
  }
  if (!Array.isArray(payload?.git?.workingTreeChanges)) {
    missing.push("git.workingTreeChanges");
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
  if (!Array.isArray(payload?.goLiveReadiness?.blockers)) {
    missing.push("goLiveReadiness.blockers");
  }
  if (!Array.isArray(payload?.goLiveReadiness?.watchItems)) {
    missing.push("goLiveReadiness.watchItems");
  }
  if (!payload?.goLiveReadiness?.nextOperatorStep) {
    missing.push("goLiveReadiness.nextOperatorStep");
  }
  if (!payload?.goLiveReadiness?.nextActionableStep) {
    missing.push("goLiveReadiness.nextActionableStep");
  }
  if (!payload?.goLiveReadiness?.nextDeployStep) {
    missing.push("goLiveReadiness.nextDeployStep");
  }
  if (!payload?.productionDeploymentQuota?.state) {
    missing.push("productionDeploymentQuota.state");
  }
  if (!payload?.productionDeploymentQuota?.uploadStarted) {
    missing.push("productionDeploymentQuota.uploadStarted");
  }
  if (!payload?.productionDeploySafety?.cleanProductionDomain) {
    missing.push("productionDeploySafety.cleanProductionDomain");
  }
  if (!payload?.productionDeploySafety?.unwantedAlias) {
    missing.push("productionDeploySafety.unwantedAlias");
  }
  if (!payload?.productionDeploySafety?.launchCommand) {
    missing.push("productionDeploySafety.launchCommand");
  }
  if (!payload?.productionDeploySafety?.smokeCommand) {
    missing.push("productionDeploySafety.smokeCommand");
  }
  if (!Array.isArray(payload?.productionDeploySafety?.protectedSequence)) {
    missing.push("productionDeploySafety.protectedSequence");
  }
  if (!payload?.emergencyBackup?.scheduleHealth?.state) {
    missing.push("emergencyBackup.scheduleHealth.state");
  }
  if (!payload?.emergencyBackup?.schedulerProof?.state) {
    missing.push("emergencyBackup.schedulerProof.state");
  }
  if (!payload?.emergencyBackup?.freshness?.latestBackupAt) {
    missing.push("emergencyBackup.freshness.latestBackupAt");
  }
  if (typeof payload?.emergencyBackup?.freshness?.latestBackupAgeMinutes !== "number") {
    missing.push("emergencyBackup.freshness.latestBackupAgeMinutes");
  }
  if (typeof payload?.emergencyBackup?.freshness?.currentForLastScheduledRun !== "boolean") {
    missing.push("emergencyBackup.freshness.currentForLastScheduledRun");
  }
  if (typeof payload?.emergencyBackup?.retention?.keep !== "number") {
    missing.push("emergencyBackup.retention.keep");
  }
  if (typeof payload?.emergencyBackup?.retention?.overRetentionCount !== "number") {
    missing.push("emergencyBackup.retention.overRetentionCount");
  }
  if (typeof payload?.emergencyBackup?.verification?.ok !== "boolean") {
    missing.push("emergencyBackup.verification.ok");
  }
  if (!payload?.emergencyBackup?.verification?.archivePath) {
    missing.push("emergencyBackup.verification.archivePath");
  }
  if (!payload?.liveMoney?.state) missing.push("liveMoney.state");
  if (typeof payload?.liveMoney?.readyForRuntimeSwitch !== "boolean") {
    missing.push("liveMoney.readyForRuntimeSwitch");
  }
  if (!Array.isArray(payload?.liveMoney?.missingBootstrapEnvironment)) {
    missing.push("liveMoney.missingBootstrapEnvironment");
  }
  if (!Array.isArray(payload?.safeNextCommands)) missing.push("safeNextCommands");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");

  if (missing.length) {
    throw new Error(
      `Go-live runway JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "status:go-live:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-go-live-runway.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Go-live runway evidence archived:");
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
console.log(`- go-live readiness: ${payload.goLiveReadiness.state}`);
console.log(`- go-live blocker count: ${payload.goLiveReadiness.blockerCount}`);
console.log(`- go-live watch item count: ${payload.goLiveReadiness.watchItemCount}`);
console.log(`- go-live next actionable step: ${payload.goLiveReadiness.nextActionableStep}`);
console.log(`- go-live next deploy step: ${payload.goLiveReadiness.nextDeployStep}`);
console.log(`- go-live next operator step: ${payload.goLiveReadiness.nextOperatorStep}`);
console.log(`- quota state: ${payload.productionDeploymentQuota.state}`);
console.log(`- quota retry at or after: ${payload.productionDeploymentQuota.retryAt}`);
console.log(`- Vercel upload started: ${payload.productionDeploymentQuota.uploadStarted}`);
console.log(`- clean production domain: ${payload.productionDeploySafety.cleanProductionDomain}`);
console.log(`- unwanted production alias: ${payload.productionDeploySafety.unwantedAlias}`);
console.log(`- launch command when quota opens: ${payload.productionDeploySafety.launchCommand}`);
console.log(`- smoke command: ${payload.productionDeploySafety.smokeCommand}`);
console.log(`- emergency backup schedule health: ${payload.emergencyBackup.scheduleHealth.state}`);
console.log(`- emergency backup scheduler proof: ${payload.emergencyBackup.schedulerProof.state}`);
console.log(`- emergency backup latest at: ${payload.emergencyBackup.freshness.latestBackupAt}`);
console.log(`- emergency backup latest age: ${payload.emergencyBackup.freshness.latestBackupAgeApprox}`);
console.log(
  `- emergency backup current for last scheduled run: ${
    payload.emergencyBackup.freshness.currentForLastScheduledRun ? "yes" : "no"
  }`,
);
console.log(`- emergency backup retention keep: ${payload.emergencyBackup.retention.keep}`);
console.log(`- emergency backup over-retention count: ${payload.emergencyBackup.retention.overRetentionCount}`);
console.log(`- emergency backup verification ok: ${payload.emergencyBackup.verification.ok ? "yes" : "no"}`);
console.log(`- live-money state: ${payload.liveMoney.state}`);
console.log(
  `- ready for runtime switch: ${
    payload.liveMoney.readyForRuntimeSwitch ? "yes" : "no"
  }`,
);
console.log(
  `- missing bootstrap environment: ${
    payload.liveMoney.missingBootstrapEnvironment.length
      ? payload.liveMoney.missingBootstrapEnvironment.join(", ")
      : "none detected"
  }`,
);
console.log(`- read-only guarantee: ${payload.readOnlyGuarantee}`);

if (stderr) console.error(stderr);

process.exitCode = result.status || 0;
