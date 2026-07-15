import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const schema = "tcos.buildBlockHistoryVerification.v1";
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "build-block-history");

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

function listHistoryArchives() {
  if (!existsSync(evidenceDir)) return [];

  return readdirSync(evidenceDir)
    .filter((name) => name.endsWith("-build-block-history.json"))
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
      knownArchives: listHistoryArchives(),
    };
  }

  const archives = listHistoryArchives();
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
  check(Boolean(archivePath), "build-block history archive selected"),
  check(
    Boolean(archivePath && existsSync(archivePath)),
    "build-block history archive exists",
    archivePath,
  ),
];

let payload = null;
let parseError = null;
if (archivePath && existsSync(archivePath)) {
  try {
    payload = JSON.parse(readFileSync(archivePath, "utf8"));
    checks.push(check(true, "build-block history JSON parses"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    checks.push(check(false, "build-block history JSON parses", parseError));
  }
}

if (payload) {
  const evidence = payload.evidence || {};
  const readiness = payload.readiness || {};

  checks.push(check(payload.schema === "tcos.buildBlockHistory.v1", "history schema"));
  checks.push(check(Boolean(payload.generatedAt), "history generatedAt"));
  checks.push(check(payload.git?.workingTreeClean === true, "history git payload is clean"));
  checks.push(check(payload.git?.head === currentHead, "history git head matches current HEAD", payload.git?.head));
  checks.push(
    check(
      payload.git?.originMain === currentOriginMain,
      "history origin/main matches current origin/main",
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
      payload.archive?.command === "npm --silent run status:build-block-history:json",
      "archive source command matches",
      payload.archive?.command,
    ),
  );
  checks.push(
    check(
      readiness.allLatestEvidenceAtCurrentPushedHead === true,
      "history says all latest evidence is current",
      readiness.next || null,
    ),
  );
  checks.push(check((readiness.staleEvidence || []).length === 0, "history has no stale evidence"));
  checks.push(check((readiness.missingEvidence || []).length === 0, "history has no missing evidence"));
  checks.push(
    check(
      evidence.checkpoint?.capturedAtCurrentPushedHead === true,
      "checkpoint archive captured current pushed HEAD",
    ),
  );
  checks.push(
    check(
      evidence.nextAction?.capturedAtCurrentPushedHead === true,
      "next-action archive captured current pushed HEAD",
    ),
  );
  checks.push(
    check(
      evidence.goLiveRunway?.capturedAtCurrentPushedHead === true,
      "go-live runway archive captured current pushed HEAD",
    ),
  );
  checks.push(
    check(
      Boolean(evidence.checkpoint?.summary?.quotaApproximateRemaining),
      "history checkpoint quota approximate remaining is recorded",
      evidence.checkpoint?.summary?.quotaApproximateRemaining || null,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.nextAction?.summary?.quotaApproximateRemaining),
      "history next-action quota approximate remaining is recorded",
      evidence.nextAction?.summary?.quotaApproximateRemaining || null,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.nextAction?.summary?.selectedNext),
      "history next-action selected fallback next step is recorded",
      evidence.nextAction?.summary?.selectedNext || null,
    ),
  );
  checks.push(
    check(
      Array.isArray(evidence.nextAction?.summary?.selectedCommands) &&
        evidence.nextAction.summary.selectedCommands.length > 0,
      "history next-action selected fallback commands are recorded",
      Array.isArray(evidence.nextAction?.summary?.selectedCommands)
        ? evidence.nextAction.summary.selectedCommands.join(" | ")
        : null,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.nextAction?.summary?.primaryNext),
      "history next-action primary unblock next step is recorded",
      evidence.nextAction?.summary?.primaryNext || null,
    ),
  );
  checks.push(
    check(
      Array.isArray(evidence.nextAction?.summary?.primaryCommands) &&
        evidence.nextAction.summary.primaryCommands.length > 0,
      "history next-action primary unblock commands are recorded",
      Array.isArray(evidence.nextAction?.summary?.primaryCommands)
        ? evidence.nextAction.summary.primaryCommands.join(" | ")
        : null,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.goLiveRunway?.summary?.quotaApproximateRemaining),
      "history runway quota approximate remaining is recorded",
      evidence.goLiveRunway?.summary?.quotaApproximateRemaining || null,
    ),
  );
  checks.push(
    check(
      evidence.checkpoint?.summary?.goLiveEvidenceOk === true,
      "history checkpoint go-live evidence verifier is ok",
      evidence.checkpoint?.summary?.goLiveEvidenceOk,
    ),
  );
  checks.push(
    check(
      evidence.checkpoint?.summary?.goLiveEvidenceCapturedAtCurrentHead === true,
      "history checkpoint go-live evidence captured current pushed HEAD",
      evidence.checkpoint?.summary?.goLiveEvidenceCapturedAtCurrentHead,
    ),
  );
  checks.push(
    check(
      evidence.nextAction?.summary?.goLiveEvidenceOk === true,
      "history next-action go-live evidence verifier is ok",
      evidence.nextAction?.summary?.goLiveEvidenceOk,
    ),
  );
  checks.push(
    check(
      evidence.nextAction?.summary?.goLiveEvidenceCapturedAtCurrentHead === true,
      "history next-action go-live evidence captured current pushed HEAD",
      evidence.nextAction?.summary?.goLiveEvidenceCapturedAtCurrentHead,
    ),
  );
  checks.push(
    check(
      evidence.goLiveRunway?.summary?.goLiveEvidenceOk === true,
      "history runway go-live evidence verifier is ok",
      evidence.goLiveRunway?.summary?.goLiveEvidenceOk,
    ),
  );
  checks.push(
    check(
      evidence.goLiveRunway?.summary?.goLiveEvidenceCapturedAtCurrentHead === true,
      "history runway go-live evidence captured current pushed HEAD",
      evidence.goLiveRunway?.summary?.goLiveEvidenceCapturedAtCurrentHead,
    ),
  );
  checks.push(
    check(
      evidence.checkpoint?.summary?.backupRunwayAcceptedPosture === true,
      "history checkpoint backup runway accepted posture",
      evidence.checkpoint?.summary?.backupRunwayAcceptedPosture,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.checkpoint?.summary?.backupRunwaySchedulerProofMode),
      "history checkpoint backup runway scheduler proof mode",
      evidence.checkpoint?.summary?.backupRunwaySchedulerProofMode || null,
    ),
  );
  checks.push(
    check(
      typeof evidence.checkpoint?.summary?.backupRunwayOperatorWatchRequired === "boolean",
      "history checkpoint backup runway operator-watch flag",
      evidence.checkpoint?.summary?.backupRunwayOperatorWatchRequired,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.checkpoint?.summary?.backupRunwayNext),
      "history checkpoint backup runway next action",
      evidence.checkpoint?.summary?.backupRunwayNext || null,
    ),
  );
  checks.push(
    check(
      evidence.nextAction?.summary?.backupRunwayAcceptedPosture === true,
      "history next-action backup runway accepted posture",
      evidence.nextAction?.summary?.backupRunwayAcceptedPosture,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.nextAction?.summary?.backupRunwaySchedulerProofMode),
      "history next-action backup runway scheduler proof mode",
      evidence.nextAction?.summary?.backupRunwaySchedulerProofMode || null,
    ),
  );
  checks.push(
    check(
      typeof evidence.nextAction?.summary?.backupRunwayOperatorWatchRequired === "boolean",
      "history next-action backup runway operator-watch flag",
      evidence.nextAction?.summary?.backupRunwayOperatorWatchRequired,
    ),
  );
  checks.push(
    check(
      Boolean(evidence.nextAction?.summary?.backupRunwayNext),
      "history next-action backup runway next action",
      evidence.nextAction?.summary?.backupRunwayNext || null,
    ),
  );
  checks.push(
    check(
      evidence.checkpoint?.summary?.localBuildFallbackAvailable === true,
      "history preserves local build fallback availability",
    ),
  );
  checks.push(
    check(
      evidence.nextAction?.summary?.selectedLane === "local_build_fallback",
      "history preserves selected local fallback lane",
      evidence.nextAction?.summary?.selectedLane || null,
    ),
  );
  checks.push(
    check(
      evidence.goLiveRunway?.summary?.quotaState === "blocked" ||
        evidence.goLiveRunway?.summary?.quotaState === "open",
      "history records quota state",
      evidence.goLiveRunway?.summary?.quotaState || null,
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
      "history read-only guarantee preserves side-effect limits",
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
  history: payload
    ? {
        schema: payload.schema || null,
        generatedAt: payload.generatedAt || null,
        allLatestEvidenceAtCurrentPushedHead:
          payload.readiness?.allLatestEvidenceAtCurrentPushedHead ?? null,
        staleEvidence: payload.readiness?.staleEvidence || [],
        missingEvidence: payload.readiness?.missingEvidence || [],
        next: payload.readiness?.next || null,
        checkpointArchive: payload.evidence?.checkpoint?.latestArchive?.filePath || null,
        nextActionArchive: payload.evidence?.nextAction?.latestArchive?.filePath || null,
        goLiveRunwayArchive: payload.evidence?.goLiveRunway?.latestArchive?.filePath || null,
        checkpointQuotaApproximateRemaining:
          payload.evidence?.checkpoint?.summary?.quotaApproximateRemaining || null,
        nextActionQuotaApproximateRemaining:
          payload.evidence?.nextAction?.summary?.quotaApproximateRemaining || null,
        nextActionSelectedNext:
          payload.evidence?.nextAction?.summary?.selectedNext || null,
        nextActionSelectedCommands:
          payload.evidence?.nextAction?.summary?.selectedCommands || [],
        nextActionPrimaryNext:
          payload.evidence?.nextAction?.summary?.primaryNext || null,
        nextActionPrimaryCommands:
          payload.evidence?.nextAction?.summary?.primaryCommands || [],
        runwayQuotaApproximateRemaining:
          payload.evidence?.goLiveRunway?.summary?.quotaApproximateRemaining || null,
        checkpointGoLiveEvidenceOk:
          payload.evidence?.checkpoint?.summary?.goLiveEvidenceOk ?? null,
        checkpointGoLiveEvidenceCurrent:
          payload.evidence?.checkpoint?.summary
            ?.goLiveEvidenceCapturedAtCurrentHead ?? null,
        nextActionGoLiveEvidenceOk:
          payload.evidence?.nextAction?.summary?.goLiveEvidenceOk ?? null,
        nextActionGoLiveEvidenceCurrent:
          payload.evidence?.nextAction?.summary
            ?.goLiveEvidenceCapturedAtCurrentHead ?? null,
        checkpointBackupRunwayAcceptedPosture:
          payload.evidence?.checkpoint?.summary?.backupRunwayAcceptedPosture ?? null,
        checkpointBackupRunwaySchedulerProofMode:
          payload.evidence?.checkpoint?.summary?.backupRunwaySchedulerProofMode || null,
        checkpointBackupRunwayOperatorWatchRequired:
          payload.evidence?.checkpoint?.summary?.backupRunwayOperatorWatchRequired ?? null,
        checkpointBackupRunwayNext:
          payload.evidence?.checkpoint?.summary?.backupRunwayNext || null,
        nextActionBackupRunwayAcceptedPosture:
          payload.evidence?.nextAction?.summary?.backupRunwayAcceptedPosture ?? null,
        nextActionBackupRunwaySchedulerProofMode:
          payload.evidence?.nextAction?.summary?.backupRunwaySchedulerProofMode || null,
        nextActionBackupRunwayOperatorWatchRequired:
          payload.evidence?.nextAction?.summary?.backupRunwayOperatorWatchRequired ?? null,
        nextActionBackupRunwayNext:
          payload.evidence?.nextAction?.summary?.backupRunwayNext || null,
        runwayGoLiveEvidenceOk:
          payload.evidence?.goLiveRunway?.summary?.goLiveEvidenceOk ?? null,
        runwayGoLiveEvidenceCurrent:
          payload.evidence?.goLiveRunway?.summary
            ?.goLiveEvidenceCapturedAtCurrentHead ?? null,
        selectedLane: payload.evidence?.nextAction?.summary?.selectedLane || null,
        checkpointFocus: payload.evidence?.checkpoint?.summary?.focus || null,
        quotaState: payload.evidence?.goLiveRunway?.summary?.quotaState || null,
        liveMoneyState: payload.evidence?.goLiveRunway?.summary?.liveMoneyState || null,
      }
    : null,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads Git state and the latest build-block history archive; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(verification, null, 2));
} else {
  console.log("TCOS build-block history verification:");
  console.log(`- evidence folder: ${evidenceDir}`);
  console.log(`- selected by: ${verification.selectedBy}`);
  console.log(`- archive: ${archivePath || "none"}`);
  console.log(`- archive count: ${verification.archiveCount}`);
  console.log(`- git HEAD: ${verification.git.head}`);
  console.log(`- git origin/main: ${verification.git.originMain}`);
  console.log(`- git working tree clean: ${verification.git.workingTreeClean ? "yes" : "no"}`);
  console.log(
    `- all latest evidence current: ${
      verification.history?.allLatestEvidenceAtCurrentPushedHead ? "yes" : "no"
    }`,
  );
  console.log(`- selected lane: ${verification.history?.selectedLane || "not recorded"}`);
  console.log(`- checkpoint focus: ${verification.history?.checkpointFocus || "not recorded"}`);
  console.log(
    `- checkpoint quota approximate remaining: ${
      verification.history?.checkpointQuotaApproximateRemaining || "not recorded"
    }`,
  );
  console.log(
    `- next-action quota approximate remaining: ${
      verification.history?.nextActionQuotaApproximateRemaining || "not recorded"
    }`,
  );
  console.log(
    `- next-action selected next: ${
      verification.history?.nextActionSelectedNext || "not recorded"
    }`,
  );
  if (verification.history?.nextActionSelectedCommands?.length) {
    console.log(
      `- next-action selected commands: ${verification.history.nextActionSelectedCommands.join(" | ")}`,
    );
  }
  console.log(
    `- next-action primary next: ${
      verification.history?.nextActionPrimaryNext || "not recorded"
    }`,
  );
  if (verification.history?.nextActionPrimaryCommands?.length) {
    console.log(
      `- next-action primary commands: ${verification.history.nextActionPrimaryCommands.join(" | ")}`,
    );
  }
  console.log(
    `- runway quota approximate remaining: ${
      verification.history?.runwayQuotaApproximateRemaining || "not recorded"
    }`,
  );
  console.log(
    `- checkpoint go-live evidence ok: ${
      verification.history?.checkpointGoLiveEvidenceOk ? "yes" : "no"
    }`,
  );
  console.log(
    `- checkpoint go-live evidence current pushed HEAD: ${
      verification.history?.checkpointGoLiveEvidenceCurrent ? "yes" : "no"
    }`,
  );
  console.log(
    `- next-action go-live evidence ok: ${
      verification.history?.nextActionGoLiveEvidenceOk ? "yes" : "no"
    }`,
  );
  console.log(
    `- next-action go-live evidence current pushed HEAD: ${
      verification.history?.nextActionGoLiveEvidenceCurrent ? "yes" : "no"
    }`,
  );
  console.log(
    `- checkpoint backup runway accepted posture: ${
      verification.history?.checkpointBackupRunwayAcceptedPosture ? "yes" : "no"
    }`,
  );
  console.log(
    `- checkpoint backup runway scheduler proof mode: ${
      verification.history?.checkpointBackupRunwaySchedulerProofMode || "not recorded"
    }`,
  );
  console.log(
    `- checkpoint backup runway operator watch required: ${
      verification.history?.checkpointBackupRunwayOperatorWatchRequired ? "yes" : "no"
    }`,
  );
  console.log(
    `- checkpoint backup runway next: ${
      verification.history?.checkpointBackupRunwayNext || "not recorded"
    }`,
  );
  console.log(
    `- next-action backup runway accepted posture: ${
      verification.history?.nextActionBackupRunwayAcceptedPosture ? "yes" : "no"
    }`,
  );
  console.log(
    `- next-action backup runway scheduler proof mode: ${
      verification.history?.nextActionBackupRunwaySchedulerProofMode || "not recorded"
    }`,
  );
  console.log(
    `- next-action backup runway operator watch required: ${
      verification.history?.nextActionBackupRunwayOperatorWatchRequired ? "yes" : "no"
    }`,
  );
  console.log(
    `- next-action backup runway next: ${
      verification.history?.nextActionBackupRunwayNext || "not recorded"
    }`,
  );
  console.log(
    `- runway go-live evidence ok: ${
      verification.history?.runwayGoLiveEvidenceOk ? "yes" : "no"
    }`,
  );
  console.log(
    `- runway go-live evidence current pushed HEAD: ${
      verification.history?.runwayGoLiveEvidenceCurrent ? "yes" : "no"
    }`,
  );
  console.log(`- quota state: ${verification.history?.quotaState || "not recorded"}`);
  console.log(`- live-money state: ${verification.history?.liveMoneyState || "not recorded"}`);
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
