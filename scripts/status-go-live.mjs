import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const statusJsonMaxBuffer = 64 * 1024 * 1024;
const productionDeploySafety = {
  section: "Production Deploy Safety",
  cleanProductionDomain: "https://truely-collectables.vercel.app",
  unwantedAlias: "truely-collectables-tt3b.vercel.app",
  quotaBlockCode: "api-deployments-free-per-day",
  quotaStatusCommand: "npm run status:production",
  verifyCommand: "npm run verify:production",
  launchCommand: "npm run launch:production",
  smokeCommand: "npm run smoke:production",
  splitDeployCommand: "npm run deploy:production && npm run smoke:production",
  quotaRetryOverrideEnv: "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  quotaRetryOverrideFlag: "--force-quota-retry",
  quotaMarkerClearCondition:
    "Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds.",
  deployResultRequirement:
    "Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker.",
  vercelCliRequirement:
    "Use command-pinned Vercel CLI 56.2.0 through isolated npm exec.",
  scopeRequirement:
    "Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug before quota status, preflight, Git fetch, or Vercel CLI work.",
  protectedSequence: [
    "verify pushed stack",
    "remove unwanted truely-collectables-tt3b.vercel.app alias",
    "set clean production alias",
    "clear local quota marker after clean alias succeeds",
    "print DEPLOYED_PRODUCTION",
    "print CLEAN_PRODUCTION",
    "print smoke handoff command",
  ],
  launchWhenQuotaOpens:
    "After status:production reports open, run npm run verify:production, then npm run launch:production; ship only after npm run smoke:production passes the clean production domain.",
  readOnlyGuarantee:
    "This deploy-safety summary is static operator guidance; status:go-live does not fetch Git, build, run Vercel, deploy, change aliases, smoke production, create Checkout, buy postage, release payouts, approve launch, or revoke anything.",
};

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
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

