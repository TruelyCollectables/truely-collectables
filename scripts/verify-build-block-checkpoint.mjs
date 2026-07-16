import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const schema = "tcos.buildBlockCheckpointVerification.v1";
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "build-block-checkpoint");

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

function listCheckpointArchives() {
  if (!existsSync(evidenceDir)) return [];

  return readdirSync(evidenceDir)
    .filter((name) => name.endsWith("-build-block-checkpoint.json"))
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
      knownArchives: listCheckpointArchives(),
    };
  }

  const archives = listCheckpointArchives();
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
  check(Boolean(archivePath), "build-block checkpoint archive selected"),
  check(
    Boolean(archivePath && existsSync(archivePath)),
    "build-block checkpoint archive exists",
    archivePath,
  ),
];

let payload = null;
let parseError = null;
if (archivePath && existsSync(archivePath)) {
  try {
    payload = JSON.parse(readFileSync(archivePath, "utf8"));
    checks.push(check(true, "build-block checkpoint JSON parses"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    checks.push(check(false, "build-block checkpoint JSON parses", parseError));
  }
}

if (payload) {
  const gitBlockerAreas = new Set(
    Array.isArray(payload.git?.workingTreeChanges)
      ? payload.git.workingTreeChanges
      : [],
  );
  const recommendedCommands = Array.isArray(payload.recommendation?.commands)
    ? payload.recommendation.commands
    : [];
  const fallbackCommands = Array.isArray(payload.localBuildFallback?.commands)
    ? payload.localBuildFallback.commands
    : [];

  checks.push(check(payload.schema === "tcos.buildBlockCheckpoint.v1", "checkpoint schema"));
  checks.push(check(payload.sourceSchema === "tcos.goLiveRunwayStatus.v1", "checkpoint source schema"));
  checks.push(check(Boolean(payload.generatedAt), "checkpoint generatedAt"));
  checks.push(check(payload.git?.workingTreeClean === true, "checkpoint git payload is clean"));
  checks.push(check(payload.git?.head === currentHead, "checkpoint git head matches current HEAD", payload.git?.head));
  checks.push(
    check(
      payload.git?.originMain === currentOriginMain,
      "checkpoint origin/main matches current origin/main",
      payload.git?.originMain,
    ),
  );
  checks.push(check(gitBlockerAreas.size === 0, "checkpoint has no working-tree changes"));
  checks.push(check(payload.archive?.gitWorkingTreeClean === true, "archive metadata was captured with a clean tree"));
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
      payload.archive?.command === "npm --silent run status:build-block:json",
      "archive source command matches",
      payload.archive?.command,
    ),
  );
  checks.push(
    check(
      typeof payload.goLiveEvidence?.available === "boolean",
      "checkpoint go-live evidence availability is recorded",
      payload.goLiveEvidence?.available,
    ),
  );
  checks.push(
    check(
      payload.goLiveEvidence?.ok === true,
      "checkpoint go-live evidence verifier is ok",
      payload.goLiveEvidence?.ok,
    ),
  );
  checks.push(
    check(
      payload.goLiveEvidence?.capturedAtCurrentHead === true,
      "checkpoint go-live evidence captured current pushed HEAD",
      payload.goLiveEvidence?.capturedAtCurrentHead,
    ),
  );
  checks.push(
    check(
      Boolean(payload.goLiveEvidence?.next),
      "checkpoint go-live evidence next step is recorded",
      payload.goLiveEvidence?.next || null,
    ),
  );
  checks.push(check(Boolean(payload.recommendation?.focus), "checkpoint recommendation focus"));
  checks.push(check(Boolean(payload.recommendation?.next), "checkpoint recommendation next step"));
  checks.push(check(recommendedCommands.length > 0, "checkpoint recommendation commands exist"));
  checks.push(
    check(
      typeof payload.localBuildFallback?.available === "boolean",
      "checkpoint local build fallback availability is recorded",
    ),
  );
  checks.push(check(Boolean(payload.localBuildFallback?.reason), "checkpoint local build fallback reason"));
  checks.push(check(Boolean(payload.localBuildFallback?.next), "checkpoint local build fallback next step"));
  checks.push(check(fallbackCommands.length > 0, "checkpoint local build fallback commands exist"));
  if (payload.localBuildFallback?.available) {
    checks.push(
      check(
        fallbackCommands.includes("npm run prepare:build-block-checkpoint"),
        "local build fallback preserves checkpoint handoff command",
      ),
    );
      checks.push(
        check(
          fallbackCommands.includes("npm run instacomp:trial:groundtruth"),
          "local build fallback preserves InstaComp trial ground-truth manifest audit command",
        ),
      );
      checks.push(
        check(
          fallbackCommands.includes("npm run instacomp:trial:audit"),
          "local build fallback preserves InstaComp trial image audit command",
      ),
    );
    checks.push(
      check(
        fallbackCommands.includes("npm run instacomp:trial:map"),
        "local build fallback preserves InstaComp trial image map command",
      ),
    );
    checks.push(
      check(
        fallbackCommands.includes("npm run instacomp:trial:packet"),
        "local build fallback preserves InstaComp trial intake packet command",
      ),
    );
    checks.push(
      check(
        fallbackCommands.includes("npm run instacomp:trial:preflight"),
        "local build fallback preserves InstaComp trial preflight command",
      ),
    );
    checks.push(
      check(
        fallbackCommands.includes("npm run instacomp:trial:ready"),
        "local build fallback preserves InstaComp trial ready gate command",
      ),
    );
    checks.push(
      check(
        fallbackCommands.includes("npm run instacomp:trial:score"),
        "local build fallback preserves InstaComp speed-gated trial score command",
      ),
    );
    checks.push(
      check(
        payload.localBuildFallback.next?.includes("audit/map/preflight images before scanning"),
        "local build fallback tells the operator to audit/map/preflight images before scanning",
        payload.localBuildFallback.next || null,
      ),
    );
    checks.push(
      check(
        payload.localBuildFallback.next?.includes("keep live money/postage/payout/Checkout/deploy paths gated"),
        "local build fallback preserves live-money/postage/deploy gates",
        payload.localBuildFallback.next || null,
      ),
    );
  }
  checks.push(
    check(
      payload.productionDeploymentQuota?.vercelUploadStarted === false,
      "checkpoint confirms no Vercel upload started",
      payload.productionDeploymentQuota?.vercelUploadStarted,
    ),
  );
  checks.push(
    check(
      Boolean(payload.productionDeploymentQuota?.approximateRemaining),
      "checkpoint quota approximate remaining is recorded",
      payload.productionDeploymentQuota?.approximateRemaining || null,
    ),
  );
  checks.push(
    check(
      Boolean(payload.productionDeploymentQuota?.deployTimeout),
      "checkpoint deploy timeout is recorded",
      payload.productionDeploymentQuota?.deployTimeout || null,
    ),
  );
  checks.push(
    check(
      payload.productionDeploymentQuota?.deployTimeoutEnv ===
        "TCOS_VERCEL_DEPLOY_TIMEOUT_MS",
      "checkpoint deploy timeout env is recorded",
      payload.productionDeploymentQuota?.deployTimeoutEnv || null,
    ),
  );
  checks.push(check(payload.emergencyBackup?.verificationOk === true, "checkpoint backup verification is ok"));
  checks.push(
    check(
      payload.emergencyBackup?.overRetentionCount === 0,
      "checkpoint backup retention has no over-retention",
      payload.emergencyBackup?.overRetentionCount,
    ),
  );
  checks.push(
    check(
      payload.backupRunway?.schema === "tcos.backupRunwayStatus.v1",
      "checkpoint backup runway schema",
      payload.backupRunway?.schema || null,
    ),
  );
  checks.push(
    check(
      payload.backupRunway?.acceptedBackupPosture === true,
      "checkpoint backup runway accepted posture",
      payload.backupRunway?.acceptedBackupPosture,
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.schedulerProofMode),
      "checkpoint backup runway scheduler proof mode",
      payload.backupRunway?.schedulerProofMode || null,
    ),
  );
  checks.push(
    check(
      typeof payload.backupRunway?.operatorWatchRequired === "boolean",
      "checkpoint backup runway operator-watch flag",
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.next),
      "checkpoint backup runway next action",
      payload.backupRunway?.next || null,
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.nextScheduledRunAtLocal),
      "checkpoint backup runway next scheduled local is recorded",
      payload.backupRunway?.nextScheduledRunAtLocal || null,
    ),
  );
  checks.push(
    check(
      payload.backupRunway?.verificationOk === true,
      "checkpoint backup runway verification is ok",
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.verifiedArchive),
      "checkpoint backup runway records verified archive",
      payload.backupRunway?.verifiedArchive || null,
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.computedSha256),
      "checkpoint backup runway records computed SHA-256",
      payload.backupRunway?.computedSha256 || null,
    ),
  );
  checks.push(
    check(
      payload.backupRunway?.operatorWatchRequired === true ||
        payload.backupRunway?.schedulerProofMode === "automatic_proven",
      "checkpoint backup runway keeps automatic scheduler proof explicit",
      payload.backupRunway?.schedulerProofMode || null,
    ),
  );
  checks.push(check(Boolean(payload.liveMoney?.state), "checkpoint live-money state"));
  checks.push(
    check(
      Array.isArray(payload.liveMoney?.missingBootstrapEnvironment),
      "checkpoint live-money missing bootstrap list exists",
    ),
  );
  checks.push(
    check(
      payload.liveMoney?.state === "BLOCKED_UNEVALUATED"
        ? payload.liveMoney?.missingBootstrapEnvironment?.length > 0
        : Array.isArray(payload.liveMoney?.missingBootstrapEnvironment),
      "checkpoint live-money missing bootstrap environment matches state",
      `${payload.liveMoney?.state || "unknown"} / ${
        Array.isArray(payload.liveMoney?.missingBootstrapEnvironment)
          ? payload.liveMoney.missingBootstrapEnvironment.join(", ") || "none detected"
          : "not recorded"
      }`,
    ),
  );
  checks.push(
    check(
      payload.safeBuildBoundary?.includes("does not approve live money") &&
        payload.safeBuildBoundary?.includes("buy postage") &&
        payload.safeBuildBoundary?.includes("create Checkout") &&
        payload.safeBuildBoundary?.includes("start production deploys"),
      "safe build boundary preserves no-money/no-postage/no-deploy limits",
      payload.safeBuildBoundary || null,
    ),
  );
  checks.push(
    check(
      payload.readOnlyGuarantee?.includes("starts no deploy") &&
        payload.readOnlyGuarantee?.includes("Git push") &&
        payload.readOnlyGuarantee?.includes("Checkout") &&
        payload.readOnlyGuarantee?.includes("postage") &&
        payload.readOnlyGuarantee?.includes("payout"),
      "checkpoint read-only guarantee preserves side-effect limits",
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
  checkpoint: payload
    ? {
        schema: payload.schema || null,
        generatedAt: payload.generatedAt || null,
        focus: payload.recommendation?.focus || null,
        next: payload.recommendation?.next || null,
        commands: payload.recommendation?.commands || [],
        localBuildFallback: payload.localBuildFallback || null,
        goLiveState: payload.goLiveReadiness?.state || null,
        blockerCount: payload.goLiveReadiness?.blockerCount ?? null,
        watchItemCount: payload.goLiveReadiness?.watchItemCount ?? null,
        goLiveEvidence: payload.goLiveEvidence || null,
        quotaState: payload.productionDeploymentQuota?.state || null,
        quotaRetryAtLocal: payload.productionDeploymentQuota?.retryAtLocal || null,
        quotaApproximateRemaining:
          payload.productionDeploymentQuota?.approximateRemaining || null,
        deployTimeout: payload.productionDeploymentQuota?.deployTimeout || null,
        deployTimeoutMs: payload.productionDeploymentQuota?.deployTimeoutMs ?? null,
        deployTimeoutEnv:
          payload.productionDeploymentQuota?.deployTimeoutEnv || null,
        backupScheduleHealth: payload.emergencyBackup?.scheduleHealth || null,
        backupSchedulerProof: payload.emergencyBackup?.schedulerProof || null,
        backupRunway: payload.backupRunway || null,
        backupRunwayNextScheduledRunAtLocal:
          payload.backupRunway?.nextScheduledRunAtLocal || null,
        backupRunwayNext: payload.backupRunway?.next || null,
        backupRunwayVerifiedArchive: payload.backupRunway?.verifiedArchive || null,
        backupRunwayComputedSha256: payload.backupRunway?.computedSha256 || null,
        liveMoneyState: payload.liveMoney?.state || null,
        liveMoneyMissingBootstrapEnvironment:
          payload.liveMoney?.missingBootstrapEnvironment || [],
      }
    : null,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads Git state and the latest build-block checkpoint archive; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(verification, null, 2));
} else {
  console.log("TCOS build-block checkpoint verification:");
  console.log(`- evidence folder: ${evidenceDir}`);
  console.log(`- selected by: ${verification.selectedBy}`);
  console.log(`- archive: ${archivePath || "none"}`);
  console.log(`- archive count: ${verification.archiveCount}`);
  console.log(`- git HEAD: ${verification.git.head}`);
  console.log(`- git origin/main: ${verification.git.originMain}`);
  console.log(`- git working tree clean: ${verification.git.workingTreeClean ? "yes" : "no"}`);
  console.log(`- checkpoint focus: ${verification.checkpoint?.focus || "not recorded"}`);
  console.log(`- checkpoint next: ${verification.checkpoint?.next || "not recorded"}`);
  if (verification.checkpoint?.commands?.length) {
    console.log(`- checkpoint commands: ${verification.checkpoint.commands.join(" | ")}`);
  }
  console.log(
    `- local build fallback available: ${
      verification.checkpoint?.localBuildFallback?.available ? "yes" : "no"
    }`,
  );
  console.log(
    `- local build fallback next: ${
      verification.checkpoint?.localBuildFallback?.next || "not recorded"
    }`,
  );
  if (verification.checkpoint?.localBuildFallback?.commands?.length) {
    console.log(
      `- local build fallback commands: ${verification.checkpoint.localBuildFallback.commands.join(" | ")}`,
    );
  }
  console.log(`- go-live state: ${verification.checkpoint?.goLiveState || "not recorded"}`);
  console.log(
    `- go-live evidence ok: ${
      verification.checkpoint?.goLiveEvidence?.ok ? "yes" : "no"
    }`,
  );
  console.log(
    `- go-live evidence current pushed HEAD: ${
      verification.checkpoint?.goLiveEvidence?.capturedAtCurrentHead ? "yes" : "no"
    }`,
  );
  console.log(`- quota state: ${verification.checkpoint?.quotaState || "not recorded"}`);
  console.log(
    `- quota retry at local: ${verification.checkpoint?.quotaRetryAtLocal || "not recorded"}`,
  );
  console.log(
    `- quota approximate remaining: ${
      verification.checkpoint?.quotaApproximateRemaining || "not recorded"
    }`,
  );
  console.log(
    `- Vercel deploy timeout: ${
      verification.checkpoint?.deployTimeout || "not recorded"
    }`,
  );
  console.log(
    `- backup runway accepted posture: ${
      verification.checkpoint?.backupRunway?.acceptedBackupPosture ? "yes" : "no"
    }`,
  );
  console.log(
    `- backup runway scheduler proof mode: ${
      verification.checkpoint?.backupRunway?.schedulerProofMode || "not recorded"
    }`,
  );
  console.log(
    `- backup runway operator watch required: ${
      verification.checkpoint?.backupRunway?.operatorWatchRequired ? "yes" : "no"
    }`,
  );
  console.log(
    `- backup runway next scheduled local: ${
      verification.checkpoint?.backupRunwayNextScheduledRunAtLocal || "not recorded"
    }`,
  );
  console.log(
    `- backup runway next: ${
      verification.checkpoint?.backupRunwayNext || "not recorded"
    }`,
  );
  console.log(
    `- backup runway verified archive: ${
      verification.checkpoint?.backupRunwayVerifiedArchive || "not recorded"
    }`,
  );
  console.log(
    `- backup runway computed sha256: ${
      verification.checkpoint?.backupRunwayComputedSha256 || "not recorded"
    }`,
  );
  console.log(`- live-money state: ${verification.checkpoint?.liveMoneyState || "not recorded"}`);
  console.log(
    `- live-money missing bootstrap environment: ${
      verification.checkpoint?.liveMoneyMissingBootstrapEnvironment?.length
        ? verification.checkpoint.liveMoneyMissingBootstrapEnvironment.join(", ")
        : "none detected"
    }`,
  );
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
