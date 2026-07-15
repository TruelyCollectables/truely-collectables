import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const jsonOutput = process.argv.includes("--json");

const sources = [
  {
    key: "checkpoint",
    label: "build-block checkpoint",
    dir: join(repoRoot, ".codex-run", "build-block-checkpoint"),
    suffix: "-build-block-checkpoint.json",
  },
  {
    key: "nextAction",
    label: "next build-block action",
    dir: join(repoRoot, ".codex-run", "next-build-block-action"),
    suffix: "-next-build-block-action.json",
  },
  {
    key: "goLiveRunway",
    label: "go-live runway",
    dir: join(repoRoot, ".codex-run", "go-live-runway"),
    suffix: "-go-live-runway.json",
  },
];

function runLocalGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function listArchives(source) {
  if (!existsSync(source.dir)) return [];

  return readdirSync(source.dir)
    .filter((name) => name.endsWith(source.suffix))
    .map((name) => {
      const filePath = join(source.dir, name);
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

function readJson(filePath) {
  try {
    return {
      ok: true,
      payload: JSON.parse(readFileSync(filePath, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeArchive(source, currentHead, currentOriginMain) {
  const archives = listArchives(source);
  const latest = archives[0] || null;
  if (!latest) {
    return {
      label: source.label,
      evidenceDir: source.dir,
      archiveCount: 0,
      latestArchive: null,
      payloadOk: false,
      payloadError: "No archive found.",
      capturedAtCurrentPushedHead: false,
      summary: {},
    };
  }

  const parsed = readJson(latest.filePath);
  const payload = parsed.payload || {};
  const archive = payload.archive || {};
  const archiveHead = archive.gitHead || payload.git?.head || "unknown";
  const archiveOriginMain =
    archive.gitOriginMain || payload.git?.originMain || "unknown";
  const archiveClean =
    archive.gitWorkingTreeClean ?? payload.git?.workingTreeClean ?? false;

  return {
    label: source.label,
    evidenceDir: source.dir,
    archiveCount: archives.length,
    latestArchive: {
      ...latest,
      archivedAt: archive.archivedAt || payload.generatedAt || null,
      gitHead: archiveHead,
      gitOriginMain: archiveOriginMain,
      gitWorkingTreeClean: Boolean(archiveClean),
    },
    payloadOk: parsed.ok,
    payloadError: parsed.error,
    capturedAtCurrentPushedHead:
      parsed.ok &&
      archiveHead === currentHead &&
      archiveOriginMain === currentOriginMain &&
      currentHead === currentOriginMain &&
      Boolean(archiveClean),
    summary: summarizePayload(source.key, payload),
  };
}

function summarizePayload(key, payload) {
  if (key === "checkpoint") {
    return {
      schema: payload.schema || null,
      focus: payload.recommendation?.focus || null,
      next: payload.recommendation?.next || null,
      localBuildFallbackAvailable:
        payload.localBuildFallback?.available ?? null,
      goLiveEvidenceOk: payload.goLiveEvidence?.ok ?? null,
      goLiveEvidenceCapturedAtCurrentHead:
        payload.goLiveEvidence?.capturedAtCurrentHead ?? null,
      quotaState: payload.productionDeploymentQuota?.state || null,
      quotaRetryAtLocal:
        payload.productionDeploymentQuota?.retryAtLocal || null,
      quotaApproximateRemaining:
        payload.productionDeploymentQuota?.approximateRemaining || null,
      deployTimeout: payload.productionDeploymentQuota?.deployTimeout || null,
      deployTimeoutMs: payload.productionDeploymentQuota?.deployTimeoutMs ?? null,
      deployTimeoutEnv:
        payload.productionDeploymentQuota?.deployTimeoutEnv || null,
      liveMoneyState: payload.liveMoney?.state || null,
      liveMoneyMissingBootstrapEnvironment: Array.isArray(
        payload.liveMoney?.missingBootstrapEnvironment,
      )
        ? payload.liveMoney.missingBootstrapEnvironment
        : [],
      backupSchedulerProof: payload.emergencyBackup?.schedulerProof || null,
      backupRunwayAcceptedPosture:
        payload.backupRunway?.acceptedBackupPosture ?? null,
      backupRunwaySchedulerProofMode:
        payload.backupRunway?.schedulerProofMode || null,
      backupRunwayOperatorWatchRequired:
        payload.backupRunway?.operatorWatchRequired ?? null,
      backupRunwayNextScheduledRunAtLocal:
        payload.backupRunway?.nextScheduledRunAtLocal || null,
      backupRunwayNext: payload.backupRunway?.next || null,
      backupRunwayVerifiedArchive: payload.backupRunway?.verifiedArchive || null,
      backupRunwayComputedSha256: payload.backupRunway?.computedSha256 || null,
    };
  }

  if (key === "nextAction") {
    return {
      schema: payload.schema || null,
      selectedLane: payload.selectedLane || null,
      selectedNext: payload.next || null,
      selectedCommands: Array.isArray(payload.commands) ? payload.commands : [],
      goLiveEvidenceRefreshRequired:
        payload.goLiveEvidenceRefreshRequired ?? null,
      primaryFocus: payload.primaryRecommendation?.focus || null,
      primaryNext: payload.primaryRecommendation?.next || null,
      primaryCommands: Array.isArray(payload.primaryRecommendation?.commands)
        ? payload.primaryRecommendation.commands
        : [],
      fallbackAvailable: payload.localBuildFallback?.available ?? null,
      goLiveEvidenceOk: payload.goLiveEvidence?.ok ?? null,
      goLiveEvidenceCapturedAtCurrentHead:
        payload.goLiveEvidence?.capturedAtCurrentHead ?? null,
      quotaState: payload.productionDeploymentQuota?.state || null,
      quotaRetryAtLocal:
        payload.productionDeploymentQuota?.retryAtLocal || null,
      quotaApproximateRemaining:
        payload.productionDeploymentQuota?.approximateRemaining || null,
      deployTimeout: payload.productionDeploymentQuota?.deployTimeout || null,
      deployTimeoutMs: payload.productionDeploymentQuota?.deployTimeoutMs ?? null,
      deployTimeoutEnv:
        payload.productionDeploymentQuota?.deployTimeoutEnv || null,
      liveMoneyState: payload.liveMoney?.state || null,
      liveMoneyMissingBootstrapEnvironment: Array.isArray(
        payload.liveMoney?.missingBootstrapEnvironment,
      )
        ? payload.liveMoney.missingBootstrapEnvironment
        : [],
      backupRunwayAcceptedPosture:
        payload.backupRunway?.acceptedBackupPosture ?? null,
      backupRunwaySchedulerProofMode:
        payload.backupRunway?.schedulerProofMode || null,
      backupRunwayOperatorWatchRequired:
        payload.backupRunway?.operatorWatchRequired ?? null,
      backupRunwayNextScheduledRunAtLocal:
        payload.backupRunway?.nextScheduledRunAtLocal || null,
      backupRunwayNext: payload.backupRunway?.next || null,
      backupRunwayVerifiedArchive: payload.backupRunway?.verifiedArchive || null,
      backupRunwayComputedSha256: payload.backupRunway?.computedSha256 || null,
    };
  }

  return {
    schema: payload.schema || null,
    goLiveState: payload.goLiveReadiness?.state || null,
    blockerCount: payload.goLiveReadiness?.blockerCount ?? null,
    watchItemCount: payload.goLiveReadiness?.watchItemCount ?? null,
    quotaState: payload.productionDeploymentQuota?.state || null,
    quotaRetryAtLocal:
      payload.productionDeploymentQuota?.retryAtLocal || null,
    quotaApproximateRemaining:
      payload.productionDeploymentQuota?.approximateRemaining || null,
    deployTimeout: payload.productionDeploymentQuota?.deployTimeout || null,
    deployTimeoutMs: payload.productionDeploymentQuota?.deployTimeoutMs ?? null,
    deployTimeoutEnv:
      payload.productionDeploymentQuota?.deployTimeoutEnv || null,
    goLiveEvidenceCapturedAtCurrentHead:
      payload.goLiveEvidence?.capturedAtCurrentHead ?? null,
    goLiveEvidenceOk: payload.goLiveEvidence?.ok ?? null,
    liveMoneyState: payload.liveMoney?.state || null,
    liveMoneyMissingBootstrapEnvironment: Array.isArray(
      payload.liveMoney?.missingBootstrapEnvironment,
    )
      ? payload.liveMoney.missingBootstrapEnvironment
      : [],
    backupSchedulerProof:
      payload.emergencyBackup?.schedulerProof?.state || null,
  };
}

const gitStatusShort = runLocalGit(["status", "--short"]);
const currentHead = runLocalGit(["rev-parse", "--short", "HEAD"]) || "unknown";
const currentOriginMain =
  runLocalGit(["rev-parse", "--short", "origin/main"]) || "unknown";
const evidence = Object.fromEntries(
  sources.map((source) => [
    source.key,
    summarizeArchive(source, currentHead, currentOriginMain),
  ]),
);
const staleEvidence = Object.values(evidence)
  .filter((item) => item.archiveCount > 0 && !item.capturedAtCurrentPushedHead)
  .map((item) => item.label);
const missingEvidence = Object.values(evidence)
  .filter((item) => item.archiveCount === 0)
  .map((item) => item.label);
const gitReady = gitStatusShort === "" && currentHead === currentOriginMain;
const evidenceReady = missingEvidence.length === 0 && staleEvidence.length === 0;

const history = {
  schema: "tcos.buildBlockHistory.v1",
  generatedAt: new Date().toISOString(),
  git: {
    head: currentHead,
    originMain: currentOriginMain,
    workingTreeClean: gitStatusShort === "",
    statusShort: gitStatusShort ? gitStatusShort.split("\n") : [],
  },
  evidence,
  readiness: {
    allLatestEvidenceAtCurrentPushedHead:
      evidenceReady && gitReady,
    staleEvidence,
    missingEvidence,
    next: !gitReady
      ? "Finish, commit, and push the current working-tree changes before relying on this history as the next launch-bound handoff."
      : !evidenceReady
        ? "Run npm run prepare:go-live-evidence, then npm run prepare:build-block-checkpoint to refresh the half-hour evidence trail."
        : "Latest go-live, checkpoint, and next-action evidence are captured at the current pushed HEAD.",
  },
  safeBuildBoundary:
    "This history command is read-only. It does not approve live money, buy postage, release payouts, create Checkout, or start production deploys.",
  readOnlyGuarantee:
    "This command only reads Git state and local .codex-run evidence archives; it starts no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, or revocation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(history, null, 2));
} else {
  console.log("TCOS build-block history:");
  console.log(`- git HEAD: ${history.git.head}`);
  console.log(`- git origin/main: ${history.git.originMain}`);
  console.log(`- git working tree clean: ${history.git.workingTreeClean ? "yes" : "no"}`);
  console.log(
    `- all latest evidence at current pushed HEAD: ${
      history.readiness.allLatestEvidenceAtCurrentPushedHead ? "yes" : "no"
    }`,
  );
  console.log(`- next: ${history.readiness.next}`);

  for (const source of sources) {
    const item = history.evidence[source.key];
    console.log("");
    console.log(`${source.label}:`);
    console.log(`- archive count: ${item.archiveCount}`);
    console.log(`- latest archive: ${item.latestArchive?.filePath || "none"}`);
    console.log(
      `- captured at current pushed HEAD: ${
        item.capturedAtCurrentPushedHead ? "yes" : "no"
      }`,
    );
    if (source.key === "checkpoint") {
      console.log(`- focus: ${item.summary.focus || "not recorded"}`);
      console.log(
        `- fallback available: ${
          item.summary.localBuildFallbackAvailable ? "yes" : "no"
        }`,
      );
    }
    if (source.key === "nextAction") {
      console.log(`- selected lane: ${item.summary.selectedLane || "not recorded"}`);
      console.log(`- selected next: ${item.summary.selectedNext || "not recorded"}`);
      if (item.summary.selectedCommands?.length) {
        console.log(`- selected commands: ${item.summary.selectedCommands.join(" | ")}`);
      }
      console.log(
        `- go-live evidence refresh required: ${
          item.summary.goLiveEvidenceRefreshRequired ? "yes" : "no"
        }`,
      );
      console.log(`- primary focus: ${item.summary.primaryFocus || "not recorded"}`);
      console.log(`- primary next: ${item.summary.primaryNext || "not recorded"}`);
      if (item.summary.primaryCommands?.length) {
        console.log(`- primary commands: ${item.summary.primaryCommands.join(" | ")}`);
      }
    }
    if ("goLiveEvidenceOk" in item.summary) {
      console.log(
        `- go-live evidence ok: ${
          item.summary.goLiveEvidenceOk ? "yes" : "no"
        }`,
      );
    }
    if ("goLiveEvidenceCapturedAtCurrentHead" in item.summary) {
      console.log(
        `- go-live evidence current pushed HEAD: ${
          item.summary.goLiveEvidenceCapturedAtCurrentHead ? "yes" : "no"
        }`,
      );
    }
    console.log(`- quota state: ${item.summary.quotaState || "not recorded"}`);
    console.log(
      `- quota retry at local: ${item.summary.quotaRetryAtLocal || "not recorded"}`,
    );
    console.log(
      `- quota approximate remaining: ${
        item.summary.quotaApproximateRemaining || "not recorded"
      }`,
    );
    console.log(
      `- Vercel deploy timeout: ${item.summary.deployTimeout || "not recorded"}`,
    );
    if ("backupRunwayAcceptedPosture" in item.summary) {
      console.log(
        `- backup runway accepted posture: ${
          item.summary.backupRunwayAcceptedPosture ? "yes" : "no"
        }`,
      );
    }
    if ("backupRunwaySchedulerProofMode" in item.summary) {
      console.log(
        `- backup runway scheduler proof mode: ${
          item.summary.backupRunwaySchedulerProofMode || "not recorded"
        }`,
      );
    }
    if ("backupRunwayOperatorWatchRequired" in item.summary) {
      console.log(
        `- backup runway operator watch required: ${
          item.summary.backupRunwayOperatorWatchRequired ? "yes" : "no"
        }`,
      );
    }
    if ("backupRunwayNextScheduledRunAtLocal" in item.summary) {
      console.log(
        `- backup runway next scheduled local: ${
          item.summary.backupRunwayNextScheduledRunAtLocal || "not recorded"
        }`,
      );
    }
    if ("backupRunwayNext" in item.summary) {
      console.log(`- backup runway next: ${item.summary.backupRunwayNext || "not recorded"}`);
    }
    if ("backupRunwayVerifiedArchive" in item.summary) {
      console.log(
        `- backup runway verified archive: ${
          item.summary.backupRunwayVerifiedArchive || "not recorded"
        }`,
      );
    }
    if ("backupRunwayComputedSha256" in item.summary) {
      console.log(
        `- backup runway computed sha256: ${
          item.summary.backupRunwayComputedSha256 || "not recorded"
        }`,
      );
    }
    console.log(`- live-money state: ${item.summary.liveMoneyState || "not recorded"}`);
    if (item.summary.liveMoneyMissingBootstrapEnvironment?.length) {
      console.log(
        `- live-money missing bootstrap environment: ${item.summary.liveMoneyMissingBootstrapEnvironment.join(", ")}`,
      );
    }
  }

  console.log("");
  console.log(`Safe build boundary: ${history.safeBuildBoundary}`);
  console.log(`Read-only guarantee: ${history.readOnlyGuarantee}`);
}
