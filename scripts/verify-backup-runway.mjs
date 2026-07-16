import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const schema = "tcos.backupRunwayVerification.v1";
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "backup-runway");

function readOption(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function runLocalGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function listBackupRunwayArchives() {
  if (!existsSync(evidenceDir)) return [];

  return readdirSync(evidenceDir)
    .filter((name) => name.endsWith("-backup-runway.json"))
    .map((name) => {
      const filePath = join(evidenceDir, name);
      const stat = statSync(filePath);
      return {
        name,
        filePath,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function selectArchive() {
  const explicitArchive = readOption("--archive");
  if (explicitArchive) {
    return {
      selectedBy: "--archive",
      archivePath: resolve(explicitArchive),
      knownArchives: listBackupRunwayArchives(),
    };
  }

  const archives = listBackupRunwayArchives();
  return {
    selectedBy: "newest",
    archivePath: archives[0]?.filePath || null,
    knownArchives: archives,
  };
}

function check(condition, name, detail = null) {
  return {
    name,
    ok: Boolean(condition),
    detail,
  };
}

const gitStatusShort = runLocalGit(["status", "--short"]);
const currentHead = runLocalGit(["rev-parse", "--short", "HEAD"]) || "unknown";
const currentOriginMain = runLocalGit(["rev-parse", "--short", "origin/main"]) || "unknown";
const selected = selectArchive();
const archivePath = selected.archivePath;
const checks = [
  check(gitStatusShort === "", "current working tree is clean", gitStatusShort || null),
  check(
    currentHead === currentOriginMain,
    "current HEAD matches origin/main",
    `${currentHead} / ${currentOriginMain}`,
  ),
  check(Boolean(archivePath), "backup runway archive selected"),
  check(Boolean(archivePath && existsSync(archivePath)), "backup runway archive exists", archivePath),
];

let payload = null;
let parseError = null;
if (archivePath && existsSync(archivePath)) {
  try {
    payload = JSON.parse(readFileSync(archivePath, "utf8"));
    checks.push(check(true, "backup runway JSON parses"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    checks.push(check(false, "backup runway JSON parses", parseError));
  }
}

if (payload) {
  checks.push(check(payload.schema === "tcos.backupRunwayStatus.v1", "backup runway schema"));
  checks.push(check(Boolean(payload.generatedAt), "backup runway generatedAt"));
  checks.push(check(payload.git?.workingTreeClean === true, "backup runway git payload is clean"));
  checks.push(check(payload.git?.head === currentHead, "backup runway git head matches current HEAD", payload.git?.head));
  checks.push(
    check(
      payload.git?.originMain === currentOriginMain,
      "backup runway origin/main matches current origin/main",
      payload.git?.originMain,
    ),
  );
  checks.push(check(payload.archive?.gitWorkingTreeClean === true, "archive metadata captured a clean tree"));
  checks.push(check(payload.archive?.gitHead === currentHead, "archive metadata git head matches current HEAD", payload.archive?.gitHead));
  checks.push(
    check(
      payload.archive?.gitOriginMain === currentOriginMain,
      "archive metadata origin/main matches current origin/main",
      payload.archive?.gitOriginMain,
    ),
  );
  checks.push(
    check(
      payload.archive?.gitHead === payload.archive?.gitOriginMain,
      "archive metadata was captured at pushed HEAD",
      `${payload.archive?.gitHead || "unknown"} / ${payload.archive?.gitOriginMain || "unknown"}`,
    ),
  );
  checks.push(
    check(
      payload.archive?.command === "npm --silent run status:backup-runway:json",
      "archive source command matches",
      payload.archive?.command,
    ),
  );
  checks.push(check(payload.acceptedBackupPosture === true, "backup runway accepted posture"));
  checks.push(check(payload.backupStatus?.schema === "tcos.nightlyBackupStatus.v1", "backup status schema"));
  checks.push(check(payload.backupVerification?.schema === "tcos.nightlyEmergencyBackupVerification.v1", "backup verification schema"));
  checks.push(check(payload.backupStatus?.scheduleHealth?.state === "current", "backup schedule health is current"));
  checks.push(
    check(
      Boolean(payload.backupStatus?.scheduleHealth?.latestBackupAt),
      "backup status records latest backup timestamp",
      payload.backupStatus?.scheduleHealth?.latestBackupAt || null,
    ),
  );
  checks.push(check(payload.backupStatus?.retention?.keep === 7, "backup retention keep count is seven"));
  checks.push(check(payload.backupStatus?.retention?.overRetentionCount === 0, "backup over-retention count is zero"));
  checks.push(check(payload.backupVerification?.ok === true, "backup verification ok"));
  checks.push(check(payload.backupVerification?.failedCheckCount === 0, "backup verification has no failed checks"));
  checks.push(check(Boolean(payload.backupVerification?.archivePath), "backup verification records archive path"));
  checks.push(check(Boolean(payload.backupVerification?.computedSha256), "backup verification records computed SHA-256"));
  checks.push(
    check(
      payload.checks?.automaticRunProven === true ||
        payload.checks?.manualCurrentPendingAutomatic === true ||
        payload.checks?.manualCurrentAfterAutomaticFailure === true,
      "backup scheduler proof is accepted, explicitly pending automatic proof, or manually current after automatic failure",
      payload.schedulerProofMode || null,
    ),
  );
  checks.push(
    check(
      payload.safeBuildBoundary?.includes("does not approve live money") &&
        payload.safeBuildBoundary?.includes("buy postage") &&
        payload.safeBuildBoundary?.includes("create Checkout") &&
        payload.safeBuildBoundary?.includes("start production deploys"),
      "safe backup boundary preserves no-money/no-postage/no-deploy limits",
      payload.safeBuildBoundary || null,
    ),
  );
  checks.push(
    check(
      payload.readOnlyGuarantee?.includes("backup creation") &&
        payload.readOnlyGuarantee?.includes("Git push") &&
        payload.readOnlyGuarantee?.includes("Checkout") &&
        payload.readOnlyGuarantee?.includes("postage") &&
        payload.readOnlyGuarantee?.includes("payout"),
      "backup runway read-only guarantee preserves side-effect limits",
      payload.readOnlyGuarantee || null,
    ),
  );
}

const failedChecks = checks.filter((item) => !item.ok);
const verification = {
  schema,
  checkedAt: new Date().toISOString(),
  evidenceDir,
  selectedBy: selected.selectedBy,
  archivePath,
  archiveCount: selected.knownArchives.length,
  latestKnownArchive: selected.knownArchives[0] || null,
  git: {
    head: currentHead,
    originMain: currentOriginMain,
    workingTreeClean: gitStatusShort === "",
    statusShort: gitStatusShort ? gitStatusShort.split("\n") : [],
  },
  runway: payload
    ? {
        schema: payload.schema || null,
        generatedAt: payload.generatedAt || null,
        acceptedBackupPosture: payload.acceptedBackupPosture ?? null,
        operatorWatchRequired: payload.operatorWatchRequired ?? null,
        schedulerProofMode: payload.schedulerProofMode || null,
        scheduleHealth: payload.backupStatus?.scheduleHealth?.state || null,
        latestBackupAtLocal: payload.backupStatus?.scheduleHealth?.latestBackupAtLocal || null,
        nextScheduledRunAtLocal:
          payload.backupStatus?.scheduleHealth?.nextScheduledRunAtLocal || null,
        verificationOk: payload.backupVerification?.ok ?? null,
        verifiedArchive: payload.backupVerification?.archivePath || null,
        computedSha256: payload.backupVerification?.computedSha256 || null,
        next: payload.next || null,
      }
    : null,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads Git state and the latest backup runway archive; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, revocation, or backup creation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(verification, null, 2));
} else {
  console.log("TCOS backup runway verification:");
  console.log(`- evidence folder: ${evidenceDir}`);
  console.log(`- selected by: ${verification.selectedBy}`);
  console.log(`- archive: ${archivePath || "none"}`);
  console.log(`- archive count: ${verification.archiveCount}`);
  console.log(`- git HEAD: ${verification.git.head}`);
  console.log(`- git origin/main: ${verification.git.originMain}`);
  console.log(`- git working tree clean: ${verification.git.workingTreeClean ? "yes" : "no"}`);
  console.log(`- accepted backup posture: ${verification.runway?.acceptedBackupPosture ? "yes" : "no"}`);
  console.log(`- scheduler proof mode: ${verification.runway?.schedulerProofMode || "not recorded"}`);
  console.log(`- operator watch required: ${verification.runway?.operatorWatchRequired ? "yes" : "no"}`);
  console.log(`- schedule health: ${verification.runway?.scheduleHealth || "not recorded"}`);
  console.log(`- latest backup local: ${verification.runway?.latestBackupAtLocal || "not recorded"}`);
  console.log(`- verification ok: ${verification.runway?.verificationOk ? "yes" : "no"}`);
  console.log(`- ok: ${verification.ok ? "yes" : "no"}`);
  console.log(`- failed checks: ${verification.failedCheckCount}`);
  for (const item of failedChecks) {
    console.log(`  - ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
  }
  console.log("");
  console.log(`Read-only guarantee: ${verification.readOnlyGuarantee}`);
}

if (!verification.ok) {
  process.exitCode = 1;
}
