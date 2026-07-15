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
console.log(`- next-action archive count: ${payload.evidence.nextAction.archiveCount}`);
console.log(
  `- next-action captured current HEAD: ${
    payload.evidence.nextAction.capturedAtCurrentPushedHead ? "yes" : "no"
  }`,
);
console.log(`- go-live runway archive count: ${payload.evidence.goLiveRunway.archiveCount}`);
console.log(
  `- go-live runway captured current HEAD: ${
    payload.evidence.goLiveRunway.capturedAtCurrentPushedHead ? "yes" : "no"
  }`,
);
console.log(
  "- read-only source guarantee: status:build-block-history only reads Git state and local .codex-run evidence; this archive helper only writes the timestamped history evidence file.",
);
