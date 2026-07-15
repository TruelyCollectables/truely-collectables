import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const schema = "tcos.nextBuildBlockActionVerification.v1";
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "next-build-block-action");

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

function listActionArchives() {
  if (!existsSync(evidenceDir)) return [];

  return readdirSync(evidenceDir)
    .filter((name) => name.endsWith("-next-build-block-action.json"))
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
      knownArchives: listActionArchives(),
    };
  }

  const archives = listActionArchives();
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
  check(Boolean(archivePath), "next build-block action archive selected"),
  check(
    Boolean(archivePath && existsSync(archivePath)),
    "next build-block action archive exists",
    archivePath,
  ),
];

let payload = null;
let parseError = null;
if (archivePath && existsSync(archivePath)) {
  try {
    payload = JSON.parse(readFileSync(archivePath, "utf8"));
    checks.push(check(true, "next build-block action JSON parses"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    checks.push(check(false, "next build-block action JSON parses", parseError));
  }
}

if (payload) {
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  const primaryCommands = Array.isArray(payload.primaryRecommendation?.commands)
    ? payload.primaryRecommendation.commands
    : [];
  checks.push(check(payload.schema === "tcos.nextBuildBlockAction.v1", "next-action schema"));
  checks.push(
    check(
      payload.sourceSchema === "tcos.buildBlockCheckpoint.v1",
      "next-action source schema",
    ),
  );
  checks.push(check(Boolean(payload.generatedAt), "next-action generatedAt"));
  checks.push(
    check(
      ["local_build_fallback", "primary_recommendation"].includes(payload.selectedLane),
      "selected lane is recognized",
      payload.selectedLane,
    ),
  );
  checks.push(check(Boolean(payload.selectedReason), "selected reason exists"));
  checks.push(check(Boolean(payload.next), "selected next step exists"));
  checks.push(check(commands.length > 0, "selected commands exist"));
  checks.push(check(Boolean(payload.primaryRecommendation?.focus), "primary focus exists"));
  checks.push(check(Boolean(payload.primaryRecommendation?.next), "primary next step exists"));
  checks.push(check(primaryCommands.length > 0, "primary commands exist"));
  checks.push(
    check(
      typeof payload.localBuildFallback?.available === "boolean",
      "fallback availability is recorded",
    ),
  );
  checks.push(check(Boolean(payload.localBuildFallback?.reason), "fallback reason exists"));
  if (payload.selectedLane === "local_build_fallback") {
    checks.push(
      check(
        payload.localBuildFallback?.available === true,
        "fallback lane is available when selected",
      ),
    );
    checks.push(
      check(
        commands.includes("npm run prepare:build-block-checkpoint"),
        "fallback selection preserves checkpoint handoff command",
      ),
    );
    checks.push(
      check(
        payload.next?.includes("keep live money/postage/payout/Checkout/deploy paths gated"),
        "fallback selection preserves live-money/postage/deploy gates",
        payload.next || null,
      ),
    );
  }
  checks.push(check(payload.git?.workingTreeClean === true, "next-action git payload is clean"));
  checks.push(check(payload.git?.head === currentHead, "next-action git head matches current HEAD", payload.git?.head));
  checks.push(
    check(
      payload.git?.originMain === currentOriginMain,
      "next-action origin/main matches current origin/main",
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
      payload.archive?.command === "npm --silent run next:build-block:json",
      "archive source command matches",
      payload.archive?.command,
    ),
  );
  checks.push(
    check(
      typeof payload.goLiveEvidence?.available === "boolean",
      "next-action go-live evidence availability is recorded",
      payload.goLiveEvidence?.available,
    ),
  );
  checks.push(
    check(
      payload.goLiveEvidence?.ok === true,
      "next-action go-live evidence verifier is ok",
      payload.goLiveEvidence?.ok,
    ),
  );
  checks.push(
    check(
      payload.goLiveEvidence?.capturedAtCurrentHead === true,
      "next-action go-live evidence captured current pushed HEAD",
      payload.goLiveEvidence?.capturedAtCurrentHead,
    ),
  );
  checks.push(
    check(
      payload.productionDeploymentQuota?.vercelUploadStarted === false,
      "next-action confirms no Vercel upload started",
      payload.productionDeploymentQuota?.vercelUploadStarted,
    ),
  );
  checks.push(
    check(
      Boolean(payload.productionDeploymentQuota?.approximateRemaining),
      "next-action quota approximate remaining is recorded",
      payload.productionDeploymentQuota?.approximateRemaining || null,
    ),
  );
  checks.push(
    check(
      payload.backupRunway?.schema === "tcos.backupRunwayStatus.v1",
      "next-action backup runway schema",
      payload.backupRunway?.schema || null,
    ),
  );
  checks.push(
    check(
      payload.backupRunway?.acceptedBackupPosture === true,
      "next-action backup runway accepted posture",
      payload.backupRunway?.acceptedBackupPosture,
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.schedulerProofMode),
      "next-action backup runway scheduler proof mode",
      payload.backupRunway?.schedulerProofMode || null,
    ),
  );
  checks.push(
    check(
      typeof payload.backupRunway?.operatorWatchRequired === "boolean",
      "next-action backup runway operator-watch flag",
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.verifiedArchive),
      "next-action backup runway records verified archive",
      payload.backupRunway?.verifiedArchive || null,
    ),
  );
  checks.push(
    check(
      Boolean(payload.backupRunway?.computedSha256),
      "next-action backup runway records computed SHA-256",
      payload.backupRunway?.computedSha256 || null,
    ),
  );
  checks.push(check(Boolean(payload.liveMoney?.state), "live-money state is recorded"));
  checks.push(
    check(
      Array.isArray(payload.liveMoney?.missingBootstrapEnvironment),
      "missing bootstrap environment list exists",
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
      "next-action read-only guarantee preserves side-effect limits",
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
  nextAction: payload
    ? {
        schema: payload.schema || null,
        generatedAt: payload.generatedAt || null,
        selectedLane: payload.selectedLane || null,
        selectedReason: payload.selectedReason || null,
        next: payload.next || null,
        commands: payload.commands || [],
        primaryFocus: payload.primaryRecommendation?.focus || null,
        primaryNext: payload.primaryRecommendation?.next || null,
        primaryCommands: payload.primaryRecommendation?.commands || [],
        fallbackAvailable: payload.localBuildFallback?.available ?? null,
        goLiveState: payload.goLiveReadiness?.state || null,
        blockerCount: payload.goLiveReadiness?.blockerCount ?? null,
        goLiveEvidence: payload.goLiveEvidence || null,
        quotaState: payload.productionDeploymentQuota?.state || null,
        quotaRetryAtLocal: payload.productionDeploymentQuota?.retryAtLocal || null,
        quotaApproximateRemaining:
          payload.productionDeploymentQuota?.approximateRemaining || null,
        backupRunway: payload.backupRunway || null,
        liveMoneyState: payload.liveMoney?.state || null,
      }
    : null,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads Git state and the latest next build-block action archive; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(verification, null, 2));
} else {
  console.log("TCOS next build-block action verification:");
  console.log(`- evidence folder: ${evidenceDir}`);
  console.log(`- selected by: ${verification.selectedBy}`);
  console.log(`- archive: ${archivePath || "none"}`);
  console.log(`- archive count: ${verification.archiveCount}`);
  console.log(`- git HEAD: ${verification.git.head}`);
  console.log(`- git origin/main: ${verification.git.originMain}`);
  console.log(`- git working tree clean: ${verification.git.workingTreeClean ? "yes" : "no"}`);
  console.log(`- selected lane: ${verification.nextAction?.selectedLane || "not recorded"}`);
  console.log(`- selected reason: ${verification.nextAction?.selectedReason || "not recorded"}`);
  console.log(`- next: ${verification.nextAction?.next || "not recorded"}`);
  if (verification.nextAction?.commands?.length) {
    console.log(`- commands: ${verification.nextAction.commands.join(" | ")}`);
  }
  console.log(`- primary focus: ${verification.nextAction?.primaryFocus || "not recorded"}`);
  console.log(`- primary next: ${verification.nextAction?.primaryNext || "not recorded"}`);
  if (verification.nextAction?.primaryCommands?.length) {
    console.log(
      `- primary commands: ${verification.nextAction.primaryCommands.join(" | ")}`,
    );
  }
  console.log(
    `- fallback available: ${
      verification.nextAction?.fallbackAvailable ? "yes" : "no"
    }`,
  );
  console.log(`- go-live state: ${verification.nextAction?.goLiveState || "not recorded"}`);
  console.log(
    `- go-live evidence ok: ${
      verification.nextAction?.goLiveEvidence?.ok ? "yes" : "no"
    }`,
  );
  console.log(
    `- go-live evidence current pushed HEAD: ${
      verification.nextAction?.goLiveEvidence?.capturedAtCurrentHead ? "yes" : "no"
    }`,
  );
  console.log(`- quota state: ${verification.nextAction?.quotaState || "not recorded"}`);
  console.log(
    `- quota retry at local: ${verification.nextAction?.quotaRetryAtLocal || "not recorded"}`,
  );
  console.log(
    `- quota approximate remaining: ${
      verification.nextAction?.quotaApproximateRemaining || "not recorded"
    }`,
  );
  console.log(
    `- backup runway accepted posture: ${
      verification.nextAction?.backupRunway?.acceptedBackupPosture ? "yes" : "no"
    }`,
  );
  console.log(
    `- backup runway scheduler proof mode: ${
      verification.nextAction?.backupRunway?.schedulerProofMode || "not recorded"
    }`,
  );
  console.log(
    `- backup runway operator watch required: ${
      verification.nextAction?.backupRunway?.operatorWatchRequired ? "yes" : "no"
    }`,
  );
  console.log(`- live-money state: ${verification.nextAction?.liveMoneyState || "not recorded"}`);
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
