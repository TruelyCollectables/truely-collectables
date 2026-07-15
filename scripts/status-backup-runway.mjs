import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const jsonOutput = process.argv.includes("--json");
const statusJsonMaxBuffer = 64 * 1024 * 1024;

function runNpm(script) {
  return spawnSync(npm, ["--silent", "run", script], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function parseJsonResult(result, command) {
  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    return {
      ok: false,
      payload: null,
      error:
        (result.stderr || "").trim() ||
        `${command} produced no JSON output.`,
    };
  }

  try {
    return {
      ok: result.status === 0,
      payload: JSON.parse(stdout),
      error: result.status === 0 ? null : (result.stderr || "").trim() || null,
    };
  } catch (error) {
    return {
      ok: false,
      payload: null,
      error: `Could not parse ${command} output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function acceptedSchedulerPosture(status) {
  const schedulerProof = status?.schedulerProof || {};
  const launchdRuntime = status?.launchdRuntime || {};
  const automaticProven = schedulerProof.automaticRunProven === true;
  const manualCurrentPendingAutomatic =
    schedulerProof.state === "automatic_unproven" &&
    launchdRuntime.loaded === true &&
    launchdRuntime.runs === 0;

  return {
    automaticProven,
    manualCurrentPendingAutomatic,
    accepted: automaticProven || manualCurrentPendingAutomatic,
    mode: automaticProven
      ? "automatic_proven"
      : manualCurrentPendingAutomatic
        ? "manual_current_pending_automatic"
        : schedulerProof.state || "unknown",
  };
}

function buildStatus() {
  const gitStatusShort = runGit(["status", "--short"]);
  const git = {
    head: runGit(["rev-parse", "--short", "HEAD"]) || "unknown",
    originMain: runGit(["rev-parse", "--short", "origin/main"]) || "unknown",
    workingTreeClean: gitStatusShort === "",
    workingTreeChanges: gitStatusShort ? gitStatusShort.split("\n") : [],
  };

  const statusResult = parseJsonResult(
    runNpm("status:nightly-backup:json"),
    "npm --silent run status:nightly-backup:json",
  );
  const verificationResult = parseJsonResult(
    runNpm("verify:nightly-backup:json"),
    "npm --silent run verify:nightly-backup:json",
  );
  const backupStatus = statusResult.payload || {};
  const backupVerification = verificationResult.payload || {};
  const scheduler = acceptedSchedulerPosture(backupStatus);
  const scheduleCurrent = backupStatus.scheduleHealth?.state === "current";
  const backupCurrentForLastScheduledRun =
    Boolean(backupStatus.scheduleHealth?.latestBackupAt) &&
    scheduleCurrent;
  const retentionOk =
    backupStatus.retention?.keep === 7 &&
    backupStatus.retention?.overRetentionCount === 0;
  const verificationOk = backupVerification.ok === true;
  const launchSafeBackupPosture =
    statusResult.payload?.schema === "tcos.nightlyBackupStatus.v1" &&
    backupVerification.schema === "tcos.nightlyEmergencyBackupVerification.v1" &&
    scheduleCurrent &&
    backupCurrentForLastScheduledRun &&
    retentionOk &&
    verificationOk &&
    scheduler.accepted;
  const operatorWatchRequired = !scheduler.automaticProven;
  const next = launchSafeBackupPosture
    ? operatorWatchRequired
      ? "Keep the current verified manual backup, leave the Mac awake for the next scheduled 02:30 run, then rerun npm run status:backup-runway to prove automatic scheduler execution."
      : "Automatic backup proof is current; keep monitoring with npm run status:backup-runway before go-live."
    : "Refresh nightly backup status and verification with npm run prepare:backup-runway, inspect failed checks, and do not treat the backup lane as launch-ready until the runway is accepted.";

  return {
    schema: "tcos.backupRunwayStatus.v1",
    generatedAt: new Date().toISOString(),
    git,
    ok: launchSafeBackupPosture,
    acceptedBackupPosture: launchSafeBackupPosture,
    operatorWatchRequired,
    schedulerProofMode: scheduler.mode,
    backupStatus: {
      command: "npm --silent run status:nightly-backup:json",
      commandOk: statusResult.ok,
      schema: backupStatus.schema || null,
      backupDir: backupStatus.backupDir || null,
      scheduleHealth: backupStatus.scheduleHealth || null,
      schedulerProof: backupStatus.schedulerProof || null,
      launchdRuntime: backupStatus.launchdRuntime || null,
      retention: backupStatus.retention || null,
      backups: {
        count: backupStatus.backups?.count ?? null,
        newest: backupStatus.backups?.newest || null,
        oldest: backupStatus.backups?.oldest || null,
      },
      readOnlyGuarantee: backupStatus.readOnlyGuarantee || null,
      error: statusResult.error,
    },
    backupVerification: {
      command: "npm --silent run verify:nightly-backup:json",
      commandOk: verificationResult.ok,
      schema: backupVerification.schema || null,
      ok: verificationOk,
      failedCheckCount: backupVerification.failedCheckCount ?? null,
      failedChecks: backupVerification.failedChecks || [],
      archivePath: backupVerification.archivePath || null,
      manifestPath: backupVerification.manifestPath || null,
      sha256Path: backupVerification.sha256Path || null,
      computedSha256: backupVerification.computedSha256 || null,
      archiveCount: backupVerification.archiveCount ?? null,
      readOnlyGuarantee: backupVerification.readOnlyGuarantee || null,
      error: verificationResult.error,
    },
    checks: {
      scheduleCurrent,
      backupCurrentForLastScheduledRun,
      retentionOk,
      verificationOk,
      schedulerAccepted: scheduler.accepted,
      automaticRunProven: scheduler.automaticProven,
      manualCurrentPendingAutomatic: scheduler.manualCurrentPendingAutomatic,
    },
    next,
    safeBuildBoundary:
      "Use this backup runway only for launch-safe backup evidence. It preserves seven-backup retention and does not approve live money, buy postage, release payouts, create Checkout, or start production deploys.",
    readOnlyGuarantee:
      "This command only reads Git state, nightly backup status JSON, and nightly backup verification JSON; it starts no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, revocation, or backup creation.",
  };
}

function printText(status) {
  console.log("TCOS backup runway status:");
  console.log(`- git HEAD: ${status.git.head}`);
  console.log(`- git origin/main: ${status.git.originMain}`);
  console.log(`- git working tree clean: ${status.git.workingTreeClean ? "yes" : "no"}`);
  console.log(`- accepted backup posture: ${status.acceptedBackupPosture ? "yes" : "no"}`);
  console.log(`- scheduler proof mode: ${status.schedulerProofMode}`);
  console.log(`- operator watch required: ${status.operatorWatchRequired ? "yes" : "no"}`);
  console.log(`- schedule health: ${status.backupStatus.scheduleHealth?.state || "unknown"}`);
  console.log(`- latest backup local: ${status.backupStatus.scheduleHealth?.latestBackupAtLocal || "unknown"}`);
  console.log(`- next scheduled local: ${status.backupStatus.scheduleHealth?.nextScheduledRunAtLocal || "unknown"}`);
  console.log(`- retention keep: ${status.backupStatus.retention?.keep ?? "unknown"}`);
  console.log(`- over-retention count: ${status.backupStatus.retention?.overRetentionCount ?? "unknown"}`);
  console.log(`- launchd loaded: ${status.backupStatus.launchdRuntime?.loaded ? "yes" : "no"}`);
  console.log(`- launchd runs: ${status.backupStatus.launchdRuntime?.runs ?? "unknown"}`);
  console.log(`- verification ok: ${status.backupVerification.ok ? "yes" : "no"}`);
  console.log(`- failed verification checks: ${status.backupVerification.failedCheckCount ?? "unknown"}`);
  console.log(`- verified archive: ${status.backupVerification.archivePath || "unknown"}`);
  console.log(`- computed sha256: ${status.backupVerification.computedSha256 || "unknown"}`);
  console.log(`- next: ${status.next}`);
  console.log("");
  console.log(`Safe build boundary: ${status.safeBuildBoundary}`);
  console.log(`Read-only guarantee: ${status.readOnlyGuarantee}`);
}

const status = buildStatus();

if (jsonOutput) {
  console.log(JSON.stringify(status, null, 2));
} else {
  printText(status);
}

if (!status.ok) {
  process.exitCode = 1;
}
