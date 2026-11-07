import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  const modifiedAt = stat.mtime.toISOString();
  return {
    path: filePath,
    bytes: stat.size,
    modifiedAt,
    modifiedAtLocal: formatLocalTimestamp(modifiedAt),
  };
}

function formatLocalTimestamp(isoTimestamp) {
  if (!isoTimestamp) return null;
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function scheduleHealthPayload({
  state,
  lastScheduledRunAt = null,
  nextScheduledRunAt = null,
  latestBackupAt = null,
  message,
}) {
  return {
    state,
    lastScheduledRunAt,
    lastScheduledRunAtLocal: formatLocalTimestamp(lastScheduledRunAt),
    nextScheduledRunAt,
    nextScheduledRunAtLocal: formatLocalTimestamp(nextScheduledRunAt),
    latestBackupAt,
    latestBackupAtLocal: formatLocalTimestamp(latestBackupAt),
    message,
  };
}

function parseNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLaunchdRuntime(label) {
  if (process.platform !== "darwin") {
    return {
      supported: false,
      checked: false,
      loaded: false,
      domain: null,
      state: null,
      activeCount: null,
      runs: null,
      lastExitCode: null,
      message: "launchd runtime status is macOS-only.",
    };
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    return {
      supported: true,
      checked: false,
      loaded: false,
      domain: null,
      state: null,
      activeCount: null,
      runs: null,
      lastExitCode: null,
      message: "Could not determine the current macOS user id for launchctl.",
    };
  }

  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  const result = spawnSync("launchctl", ["print", target], {
    encoding: "utf8",
  });
  const stdout = result.stdout || "";
  const stderr = (result.stderr || "").trim();

  if (result.status !== 0) {
    return {
      supported: true,
      checked: true,
      loaded: false,
      domain,
      state: null,
      activeCount: null,
      runs: null,
      lastExitCode: null,
      message:
        stderr ||
        `launchctl could not print ${target}; the LaunchAgent may not be loaded in the user session.`,
    };
  }

  const state = extractFirst(stdout, /^\s*state = ([^\n]+)$/m);
  const activeCount = parseNullableNumber(extractFirst(stdout, /^\s*active count = (\d+)$/m));
  const runs = parseNullableNumber(extractFirst(stdout, /^\s*runs = (\d+)$/m));
  const lastExitCode = extractFirst(stdout, /^\s*last exit code = ([^\n]+)$/m);

  return {
    supported: true,
    checked: true,
    loaded: true,
    domain,
    state,
    activeCount,
    runs,
    lastExitCode,
    message: `launchctl reports ${label} is loaded in ${domain}.`,
  };
}

function scheduleWindow(schedule) {
  const match = schedule?.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const now = new Date();
  const todayRun = new Date(now);
  todayRun.setHours(hour, minute, 0, 0);

  const lastRun = new Date(todayRun);
  if (now < todayRun) {
    lastRun.setDate(lastRun.getDate() - 1);
  }

  const nextRun = new Date(lastRun);
  nextRun.setDate(nextRun.getDate() + 1);

  return {
    now,
    lastScheduledRunAt: lastRun,
    nextScheduledRunAt: nextRun,
  };
}

function backupScheduleHealth(launchAgent, backups) {
  if (!launchAgent.supported) {
    return scheduleHealthPayload({
      state: "unsupported_platform",
      latestBackupAt: backups.newest?.modifiedAt || null,
      message: "LaunchAgent schedule health is macOS-only.",
    });
  }

  if (!launchAgent.installed) {
    return scheduleHealthPayload({
      state: "not_installed",
      latestBackupAt: backups.newest?.modifiedAt || null,
      message: "Nightly backup LaunchAgent is not installed.",
    });
  }

  const window = scheduleWindow(launchAgent.schedule);
  if (!window) {
    return scheduleHealthPayload({
      state: "unknown_schedule",
      latestBackupAt: backups.newest?.modifiedAt || null,
      message: "Nightly backup LaunchAgent schedule could not be parsed.",
    });
  }

  const launchAgentFile = statFile(launchAgent.path);
  const installedAt = launchAgentFile?.modifiedAt || null;
  const installedAfterLastRun =
    installedAt && new Date(installedAt).getTime() > window.lastScheduledRunAt.getTime();
  const latestBackupAt = backups.newest?.modifiedAt || null;
  const latestBackupIsCurrent =
    latestBackupAt &&
    new Date(latestBackupAt).getTime() >= window.lastScheduledRunAt.getTime();

  if (latestBackupIsCurrent) {
    return scheduleHealthPayload({
      state: "current",
      lastScheduledRunAt: window.lastScheduledRunAt.toISOString(),
      nextScheduledRunAt: window.nextScheduledRunAt.toISOString(),
      latestBackupAt,
      message: "Latest dated backup is current for the last scheduled run.",
    });
  }

  if (installedAfterLastRun && backups.count === 0) {
    return scheduleHealthPayload({
      state: "pending_first_run",
      lastScheduledRunAt: window.lastScheduledRunAt.toISOString(),
      nextScheduledRunAt: window.nextScheduledRunAt.toISOString(),
      latestBackupAt,
      message: "LaunchAgent was installed after the last scheduled run; first backup is pending.",
    });
  }

  return scheduleHealthPayload({
    state: "overdue_or_failed",
    lastScheduledRunAt: window.lastScheduledRunAt.toISOString(),
    nextScheduledRunAt: window.nextScheduledRunAt.toISOString(),
    latestBackupAt,
    message:
      "No dated backup is present for the last scheduled run. The Mac may have been asleep, offline, or the nightly job may have failed; inspect the backup logs.",
  });
}

function launchdExitSucceeded(lastExitCode) {
  if (!lastExitCode) {
    return false;
  }

  return lastExitCode.trim() === "0";
}

function schedulerProof(launchAgent, launchdRuntime) {
  if (!launchAgent.supported || !launchdRuntime.supported) {
    return {
      state: "unsupported_platform",
      automaticRunProven: false,
      message: "Automatic scheduler proof is macOS launchd-only.",
      nextAction: "Check the platform-native scheduler manually.",
    };
  }

  if (!launchAgent.installed) {
    return {
      state: "not_installed",
      automaticRunProven: false,
      message: "Nightly backup LaunchAgent is not installed.",
      nextAction: "Run npm run backup:nightly:install.",
    };
  }

  if (!launchdRuntime.checked) {
    return {
      state: "unchecked",
      automaticRunProven: false,
      message: launchdRuntime.message || "launchd runtime state could not be checked.",
      nextAction: "Run npm run status:nightly-backup again in an interactive macOS user session.",
    };
  }

  if (!launchdRuntime.loaded) {
    return {
      state: "not_loaded",
      automaticRunProven: false,
      message: launchdRuntime.message || "LaunchAgent is installed but not loaded in launchd.",
      nextAction: "Reinstall or reload with npm run backup:nightly:install.",
    };
  }

  if (launchdRuntime.runs === 0) {
    return {
      state: "automatic_unproven",
      automaticRunProven: false,
      message:
        "LaunchAgent is loaded, but launchd has not recorded an automatic backup run yet.",
      nextAction:
        "Keep the manual backup, leave the Mac awake for the next 02:30 run, then rerun npm run status:nightly-backup.",
    };
  }

  if (launchdRuntime.runs !== null && launchdRuntime.runs > 0) {
    const succeeded = launchdExitSucceeded(launchdRuntime.lastExitCode);
    if (succeeded) {
      return {
        state: "automatic_proven",
        automaticRunProven: true,
        message: "launchd has recorded at least one successful automatic backup run.",
        nextAction: "Keep monitoring with npm run status:nightly-backup.",
      };
    }

    return {
      state: "automatic_failed",
      automaticRunProven: false,
      message: `launchd has recorded ${
        launchdRuntime.runs
      } run(s), but the last exit code was ${launchdRuntime.lastExitCode || "unknown"}.`,
      nextAction: "Inspect the backup stdout/stderr logs and rerun npm run backup:nightly if needed.",
    };
  }

  return {
    state: "unknown",
    automaticRunProven: false,
    message: "launchd is loaded, but its run count could not be parsed.",
    nextAction: "Inspect launchctl print output and rerun npm run status:nightly-backup.",
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
        modifiedAtLocal: formatLocalTimestamp(stat.mtime.toISOString()),
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
const launchdRuntime = readLaunchdRuntime(launchAgent.label);
const scheduleHealth = backupScheduleHealth(launchAgent, backups);
const automaticSchedulerProof = schedulerProof(launchAgent, launchdRuntime);
const payload = {
  schema,
  checkedAt: new Date().toISOString(),
  backupDir,
  scheduleHealth,
  schedulerProof: automaticSchedulerProof,
  launchdRuntime,
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
    "This command only reads the LaunchAgent plist, launchd runtime state, backup folder, and log metadata; it creates no archive, starts no Git push, deploy, Checkout, postage, payout, launch approval, or revocation.",
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("TCOS nightly backup status:");
  console.log(`- backup folder: ${backupDir}`);
  console.log(`- backup folder exists: ${backups.exists ? "yes" : "no"}`);
  console.log(`- dated backup count: ${backups.count}`);
  console.log(`- retention: keep 7; over-retention count ${backups.overRetentionCount}`);
  console.log(`- newest backup: ${backups.newest ? `${backups.newest.name} (${backups.newest.modifiedAt}; ${backups.newest.modifiedAtLocal} local)` : "none"}`);
  console.log(`- oldest backup: ${backups.oldest ? `${backups.oldest.name} (${backups.oldest.modifiedAt}; ${backups.oldest.modifiedAtLocal} local)` : "none"}`);
  console.log(`- schedule health: ${scheduleHealth.state}`);
  console.log(`- schedule message: ${scheduleHealth.message}`);
  console.log(`- scheduler proof: ${automaticSchedulerProof.state}`);
  console.log(`- automatic run proven: ${automaticSchedulerProof.automaticRunProven ? "yes" : "no"}`);
  console.log(`- scheduler proof message: ${automaticSchedulerProof.message}`);
  console.log(`- scheduler next action: ${automaticSchedulerProof.nextAction}`);
  console.log(`- last scheduled run: ${scheduleHealth.lastScheduledRunAt || "unknown"}`);
  console.log(`- last scheduled run local: ${scheduleHealth.lastScheduledRunAtLocal || "unknown"}`);
  console.log(`- next scheduled run: ${scheduleHealth.nextScheduledRunAt || "unknown"}`);
  console.log(`- next scheduled run local: ${scheduleHealth.nextScheduledRunAtLocal || "unknown"}`);
  console.log(`- launchd loaded: ${launchdRuntime.loaded ? "yes" : "no"}`);
  console.log(`- launchd state: ${launchdRuntime.state || "unknown"}`);
  console.log(`- launchd runs: ${launchdRuntime.runs ?? "unknown"}`);
  console.log(`- launchd last exit code: ${launchdRuntime.lastExitCode || "unknown"}`);
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
