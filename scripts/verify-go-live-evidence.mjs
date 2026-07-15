import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const schema = "tcos.goLiveEvidenceVerification.v1";
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceRoot = join(repoRoot, ".codex-run");

const evidenceSources = {
  runway: {
    dir: join(evidenceRoot, "go-live-runway"),
    suffix: "-go-live-runway.json",
    schema: "tcos.goLiveRunwayStatus.v1",
    command: "npm --silent run status:go-live:json",
  },
  nightlyBackupStatus: {
    dir: join(evidenceRoot, "nightly-backup-status"),
    suffix: "-nightly-backup-status.json",
    schema: "tcos.nightlyBackupStatus.v1",
    command: "npm --silent run status:nightly-backup:json",
  },
  nightlyBackupVerification: {
    dir: join(evidenceRoot, "nightly-backup-verification"),
    suffix: "-nightly-backup-verification.json",
    schema: "tcos.nightlyEmergencyBackupVerification.v1",
    command: "npm --silent run verify:nightly-backup:json",
  },
  liveMoneyEnvPacket: {
    dir: join(evidenceRoot, "live-money-env-packet"),
    suffix: "-live-money-env-packet.json",
    schema: "tcos.liveMoneyEnvPacket.v1",
    command: "npm --silent run live-money:env-packet:json",
  },
  liveMoneyEnvPacketVerification: {
    dir: join(evidenceRoot, "live-money-env-packet-verification"),
    suffix: "-live-money-env-packet-verification.json",
    schema: "tcos.liveMoneyEnvPacketVerification.v1",
    command: "npm --silent run verify:live-money-env-packet:json",
  },
};

function runLocalGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function latestEvidence({ dir, suffix }) {
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => {
      const filePath = join(dir, name);
      const stat = statSync(filePath);
      return {
        name,
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files[0] || null;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function check(condition, name, detail = null) {
  return {
    name,
    ok: Boolean(condition),
    detail,
  };
}

function archivedClean(payload) {
  return payload?.archive?.gitWorkingTreeClean === true;
}

function archivedPushed(payload, currentHead, currentOriginMain) {
  return (
    payload?.archive?.gitHead === currentHead &&
    payload?.archive?.gitOriginMain === currentOriginMain &&
    payload?.archive?.gitHead === payload?.archive?.gitOriginMain
  );
}

function evidenceSummary(payload) {
  const summary = {
    path: payload?.__path || null,
    schema: payload?.schema || null,
    archivedAt: payload?.archive?.archivedAt || null,
    gitHead: payload?.archive?.gitHead || null,
    gitOriginMain: payload?.archive?.gitOriginMain || null,
    gitWorkingTreeClean: payload?.archive?.gitWorkingTreeClean ?? null,
    command: payload?.archive?.command || null,
  };
  if (typeof payload?.verificationBoundary === "string") {
    summary.verificationBoundary = payload.verificationBoundary;
  }

  return summary;
}

const gitStatusShort = runLocalGit(["status", "--short"]);
const currentHead = runLocalGit(["rev-parse", "--short", "HEAD"]) || "unknown";
const currentOriginMain = runLocalGit(["rev-parse", "--short", "origin/main"]) || "unknown";
const checks = [
  check(gitStatusShort === "", "current working tree is clean", gitStatusShort || null),
  check(currentHead === currentOriginMain, "current HEAD matches origin/main", `${currentHead} / ${currentOriginMain}`),
];

const payloads = {};
const summaries = {};

for (const [key, source] of Object.entries(evidenceSources)) {
  const latest = latestEvidence(source);
  checks.push(check(Boolean(latest), `${key} evidence exists`, source.dir));

  if (!latest) continue;

  let payload = null;
  try {
    payload = readJson(latest.filePath);
    payload.__path = latest.filePath;
    payload.__modifiedAt = latest.modifiedAt;
    checks.push(check(true, `${key} JSON parses`));
  } catch (error) {
    checks.push(
      check(false, `${key} JSON parses`, error instanceof Error ? error.message : String(error)),
    );
    continue;
  }

  payloads[key] = payload;
  summaries[key] = evidenceSummary(payload);
  checks.push(check(payload.schema === source.schema, `${key} schema is ${source.schema}`, payload.schema));
  checks.push(check(payload.archive?.command === source.command, `${key} archive command matches`, payload.archive?.command));
  checks.push(check(archivedClean(payload), `${key} archive was captured with a clean tree`));
  checks.push(
    check(
      archivedPushed(payload, currentHead, currentOriginMain),
      `${key} archive was captured at pushed HEAD`,
      `${payload.archive?.gitHead || "unknown"} / ${payload.archive?.gitOriginMain || "unknown"}`,
    ),
  );
}

const runway = payloads.runway;
if (runway) {
  const blockerAreas = new Set(
    Array.isArray(runway.goLiveReadiness?.blockers)
      ? runway.goLiveReadiness.blockers.map((blocker) => blocker.area)
      : [],
  );
  checks.push(check(runway.git?.workingTreeClean === true, "runway git payload is clean"));
  checks.push(check(runway.git?.head === currentHead, "runway git head matches current HEAD", runway.git?.head));
  checks.push(check(!blockerAreas.has("git"), "runway has no git blocker"));
  checks.push(check(!blockerAreas.has("head_not_pushed"), "runway has no unpushed-head blocker"));
  checks.push(
    check(
      runway.productionDeploymentQuota?.vercelUploadStarted === false ||
        runway.productionDeploymentQuota?.uploadStarted === false ||
        runway.productionDeploymentQuota?.uploadStarted === "no",
      "runway confirms no Vercel upload started",
      runway.productionDeploymentQuota?.vercelUploadStarted ??
        runway.productionDeploymentQuota?.uploadStarted ??
        null,
    ),
  );
  checks.push(check(runway.readOnlyGuarantee?.includes("starts no deploy"), "runway read-only guarantee includes no deploy"));
  checks.push(check(runway.readOnlyGuarantee?.includes("postage"), "runway read-only guarantee includes no postage"));
}

const backupStatus = payloads.nightlyBackupStatus;
if (backupStatus) {
  checks.push(check(backupStatus.scheduleHealth?.state === "current", "backup schedule is current", backupStatus.scheduleHealth?.state));
  checks.push(check(backupStatus.retention?.keep === 7, "backup retention keeps seven backups", backupStatus.retention?.keep));
  checks.push(check(backupStatus.retention?.overRetentionCount === 0, "backup retention has no over-retention", backupStatus.retention?.overRetentionCount));
  checks.push(check(backupStatus.launchdRuntime?.loaded === true, "backup LaunchAgent is loaded"));
  checks.push(check(backupStatus.readOnlyGuarantee?.includes("creates no archive"), "backup status is read-only/no archive creation"));
}

const backupVerification = payloads.nightlyBackupVerification;
if (backupVerification) {
  checks.push(check(backupVerification.ok === true, "backup verification is ok"));
  checks.push(check(backupVerification.failedCheckCount === 0, "backup verification has no failed checks", backupVerification.failedCheckCount));
  checks.push(check(Boolean(backupVerification.computedSha256), "backup verification has computed sha256"));
  if (runway) {
    checks.push(
      check(
        backupVerification.archivePath === runway.emergencyBackup?.verification?.archivePath,
        "backup verification archive matches runway archive",
        `${backupVerification.archivePath || "unknown"} / ${runway.emergencyBackup?.verification?.archivePath || "unknown"}`,
      ),
    );
  }
}

const livePacket = payloads.liveMoneyEnvPacket;
if (livePacket) {
  checks.push(check(livePacket.archive?.checksumAlgorithm === "sha256", "live-money packet records sha256 algorithm"));
  checks.push(check(livePacket.readOnlyGuarantee?.includes("does not read secrets"), "live-money packet does not read secrets"));
  checks.push(check(livePacket.readOnlyGuarantee?.includes("deploy"), "live-money packet includes no deploy boundary"));
  checks.push(check(livePacket.readOnlyGuarantee?.includes("buy postage"), "live-money packet includes no postage boundary"));
  checks.push(check(livePacket.readOnlyGuarantee?.includes("create Checkout"), "live-money packet includes no Checkout boundary"));
}

const liveVerification = payloads.liveMoneyEnvPacketVerification;
if (liveVerification) {
  const liveVerificationCheckNames = new Set(
    Array.isArray(liveVerification.checks) ? liveVerification.checks.map((item) => item.name) : [],
  );
  checks.push(check(liveVerification.ok === true, "live-money packet verification is ok"));
  checks.push(check(liveVerification.failedCheckCount === 0, "live-money packet verification has no failed checks", liveVerification.failedCheckCount));
  checks.push(check(liveVerification.computedSha256 === liveVerification.sha256FromFile, "live-money packet checksum matches sidecar"));
  checks.push(check(liveVerification.bootstrapCommand === "npm run live-money:vercel-bootstrap-commands", "live-money bootstrap command is recorded"));
  checks.push(
    check(
      liveVerification.verificationBoundary?.includes("Vercel env add commands stage deployed runtime values only") &&
        liveVerification.verificationBoundary?.includes("Local npm run status:live-money reads this shell's local environment") &&
        liveVerification.verificationBoundary?.includes("redeploy only when quota is open"),
      "live-money verification boundary is recorded",
      liveVerification.verificationBoundary || null,
    ),
  );
  checks.push(
    check(
      liveVerificationCheckNames.has("local/deployed verification boundary is recorded"),
      "live-money verifier checked local/deployed boundary",
    ),
  );
  if (livePacket) {
    checks.push(
      check(
        liveVerification.archivePath === livePacket.__path,
        "live-money verification points at latest packet archive",
        `${liveVerification.archivePath || "unknown"} / ${livePacket.__path || "unknown"}`,
      ),
    );
  }
}

const failedChecks = checks.filter((item) => !item.ok);
const verification = {
  schema,
  checkedAt: new Date().toISOString(),
  git: {
    head: currentHead,
    originMain: currentOriginMain,
    workingTreeClean: gitStatusShort === "",
    workingTreeChanges: gitStatusShort ? gitStatusShort.split("\n") : [],
  },
  evidence: summaries,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads Git state and the latest local go-live evidence archives; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(verification, null, 2));
} else {
  console.log("TCOS go-live evidence verification:");
  console.log(`- git HEAD: ${verification.git.head}`);
  console.log(`- git origin/main: ${verification.git.originMain}`);
  console.log(`- git working tree clean: ${verification.git.workingTreeClean ? "yes" : "no"}`);
  for (const [key, summary] of Object.entries(verification.evidence)) {
    console.log(`- ${key}: ${summary.path || "missing"}`);
    console.log(`  - archived at: ${summary.archivedAt || "unknown"}`);
    console.log(`  - archive git clean: ${summary.gitWorkingTreeClean === true ? "yes" : "no"}`);
  }
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
