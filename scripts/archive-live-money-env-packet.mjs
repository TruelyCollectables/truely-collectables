import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const evidenceDir = join(repoRoot, ".codex-run", "live-money-env-packet");
const commandText = "npm --silent run live-money:env-packet:json";

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
      `Could not parse live-money:env-packet:json output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEvidenceContract(payload) {
  const missing = [];
  if (payload?.schema !== "tcos.liveMoneyEnvPacket.v1") missing.push("schema");
  if (!payload?.generatedAt) missing.push("generatedAt");
  if (!Array.isArray(payload?.entries?.supabaseBootstrap)) {
    missing.push("entries.supabaseBootstrap");
  }
  if (!Array.isArray(payload?.entries?.finalLivePaymentRuntime)) {
    missing.push("entries.finalLivePaymentRuntime");
  }
  if (!payload?.commands?.json) missing.push("commands.json");
  if (!payload?.commands?.vercelBootstrapCommands) {
    missing.push("commands.vercelBootstrapCommands");
  }
  if (!payload?.commands?.vercelCommands) missing.push("commands.vercelCommands");
  if (!payload?.vercelCli?.version) missing.push("vercelCli.version");
  if (!payload?.vercelCli?.commandPrefix) missing.push("vercelCli.commandPrefix");
  if (!payload?.vercelScopeBoundary) missing.push("vercelScopeBoundary");
  if (!Array.isArray(payload?.goLiveBoundary?.acceptedPreflightStates)) {
    missing.push("goLiveBoundary.acceptedPreflightStates");
  }
  if (!payload?.readOnlyGuarantee) missing.push("readOnlyGuarantee");

  if (missing.length) {
    throw new Error(
      `Live-money env packet JSON is missing required archive field(s): ${missing.join(", ")}`,
    );
  }
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "--silent",
  "run",
  "live-money:env-packet:json",
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
  `${archivedAt.replace(/[:.]/g, "-")}-live-money-env-packet.json`,
);
const checksumPath = `${filePath}.sha256`;
const archivedPayload = {
  ...payload,
  archive: {
    ...archiveMetadata(archivedAt),
    checksumAlgorithm: "sha256",
    checksumPath,
  },
};
const serializedPayload = `${JSON.stringify(archivedPayload, null, 2)}\n`;
const archiveSha256 = createHash("sha256")
  .update(serializedPayload)
  .digest("hex");

writeFileSync(filePath, serializedPayload);
writeFileSync(checksumPath, `${archiveSha256}  ${basename(filePath)}\n`);

console.log("Live-money env packet archived:");
console.log(`- command: ${commandText}`);
console.log(`- path: ${filePath}`);
console.log(`- sha256: ${archiveSha256}`);
console.log(`- sha256 sidecar: ${checksumPath}`);
console.log(`- archived at: ${archivedPayload.archive.archivedAt}`);
console.log(`- git HEAD: ${archivedPayload.archive.gitHead}`);
console.log(`- git origin/main: ${archivedPayload.archive.gitOriginMain}`);
console.log(
  `- git working tree clean: ${
    archivedPayload.archive.gitWorkingTreeClean ? "yes" : "no"
  }`,
);
console.log(`- schema: ${payload.schema}`);
console.log(
  `- Supabase bootstrap entries: ${payload.entries.supabaseBootstrap
    .map((entry) => entry.key)
    .join(", ")}`,
);
console.log(
  `- final live-payment runtime entries: ${payload.entries.finalLivePaymentRuntime
    .map((entry) => entry.key)
    .join(", ")}`,
);
console.log(`- bootstrap Vercel command: ${payload.commands.vercelBootstrapCommands}`);
console.log(`- full Vercel command: ${payload.commands.vercelCommands}`);
console.log(
  `- accepted preflight states: ${payload.goLiveBoundary.acceptedPreflightStates.join(", ")}`,
);
console.log(`- read-only guarantee: ${payload.readOnlyGuarantee}`);

if (stderr) console.error(stderr);

process.exitCode = result.status || 0;
