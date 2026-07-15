import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const statusJsonMaxBuffer = 64 * 1024 * 1024;

function runBuildBlockStatus() {
  return spawnSync(npm, ["--silent", "run", "status:build-block:json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
}

function normalizeCommands(commands = []) {
  return Array.isArray(commands)
    ? commands.filter((command) => typeof command === "string" && command.trim())
    : [];
}

function gitReadyForEvidenceRefresh(checkpoint) {
  return (
    checkpoint.git?.workingTreeClean === true &&
    checkpoint.git?.head &&
    checkpoint.git?.originMain &&
    checkpoint.git.head === checkpoint.git.originMain
  );
}

function goLiveEvidenceRefreshRequired(checkpoint) {
  const evidence = checkpoint.goLiveEvidence || {};

  return (
    gitReadyForEvidenceRefresh(checkpoint) &&
    (evidence.available !== true ||
      evidence.ok !== true ||
      evidence.capturedAtCurrentHead !== true)
  );
}

function buildNextAction(checkpoint) {
  const fallback = checkpoint.localBuildFallback || {};
  const recommendation = checkpoint.recommendation || {};
  const evidenceRefreshRequired = goLiveEvidenceRefreshRequired(checkpoint);
  const evidenceRefresh = {
    reason:
      "Latest go-live evidence is missing, failing, or not captured at the current pushed HEAD; refresh launch evidence before selecting another launch-bound build block.",
    next:
      "Run the launch-safe go-live evidence refresh, then rerun the next 30-minute build-block selector.",
    commands: ["npm run prepare:go-live-evidence", "npm run prepare:build-block-checkpoint"],
  };
  const useFallback = !evidenceRefreshRequired && fallback.available === true;
  const selected = evidenceRefreshRequired
    ? evidenceRefresh
    : useFallback
      ? fallback
      : recommendation;

  return {
    schema: "tcos.nextBuildBlockAction.v1",
    generatedAt: new Date().toISOString(),
    sourceSchema: checkpoint.schema || "unknown",
    selectedLane: evidenceRefreshRequired
      ? "refresh_go_live_evidence"
      : useFallback
        ? "local_build_fallback"
        : "primary_recommendation",
    selectedReason: useFallback
      ? fallback.reason
      : evidenceRefreshRequired
        ? evidenceRefresh.reason
        : "Use the primary build-block recommendation because no fallback lane is available.",
    next: selected.next || "No next action was recorded.",
    commands: normalizeCommands(selected.commands),
    goLiveEvidenceRefreshRequired: evidenceRefreshRequired,
    primaryRecommendation: {
      focus: recommendation.focus || "unknown",
      next: recommendation.next || "unknown",
      commands: normalizeCommands(recommendation.commands),
    },
    localBuildFallback: {
      available: Boolean(fallback.available),
      reason: fallback.reason || "not recorded",
      next: fallback.next || "not recorded",
      commands: normalizeCommands(fallback.commands),
    },
    git: checkpoint.git || {},
    goLiveReadiness: checkpoint.goLiveReadiness || {},
    goLiveEvidence: checkpoint.goLiveEvidence || {},
    productionDeploymentQuota: checkpoint.productionDeploymentQuota || {},
    emergencyBackup: checkpoint.emergencyBackup || {},
    backupRunway: checkpoint.backupRunway || {},
    liveMoney: checkpoint.liveMoney || {},
    safeBuildBoundary:
      "Use this next-block action only for launch-safe local work. It does not approve live money, buy postage, release payouts, create Checkout, or start production deploys.",
    readOnlyGuarantee:
      "This command only reads status:build-block JSON and prints the next 30-minute block action; it starts no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, revocation, or backup creation.",
  };
}

function printText(action) {
  console.log("TCOS next 30-minute build block action:");
  console.log(`- selected lane: ${action.selectedLane}`);
  console.log(`- reason: ${action.selectedReason}`);
  console.log(`- next: ${action.next}`);
  if (action.commands.length) {
    console.log(`- commands: ${action.commands.join(" | ")}`);
  }
  console.log(
    `- go-live evidence refresh required: ${
      action.goLiveEvidenceRefreshRequired ? "yes" : "no"
    }`,
  );
  console.log(`- primary focus: ${action.primaryRecommendation.focus}`);
  console.log(`- primary next: ${action.primaryRecommendation.next}`);
  if (action.primaryRecommendation.commands.length) {
    console.log(
      `- primary commands: ${action.primaryRecommendation.commands.join(" | ")}`,
    );
  }
  console.log(
    `- fallback available: ${action.localBuildFallback.available ? "yes" : "no"}`,
  );

  console.log("");
  console.log("Current gates:");
  console.log(`- git HEAD: ${action.git?.head || "unknown"}`);
  console.log(`- git origin/main: ${action.git?.originMain || "unknown"}`);
  console.log(
    `- git working tree clean: ${action.git?.workingTreeClean ? "yes" : "no"}`,
  );
  console.log(`- go-live state: ${action.goLiveReadiness?.state || "unknown"}`);
  console.log(
    `- blocker count: ${action.goLiveReadiness?.blockerCount ?? "unknown"}`,
  );
  console.log(
    `- go-live evidence ok: ${action.goLiveEvidence?.ok ? "yes" : "no"}`,
  );
  console.log(
    `- go-live evidence current pushed HEAD: ${
      action.goLiveEvidence?.capturedAtCurrentHead ? "yes" : "no"
    }`,
  );
  console.log(
    `- quota state: ${action.productionDeploymentQuota?.state || "unknown"}`,
  );
  console.log(
    `- quota retry at local: ${
      action.productionDeploymentQuota?.retryAtLocal || "unknown"
    }`,
  );
  console.log(
    `- quota approximate remaining: ${
      action.productionDeploymentQuota?.approximateRemaining || "unknown"
    }`,
  );
  console.log(
    `- Vercel deploy timeout: ${
      action.productionDeploymentQuota?.deployTimeout || "unknown"
    }`,
  );
  console.log(
    `- backup scheduler proof: ${
      action.emergencyBackup?.schedulerProof || "unknown"
    }`,
  );
  console.log(
    `- backup runway accepted posture: ${
      action.backupRunway?.acceptedBackupPosture ? "yes" : "no"
    }`,
  );
  console.log(
    `- backup runway scheduler proof mode: ${
      action.backupRunway?.schedulerProofMode || "unknown"
    }`,
  );
  console.log(
    `- backup runway operator watch required: ${
      action.backupRunway?.operatorWatchRequired ? "yes" : "no"
    }`,
  );
  console.log(
    `- backup runway next scheduled local: ${
      action.backupRunway?.nextScheduledRunAtLocal || "not recorded"
    }`,
  );
  console.log(`- backup runway next: ${action.backupRunway?.next || "not recorded"}`);
  console.log(
    `- backup runway verified archive: ${
      action.backupRunway?.verifiedArchive || "not recorded"
    }`,
  );
  console.log(
    `- backup runway computed sha256: ${
      action.backupRunway?.computedSha256 || "not recorded"
    }`,
  );
  console.log(`- live-money state: ${action.liveMoney?.state || "unknown"}`);
  console.log(
    `- missing bootstrap environment: ${
      action.liveMoney?.missingBootstrapEnvironment?.length
        ? action.liveMoney.missingBootstrapEnvironment.join(", ")
        : "none detected"
    }`,
  );

  console.log("");
  console.log(`Safe build boundary: ${action.safeBuildBoundary}`);
  console.log(`Read-only guarantee: ${action.readOnlyGuarantee}`);
}

function main() {
  const json = process.argv.includes("--json");
  const result = runBuildBlockStatus();
  const output = (result.stdout || "").trim();

  let checkpoint;
  try {
    checkpoint = JSON.parse(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = {
      schema: "tcos.nextBuildBlockAction.v1",
      generatedAt: new Date().toISOString(),
      ok: false,
      error: `Could not parse status:build-block JSON: ${message}`,
      readOnlyGuarantee:
        "This command attempted to read status:build-block JSON only; it started no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, or revocation.",
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

  const action = buildNextAction(checkpoint);

  if (json) {
    console.log(JSON.stringify(action, null, 2));
  } else {
    printText(action);
  }
}

main();
