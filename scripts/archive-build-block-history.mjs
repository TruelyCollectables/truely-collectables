import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "build-block-history");
const commandText = "npm --silent run status:build-block-history:json";

function runLocalGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : null;
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
      `Could not parse status:build-block-history:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.buildBlockHistory.v1") missing.push("schema");
  if (!payload?.generatedAt) missing.push("generatedAt");
  if (!payload?.git?.head) missing.push("git.head");
  if (!payload?.git?.originMain) missing.push("git.originMain");
  if (typeof payload?.git?.workingTreeClean !== "boolean") {
    missing.push("git.workingTreeClean");
  }
  if (!payload?.evidence?.checkpoint?.latestArchive) {
    missing.push("evidence.checkpoint.latestArchive");
  }
  if (!payload?.evidence?.nextAction?.latestArchive) {
    missing.push("evidence.nextAction.latestArchive");
  }
  if (!payload?.evidence?.goLiveRunway?.latestArchive) {
    missing.push("evidence.goLiveRunway.latestArchive");
  }
  if (!payload?.evidence?.checkpoint?.summary?.quotaApproximateRemaining) {
    missing.push("evidence.checkpoint.summary.quotaApproximateRemaining");
  }
  if (!payload?.evidence?.nextAction?.summary?.quotaApproximateRemaining) {
    missing.push("evidence.nextAction.summary.quotaApproximateRemaining");
  }
  if (!payload?.evidence?.nextAction?.summary?.selectedNext) {
    missing.push("evidence.nextAction.summary.selectedNext");
  }
  if (!Array.isArray(payload?.evidence?.nextAction?.summary?.selectedCommands)) {
    missing.push("evidence.nextAction.summary.selectedCommands");
  }
  if (!payload?.evidence?.nextAction?.summary?.primaryNext) {
    missing.push("evidence.nextAction.summary.primaryNext");
  }
  if (!Array.isArray(payload?.evidence?.nextAction?.summary?.primaryCommands)) {
    missing.push("evidence.nextAction.summary.primaryCommands");
  }
  if (!payload?.evidence?.goLiveRunway?.summary?.quotaApproximateRemaining) {
    missing.push("evidence.goLiveRunway.summary.quotaApproximateRemaining");
  }
  if (typeof payload?.evidence?.checkpoint?.summary?.goLiveEvidenceOk !== "boolean") {
    missing.push("evidence.checkpoint.summary.goLiveEvidenceOk");
  }
  if (
    typeof payload?.evidence?.checkpoint?.summary
      ?.goLiveEvidenceCapturedAtCurrentHead !== "boolean"
  ) {
    missing.push("evidence.checkpoint.summary.goLiveEvidenceCapturedAtCurrentHead");
  }
  if (typeof payload?.evidence?.nextAction?.summary?.goLiveEvidenceOk !== "boolean") {
    missing.push("evidence.nextAction.summary.goLiveEvidenceOk");
  }
  if (
    typeof payload?.evidence?.nextAction?.summary
      ?.goLiveEvidenceCapturedAtCurrentHead !== "boolean"
  ) {
    missing.push("evidence.nextAction.summary.goLiveEvidenceCapturedAtCurrentHead");
  }
  if (typeof payload?.evidence?.goLiveRunway?.summary?.goLiveEvidenceOk !== "boolean") {
    missing.push("evidence.goLiveRunway.summary.goLiveEvidenceOk");
  }
  if (
    typeof payload?.evidence?.goLiveRunway?.summary
      ?.goLiveEvidenceCapturedAtCurrentHead !== "boolean"
  ) {
    missing.push("evidence.goLiveRunway.summary.goLiveEvidenceCapturedAtCurrentHead");
  }
  if (
    typeof payload?.evidence?.checkpoint?.summary
      ?.backupRunwayAcceptedPosture !== "boolean"
  ) {
    missing.push("evidence.checkpoint.summary.backupRunwayAcceptedPosture");
  }
  if (
    !Array.isArray(
      payload?.evidence?.checkpoint?.summary?.liveMoneyMissingBootstrapEnvironment,
    )
  ) {
    missing.push("evidence.checkpoint.summary.liveMoneyMissingBootstrapEnvironment");
  }
  if (!payload?.evidence?.checkpoint?.summary?.backupRunwaySchedulerProofMode) {
    missing.push("evidence.checkpoint.summary.backupRunwaySchedulerProofMode");
  }
  if (
    typeof payload?.evidence?.checkpoint?.summary
      ?.backupRunwayOperatorWatchRequired !== "boolean"
  ) {
    missing.push("evidence.checkpoint.summary.backupRunwayOperatorWatchRequired");
  }
  if (!payload?.evidence?.checkpoint?.summary?.backupRunwayNext) {
    missing.push("evidence.checkpoint.summary.backupRunwayNext");
  }
  if (!payload?.evidence?.checkpoint?.summary?.backupRunwayVerifiedArchive) {
    missing.push("evidence.checkpoint.summary.backupRunwayVerifiedArchive");
  }
  if (!payload?.evidence?.checkpoint?.summary?.backupRunwayComputedSha256) {
    missing.push("evidence.checkpoint.summary.backupRunwayComputedSha256");
  }
  if (
    typeof payload?.evidence?.nextAction?.summary
      ?.backupRunwayAcceptedPosture !== "boolean"
  ) {
    missing.push("evidence.nextAction.summary.backupRunwayAcceptedPosture");
  }
  if (
    !Array.isArray(
      payload?.evidence?.nextAction?.summary?.liveMoneyMissingBootstrapEnvironment,
    )
  ) {
    missing.push("evidence.nextAction.summary.liveMoneyMissingBootstrapEnvironment");
  }
  if (!payload?.evidence?.nextAction?.summary?.backupRunwaySchedulerProofMode) {
    missing.push("evidence.nextAction.summary.backupRunwaySchedulerProofMode");
  }
  if (
    typeof payload?.evidence?.nextAction?.summary
      ?.backupRunwayOperatorWatchRequired !== "boolean"
  ) {
    missing.push("evidence.nextAction.summary.backupRunwayOperatorWatchRequired");
  }
  if (!payload?.evidence?.nextAction?.summary?.backupRunwayNext) {
    missing.push("evidence.nextAction.summary.backupRunwayNext");
  }
  if (!payload?.evidence?.nextAction?.summary?.backupRunwayVerifiedArchive) {
    missing.push("evidence.nextAction.summary.backupRunwayVerifiedArchive");
  }
  if (!payload?.evidence?.nextAction?.summary?.backupRunwayComputedSha256) {
    missing.push("evidence.nextAction.summary.backupRunwayComputedSha256");
  }
  if (
    !Array.isArray(
      payload?.evidence?.goLiveRunway?.summary?.liveMoneyMissingBootstrapEnvironment,
    )
  ) {
    missing.push("evidence.goLiveRunway.summary.liveMoneyMissingBootstrapEnvironment");
  }
  if (typeof payload?.readiness?.allLatestEvidenceAtCurrentPushedHead !== "boolean") {
    missing.push("readiness.allLatestEvidenceAtCurrentPushedHead");
  }
  if (!Array.isArray(payload?.readiness?.staleEvidence)) {
    missing.push("readiness.staleEvidence");
  }
  if (!Array.isArray(payload?.readiness?.missingEvidence)) {
    missing.push("readiness.missingEvidence");
  }
  if (!payload?.readiness?.next) missing.push("readiness.next");
  if (!payload?.safeBuildBoundary) missing.push("safeBuildBoundary");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");

  if (missing.length) {
    throw new Error(
      `Build-block history JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "status:build-block-history:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-build-block-history.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Build-block history evidence archived:");
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
console.log(
  `- all latest evidence at current pushed HEAD: ${
    payload.readiness.allLatestEvidenceAtCurrentPushedHead ? "yes" : "no"
  }`,
);
console.log(`- next: ${payload.readiness.next}`);
console.log(`- checkpoint archive count: ${payload.evidence.checkpoint.archiveCount}`);
console.log(
  `- checkpoint captured current HEAD: ${
    payload.evidence.checkpoint.capturedAtCurrentPushedHead ? "yes" : "no"
  }`,
);
console.log(
  `- checkpoint quota approximate remaining: ${
    payload.evidence.checkpoint.summary.quotaApproximateRemaining
  }`,
);
console.log(
  `- checkpoint go-live evidence ok: ${
    payload.evidence.checkpoint.summary.goLiveEvidenceOk ? "yes" : "no"
  }`,
);
console.log(
  `- checkpoint go-live evidence current pushed HEAD: ${
    payload.evidence.checkpoint.summary.goLiveEvidenceCapturedAtCurrentHead ? "yes" : "no"
  }`,
);
console.log(
  `- checkpoint backup runway accepted posture: ${
    payload.evidence.checkpoint.summary.backupRunwayAcceptedPosture ? "yes" : "no"
  }`,
);
console.log(
  `- checkpoint backup runway scheduler proof mode: ${
    payload.evidence.checkpoint.summary.backupRunwaySchedulerProofMode
  }`,
);
console.log(
  `- checkpoint backup runway operator watch required: ${
    payload.evidence.checkpoint.summary.backupRunwayOperatorWatchRequired ? "yes" : "no"
  }`,
);
console.log(`- checkpoint backup runway next: ${payload.evidence.checkpoint.summary.backupRunwayNext}`);
console.log(
  `- checkpoint backup runway verified archive: ${payload.evidence.checkpoint.summary.backupRunwayVerifiedArchive}`,
);
console.log(
  `- checkpoint backup runway computed sha256: ${payload.evidence.checkpoint.summary.backupRunwayComputedSha256}`,
);
if (payload.evidence.checkpoint.summary.liveMoneyMissingBootstrapEnvironment.length) {
  console.log(
    `- checkpoint live-money missing bootstrap environment: ${payload.evidence.checkpoint.summary.liveMoneyMissingBootstrapEnvironment.join(", ")}`,
  );
}
console.log(`- next-action archive count: ${payload.evidence.nextAction.archiveCount}`);
console.log(
  `- next-action captured current HEAD: ${
    payload.evidence.nextAction.capturedAtCurrentPushedHead ? "yes" : "no"
  }`,
);
console.log(
  `- next-action quota approximate remaining: ${
    payload.evidence.nextAction.summary.quotaApproximateRemaining
  }`,
);
console.log(`- next-action selected next: ${payload.evidence.nextAction.summary.selectedNext}`);
if (payload.evidence.nextAction.summary.selectedCommands.length) {
  console.log(
    `- next-action selected commands: ${payload.evidence.nextAction.summary.selectedCommands.join(" | ")}`,
  );
}
console.log(`- next-action primary next: ${payload.evidence.nextAction.summary.primaryNext}`);
if (payload.evidence.nextAction.summary.primaryCommands.length) {
  console.log(
    `- next-action primary commands: ${payload.evidence.nextAction.summary.primaryCommands.join(" | ")}`,
  );
}
console.log(
  `- next-action go-live evidence ok: ${
    payload.evidence.nextAction.summary.goLiveEvidenceOk ? "yes" : "no"
  }`,
);
console.log(
  `- next-action go-live evidence current pushed HEAD: ${
    payload.evidence.nextAction.summary.goLiveEvidenceCapturedAtCurrentHead ? "yes" : "no"
  }`,
);
console.log(
  `- next-action backup runway accepted posture: ${
    payload.evidence.nextAction.summary.backupRunwayAcceptedPosture ? "yes" : "no"
  }`,
);
console.log(
  `- next-action backup runway scheduler proof mode: ${
    payload.evidence.nextAction.summary.backupRunwaySchedulerProofMode
  }`,
);
console.log(
  `- next-action backup runway operator watch required: ${
    payload.evidence.nextAction.summary.backupRunwayOperatorWatchRequired ? "yes" : "no"
  }`,
);
console.log(`- next-action backup runway next: ${payload.evidence.nextAction.summary.backupRunwayNext}`);
console.log(
  `- next-action backup runway verified archive: ${payload.evidence.nextAction.summary.backupRunwayVerifiedArchive}`,
);
console.log(
  `- next-action backup runway computed sha256: ${payload.evidence.nextAction.summary.backupRunwayComputedSha256}`,
);
if (payload.evidence.nextAction.summary.liveMoneyMissingBootstrapEnvironment.length) {
  console.log(
    `- next-action live-money missing bootstrap environment: ${payload.evidence.nextAction.summary.liveMoneyMissingBootstrapEnvironment.join(", ")}`,
  );
}
console.log(`- go-live runway archive count: ${payload.evidence.goLiveRunway.archiveCount}`);
console.log(
  `- go-live runway captured current HEAD: ${
    payload.evidence.goLiveRunway.capturedAtCurrentPushedHead ? "yes" : "no"
  }`,
);
console.log(
  `- go-live runway quota approximate remaining: ${
    payload.evidence.goLiveRunway.summary.quotaApproximateRemaining
  }`,
);
console.log(
  `- go-live runway evidence ok: ${
    payload.evidence.goLiveRunway.summary.goLiveEvidenceOk ? "yes" : "no"
  }`,
);
console.log(
  `- go-live runway evidence current pushed HEAD: ${
    payload.evidence.goLiveRunway.summary.goLiveEvidenceCapturedAtCurrentHead ? "yes" : "no"
  }`,
);
if (payload.evidence.goLiveRunway.summary.liveMoneyMissingBootstrapEnvironment.length) {
  console.log(
    `- go-live runway live-money missing bootstrap environment: ${payload.evidence.goLiveRunway.summary.liveMoneyMissingBootstrapEnvironment.join(", ")}`,
  );
}
console.log(
  "- read-only source guarantee: status:build-block-history only reads Git state and local .codex-run evidence; this archive helper only writes the timestamped history evidence file.",
);
