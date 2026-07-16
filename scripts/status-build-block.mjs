import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const statusJsonMaxBuffer = 64 * 1024 * 1024;

function runGoLiveStatus() {
  return spawnSync(npm, ["--silent", "run", "status:go-live:json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
}

function runBackupRunwayStatus() {
  return spawnSync(npm, ["--silent", "run", "status:backup-runway:json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
}

function parseOptionalJsonResult(result, command) {
  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    return {
      available: false,
      payload: null,
      error:
        (result.stderr || "").trim() ||
        `${command} produced no JSON output.`,
    };
  }

  try {
    return {
      available: true,
      payload: JSON.parse(stdout),
      error: result.status === 0 ? null : (result.stderr || "").trim() || null,
    };
  } catch (error) {
    return {
      available: false,
      payload: null,
      error: `Could not parse ${command} output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function normalizeCommands(commands = []) {
  return Array.isArray(commands)
    ? commands.filter((command) => typeof command === "string" && command.trim())
    : [];
}

function firstOperatorBlocker(status) {
  return (
    status.goLiveReadiness?.blockers?.find(
      (blocker) => blocker.actionCategory !== "external_wait",
    ) || null
  );
}

function quotaBlocker(status) {
  return (
    status.goLiveReadiness?.blockers?.find(
      (blocker) => blocker.area === "production_deploy_quota",
    ) || null
  );
}

function backupWatchItem(status) {
  return (
    status.goLiveReadiness?.watchItems?.find(
      (watchItem) => watchItem.area === "emergency_backup",
    ) || null
  );
}

function buildRecommendation(status) {
  const operatorBlocker = firstOperatorBlocker(status);
  const deployQuotaBlocker = quotaBlocker(status);
  const watchItem = backupWatchItem(status);

  if (!status.git?.workingTreeClean) {
    return {
      focus: "commit_or_stash_current_work",
      next: "Finish, commit, or intentionally shelve the current working-tree changes before starting another launch-bound block.",
      commands: ["git status --short"],
    };
  }

  if (status.git?.head !== status.git?.originMain) {
    return {
      focus: "push_or_reconcile_main",
      next: "Push or reconcile local HEAD with origin/main before starting deploy-bound work.",
      commands: ["git status --short", "git push origin main"],
    };
  }

  if (operatorBlocker) {
    return {
      focus:
        operatorBlocker.area === "live_money"
          ? "supabase_bootstrap_handoff"
          : operatorBlocker.area,
      next: operatorBlocker.next,
      commands: normalizeCommands(operatorBlocker.actionCommands),
    };
  }

  if (deployQuotaBlocker) {
    return {
      focus: "quota_wait_launch_safe_build",
      next:
        "No non-quota operator blocker is first in line. Keep building launch-safe local improvements, and rerun the quota check before any production deploy attempt.",
      commands: normalizeCommands(deployQuotaBlocker.actionCommands),
    };
  }

  if (watchItem) {
    return {
      focus: "operator_watch_item",
      next: watchItem.next,
      commands: normalizeCommands(watchItem.actionCommands),
    };
  }

  return {
    focus: "final_window_ready",
    next:
      status.goLiveReadiness?.nextDeployStep ||
      "Run npm run verify:production, then npm run launch:production when the production deploy is intended.",
    commands: ["npm run verify:production", "npm run launch:production"],
  };
}

function buildLocalBuildFallback(status, recommendation) {
  const operatorOrExternalGate =
    recommendation.focus === "supabase_bootstrap_handoff" ||
    recommendation.focus === "quota_wait_launch_safe_build" ||
    status.goLiveReadiness?.blockers?.some(
      (blocker) =>
        blocker.actionCategory === "external_wait" ||
        blocker.area === "live_money",
    );

  if (!status.git?.workingTreeClean || status.git?.head !== status.git?.originMain) {
    return {
      available: false,
      reason: "Local Git state must be clean and pushed before starting another launch-bound build block.",
      next: "Finish the current Git cleanup first.",
      commands: ["git status --short"],
    };
  }

  if (!operatorOrExternalGate) {
    return {
      available: false,
      reason: "A direct local/operator action is already available from the primary recommendation.",
      next: recommendation.next,
      commands: recommendation.commands,
    };
  }

  return {
    available: true,
    reason:
      "The primary blocker needs operator Supabase/env access or the external Vercel quota window, so Codex can keep advancing launch-safe local work; InstaComp Multi-Scanner Consensus is wired and the final tester pass is now first in the local goal stack.",
    next:
      "Run the July 16 InstaComp final tester next: use the wired Multi-Scanner Consensus panel/reason trail, keep live money/postage/payout/Checkout/deploy paths gated, load the 100-card / 200-scan trial, audit the ground-truth manifest, audit/map/preflight images before scanning, score it against 94% plus the FAF timing gate, fix misses, clean the UI, commit and push it, refresh go-live evidence, then archive and verify the build-block checkpoint.",
    commands: [
      "npm run status:instacomp-final-tester",
      "npm run verify:instacomp",
      "npm run instacomp:trial:intake",
      "npm run instacomp:trial:stage-images",
      "npm run instacomp:trial:prep",
      "npm run instacomp:trial:sync-images",
      "npm run instacomp:trial:monitor",
      "npm run instacomp:trial:init",
      "npm run instacomp:trial:groundtruth",
      "npm run instacomp:trial:audit",
      "npm run instacomp:trial:map",
      "npm run instacomp:trial:packet",
      "npm run instacomp:trial:preflight",
      "npm run instacomp:trial:ready",
      "npm run instacomp:trial:score",
      "npm run status:build-block",
      "npm run check:production-guardrails",
      "npm run lint",
      "npm run prepare:go-live-evidence",
      "npm run prepare:build-block-checkpoint",
    ],
  };
}

function buildBackupRunwayCheckpoint() {
  const result = parseOptionalJsonResult(
    runBackupRunwayStatus(),
    "npm --silent run status:backup-runway:json",
  );
  const payload = result.payload || {};

  return {
    available: result.available,
    command: "npm --silent run status:backup-runway:json",
    schema: payload.schema || null,
    acceptedBackupPosture: Boolean(payload.acceptedBackupPosture),
    schedulerProofMode: payload.schedulerProofMode || "unknown",
    operatorWatchRequired: Boolean(payload.operatorWatchRequired),
    scheduleHealth: payload.backupStatus?.scheduleHealth?.state || "unknown",
    latestBackupAtLocal:
      payload.backupStatus?.scheduleHealth?.latestBackupAtLocal || null,
    nextScheduledRunAtLocal:
      payload.backupStatus?.scheduleHealth?.nextScheduledRunAtLocal || null,
    retentionKeep: payload.backupStatus?.retention?.keep ?? null,
    overRetentionCount:
      payload.backupStatus?.retention?.overRetentionCount ?? null,
    verificationOk: Boolean(payload.backupVerification?.ok),
    verifiedArchive: payload.backupVerification?.archivePath || null,
    computedSha256: payload.backupVerification?.computedSha256 || null,
    next: payload.next || "Run npm run status:backup-runway.",
    error: result.error,
  };
}

function buildCheckpoint(status) {
  const recommendation = buildRecommendation(status);
  const localBuildFallback = buildLocalBuildFallback(status, recommendation);
  const backupRunway = buildBackupRunwayCheckpoint();
  const goLiveEvidence = status.goLiveEvidence || {};

  return {
    schema: "tcos.buildBlockCheckpoint.v1",
    generatedAt: new Date().toISOString(),
    sourceSchema: status.schema || "unknown",
    git: status.git,
    goLiveReadiness: {
      state: status.goLiveReadiness?.state || "unknown",
      blockerCount: status.goLiveReadiness?.blockerCount ?? null,
      watchItemCount: status.goLiveReadiness?.watchItemCount ?? null,
      nextActionableStep: status.goLiveReadiness?.nextActionableStep || "unknown",
      nextDeployStep: status.goLiveReadiness?.nextDeployStep || "unknown",
      nextOperatorStep: status.goLiveReadiness?.nextOperatorStep || "unknown",
    },
    goLiveEvidence: {
      available: Boolean(goLiveEvidence.available),
      ok: Boolean(goLiveEvidence.ok),
      capturedAtCurrentHead: Boolean(goLiveEvidence.capturedAtCurrentHead),
      archivePath: goLiveEvidence.path || null,
      archivedAt: goLiveEvidence.archivedAt || null,
      failedCheckCount: goLiveEvidence.failedCheckCount ?? null,
      liveMoneyPacketVerificationPath:
        goLiveEvidence.liveMoneyPacketVerificationPath || null,
      next: goLiveEvidence.next || "Run npm run prepare:go-live-evidence.",
    },
    recommendation,
    localBuildFallback,
    productionDeploymentQuota: {
      state: status.productionDeploymentQuota?.state || "unknown",
      reason: status.productionDeploymentQuota?.reason || "unknown",
      retryAt: status.productionDeploymentQuota?.retryAt || "unknown",
      retryAtLocal: status.productionDeploymentQuota?.retryAtLocal || null,
      approximateRemaining:
        status.productionDeploymentQuota?.approximateRemaining || "unknown",
      deployTimeoutMs:
        status.productionDeploymentQuota?.deployTimeoutMs ?? null,
      deployTimeout:
        status.productionDeploymentQuota?.deployTimeout || "unknown",
      deployTimeoutEnv:
        status.productionDeploymentQuota?.deployTimeoutEnv ||
        "TCOS_VERCEL_DEPLOY_TIMEOUT_MS",
      vercelUploadStarted: Boolean(
        status.productionDeploymentQuota?.vercelUploadStarted,
      ),
    },
    emergencyBackup: {
      scheduleHealth: status.emergencyBackup?.scheduleHealth?.state || "unknown",
      schedulerProof: status.emergencyBackup?.schedulerProof?.state || "unknown",
      automaticRunProven: Boolean(
        status.emergencyBackup?.schedulerProof?.automaticRunProven,
      ),
      latestBackupAtLocal:
        status.emergencyBackup?.freshness?.latestBackupAtLocal || null,
      nextScheduledRunAtLocal:
        status.emergencyBackup?.scheduleHealth?.nextScheduledRunAtLocal || null,
      verificationOk: Boolean(status.emergencyBackup?.verification?.ok),
      retentionKeep: status.emergencyBackup?.retention?.keep ?? null,
      overRetentionCount:
        status.emergencyBackup?.retention?.overRetentionCount ?? null,
    },
    backupRunway,
    liveMoney: {
      state: status.liveMoney?.state || "unknown",
      readyForRuntimeSwitch: Boolean(status.liveMoney?.readyForRuntimeSwitch),
      missingBootstrapEnvironment:
        status.liveMoney?.missingBootstrapEnvironment || [],
    },
    safeBuildBoundary:
      "Use this checkpoint to choose the next local/operator action. It does not approve live money, buy postage, release payouts, create Checkout, or start production deploys.",
    readOnlyGuarantee:
      "This command only reads the status:go-live JSON evidence and backup-runway JSON evidence, then prints a concise checkpoint; it starts no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, revocation, or backup creation.",
  };
}

function printText(checkpoint) {
  console.log("TCOS 30-minute build block checkpoint:");
  console.log(`- git HEAD: ${checkpoint.git?.head || "unknown"}`);
  console.log(`- git origin/main: ${checkpoint.git?.originMain || "unknown"}`);
  console.log(
    `- git working tree clean: ${checkpoint.git?.workingTreeClean ? "yes" : "no"}`,
  );
  console.log(`- go-live state: ${checkpoint.goLiveReadiness.state}`);
  console.log(`- blocker count: ${checkpoint.goLiveReadiness.blockerCount}`);
  console.log(`- watch item count: ${checkpoint.goLiveReadiness.watchItemCount}`);
  console.log(
    `- go-live evidence available: ${
      checkpoint.goLiveEvidence.available ? "yes" : "no"
    }`,
  );
  console.log(
    `- go-live evidence ok: ${checkpoint.goLiveEvidence.ok ? "yes" : "no"}`,
  );
  console.log(
    `- go-live evidence current pushed HEAD: ${
      checkpoint.goLiveEvidence.capturedAtCurrentHead ? "yes" : "no"
    }`,
  );
  console.log(`- go-live evidence next: ${checkpoint.goLiveEvidence.next}`);
  console.log(`- block focus: ${checkpoint.recommendation.focus}`);
  console.log(`- next: ${checkpoint.recommendation.next}`);
  if (checkpoint.recommendation.commands.length) {
    console.log(`- commands: ${checkpoint.recommendation.commands.join(" | ")}`);
  }
  console.log(
    `- local build fallback available: ${
      checkpoint.localBuildFallback.available ? "yes" : "no"
    }`,
  );
  console.log(`- local build fallback reason: ${checkpoint.localBuildFallback.reason}`);
  console.log(`- local build fallback next: ${checkpoint.localBuildFallback.next}`);
  if (checkpoint.localBuildFallback.commands.length) {
    console.log(
      `- local build fallback commands: ${checkpoint.localBuildFallback.commands.join(" | ")}`,
    );
  }

  console.log("");
  console.log("Quota:");
  console.log(`- state: ${checkpoint.productionDeploymentQuota.state}`);
  console.log(`- reason: ${checkpoint.productionDeploymentQuota.reason}`);
  console.log(
    `- retry at local: ${
      checkpoint.productionDeploymentQuota.retryAtLocal || "unknown"
    }`,
  );
  console.log(
    `- quota approximate remaining: ${checkpoint.productionDeploymentQuota.approximateRemaining}`,
  );
  console.log(
    `- Vercel deploy timeout: ${checkpoint.productionDeploymentQuota.deployTimeout}`,
  );
  console.log(
    `- Vercel upload started: ${
      checkpoint.productionDeploymentQuota.vercelUploadStarted ? "yes" : "no"
    }`,
  );

  console.log("");
  console.log("Emergency backup:");
  console.log(`- schedule health: ${checkpoint.emergencyBackup.scheduleHealth}`);
  console.log(`- scheduler proof: ${checkpoint.emergencyBackup.schedulerProof}`);
  console.log(
    `- automatic run proven: ${
      checkpoint.emergencyBackup.automaticRunProven ? "yes" : "no"
    }`,
  );
  console.log(
    `- latest backup local: ${
      checkpoint.emergencyBackup.latestBackupAtLocal || "unknown"
    }`,
  );
  console.log(
    `- next scheduled local: ${
      checkpoint.emergencyBackup.nextScheduledRunAtLocal || "unknown"
    }`,
  );
  console.log(
    `- verification ok: ${checkpoint.emergencyBackup.verificationOk ? "yes" : "no"}`,
  );
  console.log(`- retention keep: ${checkpoint.emergencyBackup.retentionKeep}`);
  console.log(
    `- over-retention count: ${checkpoint.emergencyBackup.overRetentionCount}`,
  );

  console.log("");
  console.log("Backup runway:");
  console.log(`- available: ${checkpoint.backupRunway.available ? "yes" : "no"}`);
  console.log(
    `- accepted backup posture: ${
      checkpoint.backupRunway.acceptedBackupPosture ? "yes" : "no"
    }`,
  );
  console.log(`- scheduler proof mode: ${checkpoint.backupRunway.schedulerProofMode}`);
  console.log(
    `- operator watch required: ${
      checkpoint.backupRunway.operatorWatchRequired ? "yes" : "no"
    }`,
  );
  console.log(`- schedule health: ${checkpoint.backupRunway.scheduleHealth}`);
  console.log(
    `- next scheduled local: ${
      checkpoint.backupRunway.nextScheduledRunAtLocal || "unknown"
    }`,
  );
  console.log(
    `- verified archive: ${checkpoint.backupRunway.verifiedArchive || "unknown"}`,
  );
  console.log(
    `- computed sha256: ${checkpoint.backupRunway.computedSha256 || "unknown"}`,
  );
  console.log(`- next: ${checkpoint.backupRunway.next}`);
  if (checkpoint.backupRunway.error) {
    console.log(`- backup runway warning: ${checkpoint.backupRunway.error}`);
  }

  console.log("");
  console.log("Live money:");
  console.log(`- state: ${checkpoint.liveMoney.state}`);
  console.log(
    `- ready for runtime switch: ${
      checkpoint.liveMoney.readyForRuntimeSwitch ? "yes" : "no"
    }`,
  );
  console.log(
    `- missing bootstrap environment: ${
      checkpoint.liveMoney.missingBootstrapEnvironment.length
        ? checkpoint.liveMoney.missingBootstrapEnvironment.join(", ")
        : "none detected"
    }`,
  );

  console.log("");
  console.log(`Safe build boundary: ${checkpoint.safeBuildBoundary}`);
  console.log(`Read-only guarantee: ${checkpoint.readOnlyGuarantee}`);
}

function main() {
  const json = process.argv.includes("--json");
  const result = runGoLiveStatus();
  const output = (result.stdout || "").trim();

  let status;
  try {
    status = JSON.parse(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = {
      schema: "tcos.buildBlockCheckpoint.v1",
      generatedAt: new Date().toISOString(),
      ok: false,
      error: `Could not parse status:go-live JSON: ${message}`,
      readOnlyGuarantee:
        "This command attempted to read status:go-live JSON only; it started no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, or revocation.",
    };

    if (json) {
      console.log(JSON.stringify(failure, null, 2));
    } else {
      console.error(failure.error);
      if (result.stderr) console.error(result.stderr.trim());
    }
    process.exitCode = 1;
    return;
  }

  const checkpoint = buildCheckpoint(status);

  if (json) {
    console.log(JSON.stringify(checkpoint, null, 2));
  } else {
    printText(checkpoint);
  }
}

main();
