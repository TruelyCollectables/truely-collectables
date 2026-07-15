import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");
const schema = "tcos.nightlyBackupStatus.v1";
const launchAgentLabel = "com.truelycollectables.nightly-emergency-backup";
const launchAgentPath = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${launchAgentLabel}.plist`,
);

function defaultBackupDir() {
  if (process.platform === "win32") {
    return "C:\\Backups";
  }

  return path.join(os.homedir(), "Backups");
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

function extractFirst(text, pattern) {
  const match = text.match(pattern);
  return match?.[1] || null;
}

function parseLaunchAgent() {
  if (process.platform !== "darwin") {
    return {
      supported: false,
      path: launchAgentPath,
      installed: false,
      label: launchAgentLabel,
      schedule: null,
      backupDir: null,
      stdoutPath: null,
      stderrPath: null,
      command: null,
      note: "LaunchAgent status is macOS-only.",
    };
  }

  if (!fs.existsSync(launchAgentPath)) {
    return {
      supported: true,
      path: launchAgentPath,
      installed: false,
      label: launchAgentLabel,
      schedule: null,
      backupDir: null,
      stdoutPath: null,
      stderrPath: null,
      command: null,
      note: "LaunchAgent plist is missing. Run npm run backup:nightly:install.",
    };
  }

  const text = fs.readFileSync(launchAgentPath, "utf8");
  const hour = extractFirst(text, /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
  const minute = extractFirst(text, /<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
  const command = extractFirst(
    text,
    /<string>(cd [\s\S]*?backup:nightly)<\/string>/,
  )?.replaceAll("&apos;", "'").replaceAll("&amp;", "&");
  const backupDir =
    extractFirst(command || "", /TCOS_NIGHTLY_BACKUP_DIR='([^']+)'/) ||
    extractFirst(command || "", /TCOS_NIGHTLY_BACKUP_DIR=([^\s]+)/);
  const stdoutPath = extractFirst(
    text,
    /<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/,
  );
  const stderrPath = extractFirst(
    text,
    /<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/,
  );

  return {
    supported: true,
    path: launchAgentPath,
    installed: true,
    label: launchAgentLabel,
    schedule:
      hour !== null && minute !== null
        ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
        : null,
    backupDir,
    stdoutPath,
    stderrPath,
    command,
    note: null,
  };
}

function statFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function listBackups(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    return {
      path: backupDir,
      exists: false,
      count: 0,
      newest: null,
      oldest: null,
      overRetentionCount: 0,
      files: [],
    };
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("truely-collectables-nightly-") && name.endsWith(".tar.gz"))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  return {
    path: backupDir,
    exists: true,
    count: files.length,
    newest: files[0] || null,
    oldest: files.at(-1) || null,
    overRetentionCount: Math.max(0, files.length - 7),
    files,
  };
}

const launchAgent = parseLaunchAgent();
const backupDir = path.resolve(
  resolveHome(
    readOption("--backup-dir") ||
      process.env.TCOS_NIGHTLY_BACKUP_DIR ||
      launchAgent.backupDir ||
      defaultBackupDir(),
  ),
);
const backups = listBackups(backupDir);
const logs = {
  stdout: statFile(launchAgent.stdoutPath),
  stderr: statFile(launchAgent.stderrPath),
};
const payload = {
  schema,
  checkedAt: new Date().toISOString(),
  backupDir,
  retention: {
    keep: 7,
    policy:
      "Keep seven dated backups. Before day 8 is written, delete the oldest dated backup so the new backup replaces day 1.",
    overRetentionCount: backups.overRetentionCount,
  },
  launchAgent,
  backups,
  logs,
  readOnlyGuarantee:
    "This command only reads the LaunchAgent plist, backup folder, and log metadata; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("TCOS nightly backup status:");
  console.log(`- backup folder: ${backupDir}`);
  console.log(`- backup folder exists: ${backups.exists ? "yes" : "no"}`);
  console.log(`- dated backup count: ${backups.count}`);
  console.log(`- retention: keep 7; over-retention count ${backups.overRetentionCount}`);
  console.log(`- newest backup: ${backups.newest ? `${backups.newest.name} (${backups.newest.modifiedAt})` : "none"}`);
  console.log(`- oldest backup: ${backups.oldest ? `${backups.oldest.name} (${backups.oldest.modifiedAt})` : "none"}`);
  console.log("");
  console.log("LaunchAgent:");
  console.log(`- installed: ${launchAgent.installed ? "yes" : "no"}`);
  console.log(`- path: ${launchAgent.path}`);
  console.log(`- schedule: ${launchAgent.schedule || "unknown"}`);
  console.log(`- command backup folder: ${launchAgent.backupDir || "not set"}`);
  console.log(`- stdout log: ${launchAgent.stdoutPath || "not set"}`);
  console.log(`- stderr log: ${launchAgent.stderrPath || "not set"}`);
  if (launchAgent.note) {
    console.log(`- note: ${launchAgent.note}`);
  }
  console.log("");
  console.log(`Read-only guarantee: ${payload.readOnlyGuarantee}`);
}
