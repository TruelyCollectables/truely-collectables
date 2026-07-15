import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "nightly-backup-verification");
const commandText = "npm --silent run verify:nightly-backup:json";

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
      `Could not parse verify:nightly-backup:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.nightlyEmergencyBackupVerification.v1") {
    missing.push("schema");
  }
  if (!payload?.checkedAt) missing.push("checkedAt");
  if (!payload?.backupDir) missing.push("backupDir");
  if (!payload?.archivePath) missing.push("archivePath");
  if (!payload?.manifestPath) missing.push("manifestPath");
  if (!payload?.sha256Path) missing.push("sha256Path");
  if (!payload?.computedSha256) missing.push("computedSha256");
  if (!payload?.sha256FromFile) missing.push("sha256FromFile");
  if (!payload?.manifestSha256) missing.push("manifestSha256");
  if (typeof payload?.ok !== "boolean") missing.push("ok");
  if (typeof payload?.failedCheckCount !== "number") {
    missing.push("failedCheckCount");
  }
  if (!Array.isArray(payload?.checks)) missing.push("checks");
  if (!Array.isArray(payload?.failedChecks)) missing.push("failedChecks");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");
  if (!payload?.readOnlyGuarantee?.includes("creates no archive")) {
    missing.push("readOnlyGuarantee.createsNoArchive");
  }
  if (!payload?.readOnlyGuarantee?.includes("starts no Git push")) {
    missing.push("readOnlyGuarantee.noGitPush");
  }

  const requiredCheckNames = [
    "archive sha256 matches .sha256 file",
    "archive sha256 matches manifest",
    "archive contains .git/HEAD",
    "archive contains package.json",
    "archive excludes node_modules",
    "archive excludes .codex-run",
  ];
  const checkNames = new Set(Array.isArray(payload?.checks) ? payload.checks.map((item) => item.name) : []);
  for (const checkName of requiredCheckNames) {
    if (!checkNames.has(checkName)) {
      missing.push(`checks.${checkName}`);
    }
  }

  if (missing.length) {
    throw new Error(
      `Nightly backup verification JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "verify:nightly-backup:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-nightly-backup-verification.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Nightly backup verification evidence archived:");
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
console.log(`- archive: ${payload.archivePath}`);
console.log(`- archive count: ${payload.archiveCount}`);
console.log(`- verification ok: ${payload.ok ? "yes" : "no"}`);
console.log(`- failed checks: ${payload.failedCheckCount}`);
console.log(`- computed sha256: ${payload.computedSha256 || "not computed"}`);
console.log(`- read-only guarantee: ${payload.readOnlyGuarantee}`);

if (stderr) console.error(stderr);

process.exitCode = result.status || 0;
