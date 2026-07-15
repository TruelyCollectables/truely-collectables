import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

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

function hasFlag(name) {
  return args.includes(name);
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

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
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
    stdio: options.stdio || "pipe",
  });
}

function runGit(gitArgs) {
  const result = run("git", gitArgs, { cwd: repoRoot });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function requireSuccess(name, result) {
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`${name} failed${output ? `:\n${output}` : ""}`);
  }
}

function listEnvFiles() {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(".env"))
    .map((entry) => entry.name)
    .sort();
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

function pruneBackups(backupDir, keep) {
  if (!Number.isInteger(keep) || keep < 0) {
    return [];
  }

  const archives = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("truely-collectables-nightly-") && name.endsWith(".tar.gz"))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      return {
        name,
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed = [];
  for (const archive of archives.slice(keep)) {
    const siblings = [
      archive.filePath,
      `${archive.filePath}.sha256`,
      archive.filePath.replace(/\.tar\.gz$/, ".manifest.json"),
    ];

    for (const filePath of siblings) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
        removed.push(filePath);
      }
    }
  }

  return removed;
}

function parseKeep(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Backup keep count must be a positive integer. Received: ${value}`);
  }
  return parsed;
}

const repoRoot = process.cwd();
const packagePath = path.join(repoRoot, "package.json");

if (!fs.existsSync(packagePath)) {
  throw new Error("Run this command from the TCOS repository root.");
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.name !== "truely-collectables") {
  throw new Error("Run this command from the truely-collectables repository root.");
}

const localOnly = hasFlag("--local-only") || hasFlag("--no-git-push");
const dryRun = hasFlag("--dry-run");
const skipPrune = hasFlag("--skip-prune");
const backupDirInput =
  readOption("--backup-dir") ||
  process.env.TCOS_NIGHTLY_BACKUP_DIR ||
  defaultBackupDir();
const keep = parseKeep(readOption("--keep") || process.env.TCOS_NIGHTLY_BACKUP_KEEP || "7");
const backupDir = path.resolve(resolveHome(backupDirInput));
const repoName = path.basename(repoRoot);
const repoParent = path.dirname(repoRoot);
const createdAt = new Date();
const stamp = timestampForFile(createdAt);
const archivePath = path.join(backupDir, `truely-collectables-nightly-${stamp}.tar.gz`);
const manifestPath = archivePath.replace(/\.tar\.gz$/, ".manifest.json");
const shaPath = `${archivePath}.sha256`;

const excludedPaths = [
  "node_modules",
  ".next",
  ".next-*",
  "out",
  "build",
  ".codex-run",
  "TCOS_BACKUP",
  ".venv",
  "services/paddleocr-service/.venv",
  "services/paddleocr-service/.paddlex-cache",
  "coverage",
  "tsconfig.tsbuildinfo",
  "*.tsbuildinfo",
  ".DS_Store",
  "__pycache__",
];

const gitHead = runGit(["rev-parse", "HEAD"]);
const gitHeadShort = runGit(["rev-parse", "--short", "HEAD"]);
const gitBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
const gitOriginMain = runGit(["rev-parse", "--short", "origin/main"]);
const gitStatus = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
const gitStatusLines = gitStatus.stdout ? gitStatus.stdout.split("\n") : [];
const envFiles = listEnvFiles();

const manifest = {
  schema: "tcos.nightlyEmergencyBackup.v1",
  createdAt: createdAt.toISOString(),
  repoRoot,
  backupDir,
  archivePath,
  sha256Path: shaPath,
  git: {
    head: gitHead.ok ? gitHead.stdout : null,
    headShort: gitHeadShort.ok ? gitHeadShort.stdout : null,
    branch: gitBranch.ok ? gitBranch.stdout : null,
    originMainShort: gitOriginMain.ok ? gitOriginMain.stdout : null,
    dirty: gitStatusLines.length > 0,
    statusLineCount: gitStatusLines.length,
  },
  localArchive: {
    includesGitDirectory: true,
    includesEnvFiles: true,
    envFiles,
    excludedPaths,
  },
  gitPush: {
    requested: !localOnly,
    attempted: false,
    ok: null,
    skippedReason: null,
    note: "Git push only syncs committed source. Ignored .env* files and untracked local files are captured by the local archive, not committed to Git.",
  },
  prune: {
    requested: !skipPrune,
    keep,
    rotation: "Keep seven dated backups. Before creating day 8, delete the oldest dated backup so the new file replaces the first day in the rolling window.",
    removed: [],
  },
};

if (dryRun) {
  manifest.localArchive.dryRun = true;
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true });

if (!skipPrune) {
  manifest.prune.removed = pruneBackups(backupDir, keep - 1);
}

const tarArgs = [
  "-czf",
  archivePath,
  ...excludedPaths.flatMap((exclude) => ["--exclude", `${repoName}/${exclude}`]),
  "-C",
  repoParent,
  repoName,
];

requireSuccess("local emergency archive", run("tar", tarArgs));

const archiveHash = await sha256File(archivePath);
fs.writeFileSync(shaPath, `${archiveHash}  ${path.basename(archivePath)}\n`);
manifest.localArchive.sha256 = archiveHash;
manifest.localArchive.bytes = fs.statSync(archivePath).size;

if (!localOnly) {
  if (manifest.git.branch !== "main") {
    manifest.gitPush.skippedReason = `current branch is ${manifest.git.branch || "unknown"}, not main`;
  } else {
    manifest.gitPush.attempted = true;
    const push = runGit(["push", "origin", "HEAD:main"]);
    manifest.gitPush.ok = push.ok;
    manifest.gitPush.status = push.status;
    manifest.gitPush.stdout = push.stdout.slice(0, 2000);
    manifest.gitPush.stderr = push.stderr.slice(0, 2000);

    if (!push.ok) {
      manifest.gitPush.skippedReason = "git push failed; local archive was still created";
    }
  }
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Local emergency archive: ${archivePath}`);
console.log(`Archive SHA-256: ${archiveHash}`);
console.log(`Manifest: ${manifestPath}`);
console.log(`.env* files captured locally: ${envFiles.length === 0 ? "none found" : envFiles.join(", ")}`);

if (localOnly) {
  console.log("Git push: skipped by --local-only/--no-git-push");
} else if (manifest.gitPush.ok) {
  console.log("Git push: committed source synced to origin/main");
} else if (manifest.gitPush.skippedReason) {
  console.log(`Git push: ${manifest.gitPush.skippedReason}`);
}

if (gitStatusLines.length > 0) {
  console.log(
    `Working tree note: ${gitStatusLines.length} local change line(s) were captured in the local archive; Git only received already-committed source.`,
  );
}

if (manifest.prune.removed.length > 0) {
  console.log(`Rolling retention: removed ${manifest.prune.removed.length} old backup file(s) before creating this dated backup.`);
}

if (manifest.gitPush.attempted && !manifest.gitPush.ok) {
  process.exitCode = 1;
}
