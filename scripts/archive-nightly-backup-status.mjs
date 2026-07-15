import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "nightly-backup-status");
const commandText = "npm --silent run status:nightly-backup:json";

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
      `Could not parse status:nightly-backup:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.nightlyBackupStatus.v1") missing.push("schema");
  if (!payload?.checkedAt) missing.push("checkedAt");
  if (!payload?.backupDir) missing.push("backupDir");
  if (!payload?.scheduleHealth?.state) missing.push("scheduleHealth.state");
  if (!payload?.scheduleHealth?.message) missing.push("scheduleHealth.message");
  if (!payload?.scheduleHealth || !("latestBackupAt" in payload.scheduleHealth)) {
    missing.push("scheduleHealth.latestBackupAt");
  }
  if (payload?.retention?.keep !== 7) missing.push("retention.keep");
  if (typeof payload?.retention?.overRetentionCount !== "number") {
    missing.push("retention.overRetentionCount");
  }
  if (!payload?.launchAgent?.label) missing.push("launchAgent.label");
  if (typeof payload?.launchAgent?.installed !== "boolean") {
    missing.push("launchAgent.installed");
  }
  if (!payload?.launchAgent?.path) missing.push("launchAgent.path");
  if (typeof payload?.backups?.exists !== "boolean") missing.push("backups.exists");
  if (typeof payload?.backups?.count !== "number") missing.push("backups.count");
  if (!Array.isArray(payload?.backups?.files)) missing.push("backups.files");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");
  if (!payload?.readOnlyGuarantee?.includes("creates no archive")) {
    missing.push("readOnlyGuarantee.createsNoArchive");
  }
  if (!payload?.readOnlyGuarantee?.includes("starts no Git push")) {
    missing.push("readOnlyGuarantee.noGitPush");
  }

  if (missing.length) {
    throw new Error(
      `Nightly backup status JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "status:nightly-backup:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-nightly-backup-status.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Nightly backup status evidence archived:");
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
console.log(`- backup folder: ${payload.backupDir}`);
console.log(`- backup folder exists: ${payload.backups.exists ? "yes" : "no"}`);
console.log(`- dated backup count: ${payload.backups.count}`);
console.log(`- over-retention count: ${payload.retention.overRetentionCount}`);
console.log(`- schedule health: ${payload.scheduleHealth.state}`);
console.log(`- schedule message: ${payload.scheduleHealth.message}`);
console.log(`- LaunchAgent installed: ${payload.launchAgent.installed ? "yes" : "no"}`);
console.log(`- LaunchAgent schedule: ${payload.launchAgent.schedule || "unknown"}`);
console.log(`- read-only guarantee: ${payload.readOnlyGuarantee}`);

if (stderr) console.error(stderr);

process.exitCode = result.status || 0;
