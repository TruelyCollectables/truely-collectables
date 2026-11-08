import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");
const schema = "tcos.nightlyEmergencyBackupVerification.v1";

function readOption(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function resolveHome(input) {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

function defaultBackupDir() {
  if (process.platform === "win32") {
    return "C:\\Backups";
  }

  return path.join(os.homedir(), "Backups");
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseShaFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const match = text.match(/^([a-f0-9]{64})\s+/i);
  return match?.[1]?.toLowerCase() || null;
}

function listArchives(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    return [];
  }

  return fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("truely-collectables-nightly-") && name.endsWith(".tar.gz"))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      const stat = fs.statSync(filePath);
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

function selectArchive(backupDir) {
  const explicitArchive = readOption("--archive");
  if (explicitArchive) {
    const archivePath = path.resolve(resolveHome(explicitArchive));
    return {
      selectedBy: "--archive",
      archivePath,
      knownArchives: listArchives(path.dirname(archivePath)),
    };
  }

  const archives = listArchives(backupDir);
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

function hasEntry(entries, entry) {
  return entries.includes(entry);
}

function hasPathPrefix(entries, prefix) {
  return entries.some((entry) => entry === prefix || entry.startsWith(`${prefix}/`));
}

const repoRoot = process.cwd();
const packagePath = path.join(repoRoot, "package.json");
if (!fs.existsSync(packagePath)) {
  throw new Error("Run this command from the TCOS repository root.");
}

const packageJson = readJson(packagePath);
if (packageJson.name !== "truely-collectables") {
  throw new Error("Run this command from the truely-collectables repository root.");
}

const backupDir = path.resolve(
  resolveHome(readOption("--backup-dir") || process.env.TCOS_NIGHTLY_BACKUP_DIR || defaultBackupDir()),
);
const repoName = path.basename(repoRoot);
const selected = selectArchive(backupDir);
const archivePath = selected.archivePath;
const manifestPath = archivePath?.replace(/\.tar\.gz$/, ".manifest.json") || null;
const shaPath = archivePath ? `${archivePath}.sha256` : null;

const checks = [];
checks.push(check(Boolean(archivePath), "backup archive selected"));
checks.push(check(Boolean(archivePath && fs.existsSync(archivePath)), "backup archive exists", archivePath));
checks.push(check(Boolean(manifestPath && fs.existsSync(manifestPath)), "manifest exists", manifestPath));
checks.push(check(Boolean(shaPath && fs.existsSync(shaPath)), "sha256 file exists", shaPath));

let manifest = null;
if (manifestPath && fs.existsSync(manifestPath)) {
  manifest = readJson(manifestPath);
  checks.push(check(manifest.schema === "tcos.nightlyEmergencyBackup.v1", "manifest schema"));
  checks.push(check(path.basename(manifest.archivePath || "") === path.basename(archivePath || ""), "manifest archive basename matches"));
  checks.push(check(manifest.localArchive?.includesGitDirectory === true, "manifest says .git is included"));
  checks.push(check(manifest.localArchive?.includesEnvFiles === true, "manifest says .env files are included"));
}

let sha256FromFile = null;
let computedSha256 = null;
if (shaPath && fs.existsSync(shaPath)) {
  sha256FromFile = parseShaFile(shaPath);
  checks.push(check(Boolean(sha256FromFile), "sha256 file is parseable"));
}

if (archivePath && fs.existsSync(archivePath)) {
  computedSha256 = await sha256File(archivePath);
  checks.push(check(computedSha256 === sha256FromFile, "archive sha256 matches .sha256 file"));
  checks.push(check(computedSha256 === manifest?.localArchive?.sha256, "archive sha256 matches manifest"));
}

let tarEntries = [];
if (archivePath && fs.existsSync(archivePath)) {
  const tarList = run("tar", ["-tzf", archivePath]);
  checks.push(check(tarList.status === 0, "archive tar listing succeeds", tarList.stderr?.slice(0, 500) || null));
  if (tarList.status === 0) {
    tarEntries = tarList.stdout.trim().split("\n").filter(Boolean);
    checks.push(check(tarEntries.length > 0, "archive contains files"));
    checks.push(check(hasEntry(tarEntries, `${repoName}/package.json`), "archive contains package.json"));
    checks.push(check(hasEntry(tarEntries, `${repoName}/.git/HEAD`), "archive contains .git/HEAD"));

    const envFiles = Array.isArray(manifest?.localArchive?.envFiles)
      ? manifest.localArchive.envFiles
      : [];
    for (const envFile of envFiles) {
      checks.push(check(hasEntry(tarEntries, `${repoName}/${envFile}`), `archive contains ${envFile}`));
    }

    const excludedPrefixes = [
      { prefix: "node_modules", label: "archive excludes node_modules" },
      { prefix: ".next", label: "archive excludes .next" },
      { prefix: ".codex-run", label: "archive excludes .codex-run" },
      {
        prefix: "services/paddleocr-service/.paddlex-cache",
        label: "archive excludes services/paddleocr-service/.paddlex-cache",
      },
      { prefix: "coverage", label: "archive excludes coverage" },
    ];
    for (const excluded of excludedPrefixes) {
      checks.push(
        check(
          !hasPathPrefix(tarEntries, `${repoName}/${excluded.prefix}`),
          excluded.label,
        ),
      );
    }
  }
}

const failedChecks = checks.filter((item) => !item.ok);
const payload = {
  schema,
  checkedAt: new Date().toISOString(),
  backupDir,
  selectedBy: selected.selectedBy,
  archivePath,
  manifestPath,
  sha256Path: shaPath,
  archiveCount: selected.knownArchives.length,
  latestKnownArchive: selected.knownArchives[0] || null,
  computedSha256,
  sha256FromFile,
  manifestSha256: manifest?.localArchive?.sha256 || null,
  checks,
  ok: failedChecks.length === 0,
  failedCheckCount: failedChecks.length,
  failedChecks,
  readOnlyGuarantee:
    "This command only reads the backup archive, checksum, manifest, and tar listing; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("TCOS nightly emergency backup verification:");
  console.log(`- backup folder: ${backupDir}`);
  console.log(`- selected by: ${payload.selectedBy}`);
  console.log(`- archive: ${archivePath || "none"}`);
  console.log(`- archive count: ${payload.archiveCount}`);
  console.log(`- manifest: ${manifestPath || "none"}`);
  console.log(`- sha256 file: ${shaPath || "none"}`);
  console.log(`- computed sha256: ${computedSha256 || "not computed"}`);
  console.log(`- ok: ${payload.ok ? "yes" : "no"}`);
  console.log(`- failed checks: ${payload.failedCheckCount}`);
  for (const item of failedChecks) {
    console.log(`  - ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
  }
  console.log("");
  console.log(`Read-only guarantee: ${payload.readOnlyGuarantee}`);
}

if (!payload.ok) {
  process.exitCode = 1;
}