function retryWindow(quota) {
  if (!quota.retryAt || quota.retryAt === "unknown") return null;
  return quota.retryAtLocal ? `${quota.retryAt} (${quota.retryAtLocal} local)` : quota.retryAt;
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
      blockedAtLocal: payload.blockedAtLocal || null,
      retryAt: payload.retryAt || "unknown",
      retryAtLocal: payload.retryAtLocal || null,
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
    blockedAtLocal: parseLine(output, "blocked at local"),
    retryAt: parseLine(output, "retry at or after"),
    retryAtLocal: parseLine(output, "retry at or after local"),
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

function runNpmJson(scriptName) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = run(npm, ["--silent", "run", scriptName]);
  const stdout = (result.stdout || "").trim();

  try {
    return {
      ok: result.status === 0,
      payload: JSON.parse(stdout),
    };
  } catch (error) {
    return {
      ok: false,
      payload: {
        error: `Could not parse ${scriptName} JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }
}

function latestJsonArchive(dir, suffix) {
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => {
      const filePath = join(dir, name);
      const stat = statSync(filePath);
      return {
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files[0] || null;
}

function goLiveEvidenceVerificationStatus(git) {
  const evidenceDir = join(repoRoot, ".codex-run", "go-live-evidence-verification");
  const latest = latestJsonArchive(evidenceDir, "-go-live-evidence-verification.json");
  if (!latest) {
    return {
      available: false,
      ok: false,
      path: null,
      next: "Run npm run prepare:go-live-evidence to archive the latest go-live evidence verifier proof.",
    };
  }

  try {
    const payload = JSON.parse(readFileSync(latest.filePath, "utf8"));
    const archiveGitHead = payload.archive?.gitHead || payload.git?.head || "unknown";
    const archiveGitOriginMain =
      payload.archive?.gitOriginMain || payload.git?.originMain || "unknown";
    const gitWorkingTreeClean =
      payload.archive?.gitWorkingTreeClean ?? payload.git?.workingTreeClean ?? null;
    const capturedAtCurrentHead =
      git.workingTreeClean === true &&
      archiveGitHead === git.head &&
      archiveGitOriginMain === git.originMain &&
      archiveGitHead === archiveGitOriginMain &&
      gitWorkingTreeClean === true;
    return {
      available: true,
      ok: payload.ok === true,
      path: latest.filePath,
      archivedAt: payload.archive?.archivedAt || payload.checkedAt || latest.modifiedAt,
      gitHead: archiveGitHead,
      gitOriginMain: archiveGitOriginMain,
      gitWorkingTreeClean,
      capturedAtCurrentHead,
      failedCheckCount:
        typeof payload.failedCheckCount === "number" ? payload.failedCheckCount : null,
      liveMoneyPacketVerificationPath:
        payload.evidence?.liveMoneyEnvPacketVerification?.path || null,
      verificationBoundary:
        payload.evidence?.liveMoneyEnvPacketVerification?.verificationBoundary ||
        payload.evidence?.liveMoneyEnvPacket?.verificationBoundary ||
        null,
      readOnlyGuarantee: payload.readOnlyGuarantee || null,
      next:
        payload.ok === true && capturedAtCurrentHead
          ? "Latest go-live evidence verifier proof is archived and clean."
          : "Run npm run prepare:go-live-evidence to refresh verifier proof at the current pushed HEAD.",
    };
  } catch (error) {
    return {
      available: true,
      ok: false,
      path: latest.filePath,
      parseError: error instanceof Error ? error.message : String(error),
      next: "Repair or replace the latest go-live evidence verifier archive by rerunning npm run prepare:go-live-evidence.",
    };
  }
}

function liveMoneyBootstrapNextStep(goLiveEvidence) {
  if (goLiveEvidence?.ok === true && goLiveEvidence?.capturedAtCurrentHead === true) {
    return "Latest go-live evidence is clean at the current pushed HEAD; run npm run live-money:bootstrap-handoff to print the bootstrap-only Vercel commands, print the Supabase-only local template, mirror the same values into local .env or shell variables, and rerun npm run status:live-money after the values are staged in Vercel.";
  }

  return "Run npm run prepare:go-live-evidence to preserve runway/backup proof, create no-secret live-money packet evidence, print bootstrap-only Vercel commands, and archive the go-live evidence verifier proof; then stage the printed values in Vercel, mirror them into local .env or shell variables, and rerun npm run live-money:bootstrap-handoff.";
}

function liveMoneyBootstrapActionCommands(goLiveEvidence) {
  if (goLiveEvidence?.ok === true && goLiveEvidence?.capturedAtCurrentHead === true) {
    return ["npm run live-money:bootstrap-handoff"];
  }

  return ["npm run prepare:go-live-evidence"];
}

function emergencyBackupStatus() {
  const status = runNpmJson("status:nightly-backup:json");
  const verification = runNpmJson("verify:nightly-backup:json");
  const statusPayload = status.payload;
  const verificationPayload = verification.payload;
  const latestBackupAt =
    statusPayload.backups?.newest?.modifiedAt ||
    verificationPayload.latestKnownArchive?.modifiedAt ||
    null;
  const latestBackupAgeMinutes = latestBackupAt
    ? Math.max(0, Math.round((Date.now() - new Date(latestBackupAt).getTime()) / 60000))
    : null;

  return {
    ok: status.ok && verification.ok && verificationPayload.ok === true,
    statusOk: status.ok,
    verificationOk: verification.ok && verificationPayload.ok === true,
    backupDir: statusPayload.backupDir || verificationPayload.backupDir || "unknown",
    datedBackupCount:
      typeof statusPayload.backups?.count === "number"
        ? statusPayload.backups.count
        : verificationPayload.archiveCount || 0,
    scheduleHealth: {
      state: statusPayload.scheduleHealth?.state || "unknown",
      message: statusPayload.scheduleHealth?.message || "unknown",
      lastScheduledRunAt: statusPayload.scheduleHealth?.lastScheduledRunAt || null,
      lastScheduledRunAtLocal: statusPayload.scheduleHealth?.lastScheduledRunAtLocal || null,
      nextScheduledRunAt: statusPayload.scheduleHealth?.nextScheduledRunAt || null,
      nextScheduledRunAtLocal: statusPayload.scheduleHealth?.nextScheduledRunAtLocal || null,
      latestBackupAtLocal: statusPayload.scheduleHealth?.latestBackupAtLocal || null,
    },
    freshness: {
      latestBackupAt,
      latestBackupAtLocal:
        statusPayload.scheduleHealth?.latestBackupAtLocal ||
        statusPayload.backups?.newest?.modifiedAtLocal ||
        null,
      latestBackupAgeMinutes,
      latestBackupAgeApprox:
        latestBackupAgeMinutes === null
          ? "unknown"
          : latestBackupAgeMinutes < 60
            ? `${latestBackupAgeMinutes}m`
            : `${Math.floor(latestBackupAgeMinutes / 60)}h ${latestBackupAgeMinutes % 60}m`,
      currentForLastScheduledRun: Boolean(
        statusPayload.scheduleHealth?.state === "current" ||
          (latestBackupAt &&
            statusPayload.scheduleHealth?.lastScheduledRunAt &&
            new Date(latestBackupAt).getTime() >=
              new Date(statusPayload.scheduleHealth.lastScheduledRunAt).getTime()),
      ),
    },
    schedulerProof: {
      state: statusPayload.schedulerProof?.state || "unknown",
      automaticRunProven: Boolean(statusPayload.schedulerProof?.automaticRunProven),
      message: statusPayload.schedulerProof?.message || "unknown",
      nextAction: statusPayload.schedulerProof?.nextAction || "unknown",
    },
    launchdRuntime: {
      loaded: Boolean(statusPayload.launchdRuntime?.loaded),
      runs:
        typeof statusPayload.launchdRuntime?.runs === "number"
          ? statusPayload.launchdRuntime.runs
          : null,
      lastExitCode: statusPayload.launchdRuntime?.lastExitCode || null,
    },
    verification: {
      ok: verificationPayload.ok === true,
      failedCheckCount:
        typeof verificationPayload.failedCheckCount === "number"
          ? verificationPayload.failedCheckCount
          : null,
      archivePath: verificationPayload.archivePath || null,
      computedSha256: verificationPayload.computedSha256 || null,
    },
    retention: {
      keep:
        typeof statusPayload.retention?.keep === "number"
          ? statusPayload.retention.keep
          : 7,
      overRetentionCount:
        typeof statusPayload.retention?.overRetentionCount === "number"
          ? statusPayload.retention.overRetentionCount
          : 0,
      oldestBackupAt: statusPayload.backups?.oldest?.modifiedAt || null,
    },
    raw: {
      status: statusPayload,
      verification: verificationPayload,
    },
  };
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

function goLiveReadiness({ git, quota, emergencyBackup, liveMoney, goLiveEvidence }) {
  const blockers = [];
  const watchItems = [];

  if (!git.workingTreeClean) {
    blockers.push({
      area: "git",
      state: "dirty_worktree",
      actionCategory: "operator_action",
      detail: "Local working tree has uncommitted changes.",
      next: "Commit and push launch-bound work before production deploy.",
      actionCommands: ["git status --short"],
    });
  }

  if (git.head && git.originMain && git.head !== git.originMain) {
    blockers.push({
      area: "git",
      state: "head_not_pushed",
      actionCategory: "operator_action",
      detail: `Local HEAD ${git.head} does not match origin/main ${git.originMain}.`,
      next: "Push or reconcile origin/main before production deploy.",
      actionCommands: ["git status --short", "git push origin main"],
    });
  }

  if (quota.state !== "open") {
    blockers.push({
      area: "production_deploy_quota",
      state: quota.state || "unknown",
      actionCategory: "external_wait",
      detail:
        quota.reason && quota.reason !== "unknown"
          ? `Production deploy quota is ${quota.state} because ${quota.reason}.`
          : `Production deploy quota is ${quota.state || "unknown"}.`,
      next:
        retryWindow(quota)
          ? `Wait until ${retryWindow(quota)}, then rerun npm run status:production before deploy.`
          : quota.next || "Rerun npm run status:production before deploy.",
      actionCommands: ["npm run status:production", "npm --silent run status:production:json"],
    });
  }

  if (!emergencyBackup.verification.ok) {
    blockers.push({
      area: "emergency_backup",
      state: "verification_failed",
      actionCategory: "operator_action",
      detail: `Nightly backup verification failed with ${
        emergencyBackup.verification.failedCheckCount ?? "unknown"
      } failed check(s).`,
      next: "Run npm run verify:nightly-backup and fix backup evidence before go-live.",
      actionCommands: ["npm run verify:nightly-backup", "npm run archive:nightly-backup-verification"],
    });
  }

  if (emergencyBackup.scheduleHealth.state !== "current") {
    blockers.push({
      area: "emergency_backup",
      state: emergencyBackup.scheduleHealth.state,
      actionCategory: "operator_action",
      detail: emergencyBackup.scheduleHealth.message,
      next: "Run npm run status:nightly-backup and repair the backup schedule before go-live.",
      actionCommands: ["npm run status:nightly-backup", "npm run archive:nightly-backup-status"],
    });
  }

  if (!emergencyBackup.freshness.currentForLastScheduledRun) {
    blockers.push({
      area: "emergency_backup",
      state: "stale_backup",
      actionCategory: "operator_action",
      detail: "Latest backup is not current for the last scheduled run.",
      next: "Run npm run backup:nightly or repair the scheduler before go-live.",
      actionCommands: ["npm run backup:nightly -- --local-only", "npm run verify:nightly-backup"],
    });
  }

  if (emergencyBackup.retention.overRetentionCount > 0) {
    blockers.push({
      area: "emergency_backup",
      state: "over_retention",
      actionCategory: "operator_action",
      detail: `Backup folder has ${emergencyBackup.retention.overRetentionCount} file(s) over the seven-backup retention window.`,
      next: "Run npm run status:nightly-backup and confirm retention rotation before go-live.",
      actionCommands: ["npm run status:nightly-backup", "npm run archive:nightly-backup-status"],
    });
  }

  if (!emergencyBackup.schedulerProof.automaticRunProven) {
    const scheduledProofHint = emergencyBackup.scheduleHealth.nextScheduledRunAtLocal
      ? ` Next scheduled run local: ${emergencyBackup.scheduleHealth.nextScheduledRunAtLocal}.`
      : "";
    watchItems.push({
      area: "emergency_backup",
      state: emergencyBackup.schedulerProof.state,
      actionCategory: "operator_watch",
      detail: emergencyBackup.schedulerProof.message,
      next: `${emergencyBackup.schedulerProof.nextAction}${scheduledProofHint}`,
      actionCommands: ["npm run status:nightly-backup"],
    });
  }

  if (!liveMoney.readyForRuntimeSwitch) {
    blockers.push({
      area: "live_money",
      state: liveMoney.state,
      actionCategory: "operator_action",
      detail: liveMoney.detail,
      next: liveMoney.missingBootstrapEnvironment.length
        ? liveMoneyBootstrapNextStep(goLiveEvidence)
        : liveMoney.next,
      actionCommands: liveMoney.missingBootstrapEnvironment.length
        ? liveMoneyBootstrapActionCommands(goLiveEvidence)
        : ["npm run status:live-money"],
      missingEnvironment: liveMoney.missingBootstrapEnvironment,
    });
  }

  return {
    state:
      blockers.length > 0
        ? "blocked"
        : watchItems.length > 0
          ? "ready_with_operator_watch_items"
          : "ready_for_final_window",
    blockerCount: blockers.length,
    watchItemCount: watchItems.length,
    blockers,
    watchItems,
    nextActionableStep:
      blockers.find((blocker) => blocker.actionCategory !== "external_wait")?.next ||
      watchItems[0]?.next ||
      "No operator action is currently available; wait for the deploy quota window and keep monitoring.",
    nextDeployStep:
      blockers.find((blocker) => blocker.area === "production_deploy_quota")?.next ||
      "Run npm run verify:production, then npm run launch:production when a production deploy is intended.",
    nextOperatorStep:
      blockers.find((blocker) => blocker.actionCategory !== "external_wait")?.next ||
      blockers[0]?.next ||
      watchItems[0]?.next ||
      "Run npm run verify:production, then npm run launch:production when the quota is open.",
    readOnlyGuarantee:
      "This readiness summary is derived from the same read-only Git, quota, emergency-backup, and live-money evidence; it starts no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, or revocation.",
  };
}

function buildStatus() {
  const gitStatusShort = runGit(["status", "--short"]);
  const gitHead = runGit(["rev-parse", "--short", "HEAD"]);
  const gitOriginMain = runGit(["rev-parse", "--short", "origin/main"]);
  const quota = quotaStatus();
  const liveMoney = liveMoneyStatus();
  const emergencyBackup = emergencyBackupStatus();
  const payload = liveMoney.payload;
  const readOnlyGuarantee =
    "This command only reads Git state, local quota status, live-money JSON evidence, emergency-backup status/verification evidence, and static deploy-safety guidance; it starts no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, or revocation.";
  const safeNextCommands = [
    "npm run status:production",
    "npm --silent run status:production:json",
    "npm run status:backup-runway",
    "npm --silent run status:backup-runway:json",
    "npm run archive:backup-runway",
    "npm run verify:backup-runway",
    "npm --silent run verify:backup-runway:json",
    "npm run status:build-block",
    "npm --silent run status:build-block:json",
    "npm run next:build-block",
    "npm --silent run next:build-block:json",
    "npm run archive:next-build-block-action",
    "npm run verify:next-build-block-action",
    "npm --silent run verify:next-build-block-action:json",
    "npm run prepare:next-build-block-action",
    "npm run status:build-block-history",
    "npm --silent run status:build-block-history:json",
    "npm run prepare:build-block-history",
    "npm run archive:build-block-history",
    "npm run verify:build-block-history",
    "npm --silent run verify:build-block-history:json",
    "npm run prepare:build-block-checkpoint",
    "npm run archive:build-block-checkpoint",
    "npm run verify:build-block-checkpoint",
    "npm --silent run verify:build-block-checkpoint:json",
    "npm run verify:production",
    "npm run status:live-money",
    "npm run status:nightly-backup",
    "npm run verify:nightly-backup",
    "npm run archive:nightly-backup-status",
    "npm run archive:nightly-backup-verification",
    "npm run prepare:backup-runway",
    "npm run prepare:go-live-evidence",
    "npm run verify:go-live-evidence",
    "npm --silent run verify:go-live-evidence:json",
    "npm run archive:go-live-evidence-verification",
    "npm run prepare:live-money-bootstrap",
    "npm run live-money:env-packet",
    "npm --silent run live-money:env-packet:json",
    "npm run verify:live-money-env-packet",
    "npm --silent run verify:live-money-env-packet:json",
    "npm run archive:live-money-env-packet-verification",
    "npm run live-money:bootstrap-handoff",
    "npm run live-money:vercel-bootstrap-commands",
    "npm run live-money:bootstrap-template",
    "npm run live-money:vercel-commands",
    "npm run archive:go-live-runway",
    "npm run archive:live-money-env-packet",
    "npm run archive:live-money",
  ];
  const git = {
    head: gitHead || "unknown",
    originMain: gitOriginMain || "unknown",
    workingTreeClean: gitStatusShort === "",
    workingTreeChanges: gitStatusShort ? gitStatusShort.split("\n") : [],
  };
  const goLiveEvidence = goLiveEvidenceVerificationStatus(git);
  const liveMoneySummary = {
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
  };

  return {
    schema: "tcos.goLiveRunwayStatus.v1",
    generatedAt: new Date().toISOString(),
    ok: quota.ok && liveMoney.ok && emergencyBackup.ok,
    git,
    goLiveReadiness: goLiveReadiness({
      git,
      quota,
      emergencyBackup,
      liveMoney: liveMoneySummary,
      goLiveEvidence,
    }),
    productionDeploymentQuota: quota,
    productionDeploySafety,
    emergencyBackup,
    goLiveEvidence,
    liveMoney: liveMoneySummary,
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
  console.log("Go-live readiness:");
  console.log(`- state: ${status.goLiveReadiness.state}`);
  console.log(`- blocker count: ${status.goLiveReadiness.blockerCount}`);
  console.log(`- watch item count: ${status.goLiveReadiness.watchItemCount}`);
  if (status.goLiveReadiness.blockers.length) {
    console.log("Go-live blockers:");
    for (const blocker of status.goLiveReadiness.blockers) {
      console.log(`- ${blocker.area}: ${blocker.state} (${blocker.actionCategory}) - ${blocker.detail}`);
      console.log(`  next: ${blocker.next}`);
      if (blocker.actionCommands?.length) {
        console.log(`  commands: ${blocker.actionCommands.join(" | ")}`);
      }
      if (blocker.missingEnvironment?.length) {
        console.log(`  missing environment: ${blocker.missingEnvironment.join(", ")}`);
      }
    }
  }
  if (status.goLiveReadiness.watchItems.length) {
    console.log("Go-live watch items:");
    for (const item of status.goLiveReadiness.watchItems) {
      console.log(`- ${item.area}: ${item.state} (${item.actionCategory}) - ${item.detail}`);
      console.log(`  next: ${item.next}`);
      if (item.actionCommands?.length) {
        console.log(`  commands: ${item.actionCommands.join(" | ")}`);
      }
    }
  }
  console.log(`- next actionable step: ${status.goLiveReadiness.nextActionableStep}`);
  console.log(`- next deploy step: ${status.goLiveReadiness.nextDeployStep}`);
  console.log(`- next operator step: ${status.goLiveReadiness.nextOperatorStep}`);

  console.log("");
  console.log("Go-live evidence:");
  console.log(`- available: ${status.goLiveEvidence.available ? "yes" : "no"}`);
  console.log(`- verification ok: ${status.goLiveEvidence.ok ? "yes" : "no"}`);
  console.log(`- failed checks: ${status.goLiveEvidence.failedCheckCount ?? "unknown"}`);
  console.log(`- archive: ${status.goLiveEvidence.path || "missing"}`);
  console.log(`- archived at: ${status.goLiveEvidence.archivedAt || "unknown"}`);
  console.log(`- git HEAD: ${status.goLiveEvidence.gitHead || "unknown"}`);
  console.log(`- git origin/main: ${status.goLiveEvidence.gitOriginMain || "unknown"}`);
  console.log(
    `- git working tree clean: ${
      status.goLiveEvidence.gitWorkingTreeClean === true ? "yes" : "unknown"
    }`,
  );
  console.log(
    `- captured at current pushed HEAD: ${
      status.goLiveEvidence.capturedAtCurrentHead ? "yes" : "no"
    }`,
  );
  console.log(
    `- live-money packet verification: ${
      status.goLiveEvidence.liveMoneyPacketVerificationPath || "missing"
    }`,
  );
  console.log(
    `- live-money verification boundary: ${
      status.goLiveEvidence.verificationBoundary || "not recorded"
    }`,
  );
  console.log(`- next: ${status.goLiveEvidence.next}`);

  console.log("");
  console.log("Production deployment quota:");
  console.log(`- state: ${status.productionDeploymentQuota.state}`);
  console.log(
    `- retry allowed by local cooldown: ${status.productionDeploymentQuota.canRetry}`,
  );
  console.log(`- reason: ${status.productionDeploymentQuota.reason}`);
  if (status.productionDeploymentQuota.blockedAt) {
    console.log(`- blocked at: ${status.productionDeploymentQuota.blockedAt}`);
  }
  if (status.productionDeploymentQuota.blockedAtLocal) {
    console.log(`- blocked at local: ${status.productionDeploymentQuota.blockedAtLocal}`);
  }
  console.log(`- retry at or after: ${status.productionDeploymentQuota.retryAt}`);
  if (status.productionDeploymentQuota.retryAtLocal) {
    console.log(`- retry at or after local: ${status.productionDeploymentQuota.retryAtLocal}`);
  }
  console.log(
    `- quota approximate remaining: ${status.productionDeploymentQuota.approximateRemaining}`,
  );
  console.log(`- Vercel upload started: ${status.productionDeploymentQuota.uploadStarted}`);
  console.log(`- next: ${status.productionDeploymentQuota.next}`);

  console.log("");
  console.log("Production deploy safety:");
  console.log(`- clean production domain: ${status.productionDeploySafety.cleanProductionDomain}`);
  console.log(`- unwanted alias: ${status.productionDeploySafety.unwantedAlias}`);
  console.log(`- quota block code: ${status.productionDeploySafety.quotaBlockCode}`);
  console.log(`- verify command: ${status.productionDeploySafety.verifyCommand}`);
  console.log(`- launch command when quota opens: ${status.productionDeploySafety.launchCommand}`);
  console.log(`- smoke command: ${status.productionDeploySafety.smokeCommand}`);
  console.log(`- split deploy/smoke fallback: ${status.productionDeploySafety.splitDeployCommand}`);
  console.log(`- quota retry override env: ${status.productionDeploySafety.quotaRetryOverrideEnv}`);
  console.log(`- quota retry override flag: ${status.productionDeploySafety.quotaRetryOverrideFlag}`);
  console.log(`- marker clear rule: ${status.productionDeploySafety.quotaMarkerClearCondition}`);
  console.log(`- deploy result rule: ${status.productionDeploySafety.deployResultRequirement}`);
  console.log(`- Vercel CLI rule: ${status.productionDeploySafety.vercelCliRequirement}`);
  console.log(`- scope rule: ${status.productionDeploySafety.scopeRequirement}`);
  console.log(`- protected sequence: ${status.productionDeploySafety.protectedSequence.join(" -> ")}`);
  console.log(`- next after quota opens: ${status.productionDeploySafety.launchWhenQuotaOpens}`);
  console.log(`- read-only guarantee: ${status.productionDeploySafety.readOnlyGuarantee}`);

  console.log("");
  console.log("Emergency backup:");
  console.log(`- backup folder: ${status.emergencyBackup.backupDir}`);
  console.log(`- dated backup count: ${status.emergencyBackup.datedBackupCount}`);
  console.log(`- latest backup at: ${status.emergencyBackup.freshness.latestBackupAt || "unknown"}`);
  console.log(`- latest backup at local: ${status.emergencyBackup.freshness.latestBackupAtLocal || "unknown"}`);
  console.log(`- latest backup age: ${status.emergencyBackup.freshness.latestBackupAgeApprox}`);
  console.log(
    `- current for last scheduled run: ${
      status.emergencyBackup.freshness.currentForLastScheduledRun ? "yes" : "no"
    }`,
  );
  console.log(`- retention keep: ${status.emergencyBackup.retention.keep}`);
  console.log(`- over-retention count: ${status.emergencyBackup.retention.overRetentionCount}`);
  console.log(`- schedule health: ${status.emergencyBackup.scheduleHealth.state}`);
  console.log(`- last scheduled run: ${status.emergencyBackup.scheduleHealth.lastScheduledRunAt || "unknown"}`);
  console.log(`- last scheduled run local: ${status.emergencyBackup.scheduleHealth.lastScheduledRunAtLocal || "unknown"}`);
  console.log(`- next scheduled run: ${status.emergencyBackup.scheduleHealth.nextScheduledRunAt || "unknown"}`);
  console.log(`- next scheduled run local: ${status.emergencyBackup.scheduleHealth.nextScheduledRunAtLocal || "unknown"}`);
  console.log(`- scheduler proof: ${status.emergencyBackup.schedulerProof.state}`);
  console.log(
    `- automatic run proven: ${
      status.emergencyBackup.schedulerProof.automaticRunProven ? "yes" : "no"
    }`,
  );
  console.log(`- launchd loaded: ${status.emergencyBackup.launchdRuntime.loaded ? "yes" : "no"}`);
  console.log(`- launchd runs: ${status.emergencyBackup.launchdRuntime.runs ?? "unknown"}`);
  console.log(`- verification ok: ${status.emergencyBackup.verification.ok ? "yes" : "no"}`);
  console.log(`- failed verification checks: ${status.emergencyBackup.verification.failedCheckCount ?? "unknown"}`);
  console.log(`- verified archive: ${status.emergencyBackup.verification.archivePath || "unknown"}`);
  console.log(`- computed sha256: ${status.emergencyBackup.verification.computedSha256 || "unknown"}`);
  console.log(`- next: ${status.emergencyBackup.schedulerProof.nextAction}`);

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
