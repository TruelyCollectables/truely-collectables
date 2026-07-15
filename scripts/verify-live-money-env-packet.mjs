import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const schema = "tcos.liveMoneyEnvPacketVerification.v1";
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "live-money-env-packet");

function readOption(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseShaFile(filePath) {
  const text = readFileSync(filePath, "utf8").trim();
  const match = text.match(/^([a-f0-9]{64})\s+/i);
  return match?.[1]?.toLowerCase() || null;
}

function listPacketArchives() {
  if (!existsSync(evidenceDir)) return [];

  return readdirSync(evidenceDir)
    .filter((name) => name.endsWith("-live-money-env-packet.json"))
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
      knownArchives: listPacketArchives(),
    };
  }

  const archives = listPacketArchives();
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

function hasSecretShapedValue(text) {
  return [
    /\bsk_live_[A-Za-z0-9_]{8,}\b/,
    /\bsk_test_[A-Za-z0-9_]{8,}\b/,
    /\brk_live_[A-Za-z0-9_]{8,}\b/,
    /\bpk_live_[A-Za-z0-9_]{8,}\b/,
    /\bwhsec_[A-Za-z0-9_]{8,}\b/,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  ].some((pattern) => pattern.test(text));
}

const selected = selectArchive();
const archivePath = selected.archivePath;
const sha256Path = archivePath ? `${archivePath}.sha256` : null;

const checks = [];
checks.push(check(Boolean(archivePath), "env packet archive selected"));
checks.push(check(Boolean(archivePath && existsSync(archivePath)), "env packet archive exists", archivePath));
checks.push(check(Boolean(sha256Path && existsSync(sha256Path)), "sha256 sidecar exists", sha256Path));

let archiveText = null;
let payload = null;
let parseError = null;
if (archivePath && existsSync(archivePath)) {
  archiveText = readFileSync(archivePath, "utf8");
  try {
    payload = JSON.parse(archiveText);
    checks.push(check(true, "env packet JSON parses"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    checks.push(check(false, "env packet JSON parses", parseError));
  }
}

let sha256FromFile = null;
if (sha256Path && existsSync(sha256Path)) {
  sha256FromFile = parseShaFile(sha256Path);
  checks.push(check(Boolean(sha256FromFile), "sha256 sidecar is parseable"));
}

const computedSha256 = archiveText ? sha256Text(archiveText) : null;
if (archiveText) {
  checks.push(check(computedSha256 === sha256FromFile, "archive sha256 matches .sha256 sidecar"));
  checks.push(check(!hasSecretShapedValue(archiveText), "archive contains no secret-shaped values"));
}

if (payload) {
  checks.push(check(payload.schema === "tcos.liveMoneyEnvPacket.v1", "env packet schema"));
  checks.push(check(Boolean(payload.generatedAt), "env packet generatedAt"));
  checks.push(check(Array.isArray(payload.entries?.supabaseBootstrap), "Supabase bootstrap entries exist"));
  checks.push(check(Array.isArray(payload.entries?.finalLivePaymentRuntime), "final live-payment runtime entries exist"));
  checks.push(check(payload.commands?.bootstrapEnvTemplate === "npm run live-money:bootstrap-template", "bootstrap local template command is recorded"));
  checks.push(check(payload.commands?.vercelBootstrapCommands === "npm run live-money:vercel-bootstrap-commands", "bootstrap command is recorded"));
  checks.push(check(payload.commands?.vercelCommands === "npm run live-money:vercel-commands", "full command is recorded"));
  checks.push(
    check(
      payload.verificationBoundary?.includes("Vercel env add commands stage deployed runtime values only") &&
        payload.verificationBoundary?.includes("Local npm run status:live-money reads this shell's local environment") &&
        payload.verificationBoundary?.includes("redeploy only when quota is open"),
      "local/deployed verification boundary is recorded",
      payload.verificationBoundary || null,
    ),
  );
  checks.push(check(payload.archive?.checksumAlgorithm === "sha256", "archive metadata records sha256 algorithm"));
  checks.push(check(payload.archive?.checksumPath === sha256Path, "archive metadata checksum path matches sidecar"));
  checks.push(check(payload.archive?.command === "npm --silent run live-money:env-packet:json", "archive metadata records source command"));
  checks.push(check(payload.readOnlyGuarantee?.includes("does not read secrets"), "read-only guarantee says it does not read secrets"));
  checks.push(check(payload.readOnlyGuarantee?.includes("deploy"), "read-only guarantee includes no deploy boundary"));
  checks.push(check(payload.readOnlyGuarantee?.includes("buy postage"), "read-only guarantee includes no postage boundary"));
  checks.push(check(payload.readOnlyGuarantee?.includes("create Checkout"), "read-only guarantee includes no Checkout boundary"));
}

const failedChecks = checks.filter((item) => !item.ok);
const verification = {
  schema,
  checkedAt: new Date().toISOString(),
  evidenceDir,
  selectedBy: selected.selectedBy,
  archivePath,
  sha256Path,
  archiveCount: selected.knownArchives.length,
  latestKnownArchive: selected.knownArchives[0] || null,
  computedSha256,
  sha256FromFile,
  packetSchema: payload?.schema || null,
  packetGeneratedAt: payload?.generatedAt || null,
  bootstrapCommand: payload?.commands?.vercelBootstrapCommands || null,
  fullCommand: payload?.commands?.vercelCommands || null,
  verificationBoundary: payload?.verificationBoundary || null,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads the no-secret live-money env packet archive and checksum sidecar; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (jsonOutput) {
  console.log(JSON.stringify(verification, null, 2));
} else {
  console.log("TCOS live-money env packet verification:");
  console.log(`- evidence folder: ${evidenceDir}`);
  console.log(`- selected by: ${verification.selectedBy}`);
  console.log(`- archive: ${archivePath || "none"}`);
  console.log(`- archive count: ${verification.archiveCount}`);
  console.log(`- sha256 sidecar: ${sha256Path || "none"}`);
  console.log(`- computed sha256: ${computedSha256 || "not computed"}`);
  console.log(`- sha256 from sidecar: ${sha256FromFile || "not parsed"}`);
  console.log(`- bootstrap command: ${verification.bootstrapCommand || "not recorded"}`);
  console.log(`- full command: ${verification.fullCommand || "not recorded"}`);
  console.log(`- verification boundary: ${verification.verificationBoundary || "not recorded"}`);
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
