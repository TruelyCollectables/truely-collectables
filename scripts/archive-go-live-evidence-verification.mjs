import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "go-live-evidence-verification");
const commandText = "npm --silent run verify:go-live-evidence:json";

function runLocalGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || "").trim();
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
      `Could not parse verify:go-live-evidence:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.goLiveEvidenceVerification.v1") {
    missing.push("schema");
  }
  if (!payload?.checkedAt) missing.push("checkedAt");
  if (payload?.git?.workingTreeClean !== true) {
    missing.push("git.workingTreeClean.true");
  }
  if (!payload?.git?.head) missing.push("git.head");
  if (!payload?.git?.originMain) missing.push("git.originMain");
  if (payload?.git?.head !== payload?.git?.originMain) {
    missing.push("git.head.matchesOriginMain");
  }
  if (payload?.ok !== true) missing.push("ok.true");
  if (payload?.failedCheckCount !== 0) missing.push("failedCheckCount.zero");
  if (!Array.isArray(payload?.checks)) missing.push("checks");
  if (!Array.isArray(payload?.failedChecks)) missing.push("failedChecks");
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");
  if (!payload?.readOnlyGuarantee?.includes("creates no archive")) {
    missing.push("readOnlyGuarantee.createsNoArchive");
  }
  if (!payload?.readOnlyGuarantee?.includes("starts no Git push")) {
    missing.push("readOnlyGuarantee.noGitPush");
  }
  if (!payload?.readOnlyGuarantee?.includes("deploy")) {
    missing.push("readOnlyGuarantee.noDeploy");
  }
  if (!payload?.readOnlyGuarantee?.includes("postage")) {
    missing.push("readOnlyGuarantee.noPostage");
  }

  const requiredEvidenceKeys = [
    "runway",
    "nightlyBackupStatus",
    "nightlyBackupVerification",
    "liveMoneyEnvPacket",
    "liveMoneyEnvPacketVerification",
  ];
  for (const key of requiredEvidenceKeys) {
    if (!payload?.evidence?.[key]?.path) missing.push(`evidence.${key}.path`);
    if (payload?.evidence?.[key]?.gitWorkingTreeClean !== true) {
      missing.push(`evidence.${key}.gitWorkingTreeClean.true`);
    }
  }
  if (
    !payload?.evidence?.liveMoneyEnvPacketVerification?.verificationBoundary?.includes(
      "Vercel env add commands stage deployed runtime values only",
    )
  ) {
    missing.push("evidence.liveMoneyEnvPacketVerification.verificationBoundary.vercelStaging");
  }
  if (
    !payload?.evidence?.liveMoneyEnvPacketVerification?.verificationBoundary?.includes(
      "Local npm run status:live-money reads this shell's local environment",
    )
  ) {
    missing.push("evidence.liveMoneyEnvPacketVerification.verificationBoundary.localStatus");
  }
  if (
    !payload?.evidence?.liveMoneyEnvPacketVerification?.verificationBoundary?.includes(
      "redeploy only when quota is open",
    )
  ) {
    missing.push("evidence.liveMoneyEnvPacketVerification.verificationBoundary.quotaGatedRedeploy");
  }

  const requiredCheckNames = [
    "current working tree is clean",
    "current HEAD matches origin/main",
    "runway archive was captured at pushed HEAD",
    "runway confirms no Vercel upload started",
    "backup verification is ok",
    "live-money packet verification is ok",
    "live-money verification boundary is recorded",
    "live-money verifier checked local/deployed boundary",
    "live-money verification points at latest packet archive",
  ];
  const checkNames = new Set(
    Array.isArray(payload?.checks) ? payload.checks.map((item) => item.name) : [],
  );
  for (const checkName of requiredCheckNames) {
    if (!checkNames.has(checkName)) {
      missing.push(`checks.${checkName}`);
    }
  }

  if (missing.length) {
    throw new Error(
      `Go-live evidence verification JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "verify:go-live-evidence:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-go-live-evidence-verification.json`,
);
const archivedPayload = {
  ...payload,
  archive: archiveMetadata(archivedAt),
};
writeFileSync(filePath, `${JSON.stringify(archivedPayload, null, 2)}\n`);

console.log("Go-live evidence verification archived:");
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
console.log(`- verification ok: ${payload.ok ? "yes" : "no"}`);
console.log(`- failed checks: ${payload.failedCheckCount}`);
console.log(`- runway evidence: ${payload.evidence?.runway?.path || "missing"}`);
console.log(
  `- nightly backup verification: ${
    payload.evidence?.nightlyBackupVerification?.path || "missing"
  }`,
);
console.log(
  `- live-money packet verification: ${
    payload.evidence?.liveMoneyEnvPacketVerification?.path || "missing"
  }`,
);
console.log(
  `- live-money verification boundary: ${
    payload.evidence?.liveMoneyEnvPacketVerification?.verificationBoundary || "not recorded"
  }`,
);
console.log(`- read-only guarantee: ${payload.readOnlyGuarantee}`);

if (stderr) console.error(stderr);

process.exitCode = result.status || 0;
