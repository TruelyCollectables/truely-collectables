import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "backup-runway");
const commandText = "npm --silent run status:backup-runway:json";
const statusJsonMaxBuffer = 64 * 1024 * 1024;

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
      `Could not parse status:backup-runway:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.backupRunwayStatus.v1") missing.push("schema");
  if (!payload?.generatedAt) missing.push("generatedAt");
  if (!payload?.git?.head) missing.push("git.head");
  if (!payload?.git?.originMain) missing.push("git.originMain");
  if (typeof payload?.git?.workingTreeClean !== "boolean") {
    missing.push("git.workingTreeClean");
  }
  if (typeof payload?.acceptedBackupPosture !== "boolean") {
    missing.push("acceptedBackupPosture");
  }
  if (typeof payload?.operatorWatchRequired !== "boolean") {
    missing.push("operatorWatchRequired");
  }
  if (!payload?.schedulerProofMode) missing.push("schedulerProofMode");
  if (payload?.backupStatus?.schema !== "tcos.nightlyBackupStatus.v1") {
    missing.push("backupStatus.schema");
  }
  if (!payload?.backupStatus?.scheduleHealth?.state) {
    missing.push("backupStatus.scheduleHealth.state");
  }
  if (!payload?.backupStatus?.schedulerProof?.state) {
    missing.push("backupStatus.schedulerProof.state");
  }
  if (payload?.backupStatus?.retention?.keep !== 7) {
    missing.push("backupStatus.retention.keep");
  }
  if (typeof payload?.backupStatus?.retention?.overRetentionCount !== "number") {
    missing.push("backupStatus.retention.overRetentionCount");
  }
  if (payload?.backupVerification?.schema !== "tcos.nightlyEmergencyBackupVerification.v1") {
    missing.push("backupVerification.schema");
  }
  if (typeof payload?.backupVerification?.ok !== "boolean") {
    missing.push("backupVerification.ok");
  }
  if (!payload?.backupVerification?.archivePath) {
    missing.push("backupVerification.archivePath");
  }
  if (!payload?.backupVerification?.computedSha256) {
    missing.push("backupVerification.computedSha256");
  }
  if (!payload?.checks) missing.push("checks");
  if (!payload?.next) missing.push("next");
  if (!payload?.safeBuildBoundary) missing.push("safeBuildBoundary");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");
  if (!payload?.readOnlyGuarantee?.includes("backup creation")) {
    missing.push("readOnlyGuarantee.noBackupCreation");
  }

  if (missing.length) {
    throw new Error(
      `Backup runway JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "status:backup-runway:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-backup-runway.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Backup runway evidence archived:");
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
console.log(`- accepted backup posture: ${payload.acceptedBackupPosture ? "yes" : "no"}`);
console.log(`- scheduler proof mode: ${payload.schedulerProofMode}`);
console.log(`- operator watch required: ${payload.operatorWatchRequired ? "yes" : "no"}`);
console.log(`- schedule health: ${payload.backupStatus.scheduleHealth.state}`);
console.log(`- verification ok: ${payload.backupVerification.ok ? "yes" : "no"}`);
console.log(`- verified archive: ${payload.backupVerification.archivePath}`);
console.log(`- computed sha256: ${payload.backupVerification.computedSha256}`);
console.log(`- next: ${payload.next}`);
console.log(
  "- read-only source guarantee: status:backup-runway only reads Git state and backup evidence JSON; this archive helper only writes the timestamped backup runway evidence file.",
);

if (stderr) console.error(stderr);
