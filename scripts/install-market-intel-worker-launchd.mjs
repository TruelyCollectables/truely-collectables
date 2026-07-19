import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LABEL = "com.truelycollectables.market-intel-worker";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const launchAgentsDirectory = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgentsDirectory, `${LABEL}.plist`);
const logDirectory = path.join(os.homedir(), "Library", "Logs", "TCOS-Market-Intel");
const stdoutPath = path.join(logDirectory, "worker.stdout.log");
const stderrPath = path.join(logDirectory, "worker.stderr.log");
const runnerPath = path.join(repoRoot, "scripts", "run-market-intel-worker-cycle.sh");
const args = process.argv.slice(2);

if (process.platform !== "darwin") {
  throw new Error("This installer is only for macOS. Use the container deployment for Linux/cloud hosts.");
}

const protectedRoot = macosProtectedUserRoot(repoRoot);
if (protectedRoot) {
  throw new Error(
    [
      `The worker repository is inside a macOS privacy-protected folder: ${protectedRoot}`,
      "LaunchAgents can be denied background access to Desktop, Documents, or Downloads even when Terminal can read the same files.",
      `Move the worker clone to ${path.join(os.homedir(), "Library", "Application Support", "TCOS-Market-Intel", "worker")} and reinstall.`,
    ].join("\n"),
  );
}

const minutes = integerArg("--minutes", 15, 5, 1440);
const envFile = path.resolve(
  stringArg("--env-file") || path.join(repoRoot, ".env.market-intel-worker.local"),
);

if (!fs.existsSync(runnerPath)) {
  throw new Error(`Worker runner is missing: ${runnerPath}`);
}
if (!fs.existsSync(envFile)) {
  throw new Error(
    `Worker environment file is missing: ${envFile}\nCreate it first, then run chmod 600 on it.`,
  );
}

const envValues = parseEnvFile(envFile);
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
]) {
  if (!envValues.has(name) || !String(envValues.get(name) || "").trim()) {
    throw new Error(`Required worker setting is missing from ${envFile}: ${name}`);
  }
}

const maxIdentities = clampNumber(envValues.get("MARKET_INTEL_WORKER_MAX_IDENTITIES"), 4, 1, 20);
const maxQueries = clampNumber(envValues.get("MARKET_INTEL_WORKER_MAX_QUERIES"), 8, 2, 10);
const estimatedCallsPerDay = Math.ceil(1440 / minutes) * maxIdentities * maxQueries;
if (estimatedCallsPerDay > 4500) {
  throw new Error(
    `This schedule could use about ${estimatedCallsPerDay} eBay Browse calls/day. Increase --minutes or lower identities/query families before installing.`,
  );
}

fs.mkdirSync(launchAgentsDirectory, { recursive: true });
fs.mkdirSync(logDirectory, { recursive: true });

const uid = process.getuid?.();
if (uid === undefined) throw new Error("Unable to resolve the current macOS user ID.");
const domain = `gui/${uid}`;
const serviceTarget = `${domain}/${LABEL}`;
const plist = buildPlist({
  label: LABEL,
  repoRoot,
  runnerPath,
  envFile,
  nodeBinary: process.execPath,
  intervalSeconds: minutes * 60,
  stdoutPath,
  stderrPath,
});

spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
fs.writeFileSync(plistPath, plist, { mode: 0o600 });
fs.chmodSync(plistPath, 0o600);

const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plistPath], {
  encoding: "utf8",
});
if (bootstrap.status !== 0) {
  throw new Error(
    `launchctl bootstrap failed: ${bootstrap.stderr || bootstrap.stdout || "unknown error"}`,
  );
}

const kickstart = spawnSync("launchctl", ["kickstart", "-k", serviceTarget], {
  encoding: "utf8",
});
if (kickstart.status !== 0) {
  throw new Error(
    `Worker was installed but kickstart failed: ${kickstart.stderr || kickstart.stdout || "unknown error"}`,
  );
}

console.log(
  JSON.stringify(
    {
      installed: true,
      label: LABEL,
      scheduleMinutes: minutes,
      estimatedMaximumCallsPerDay: estimatedCallsPerDay,
      repoRoot,
      launchdSafeRepoLocation: true,
      envFile,
      plistPath,
      stdoutPath,
      stderrPath,
      nodeBinary: process.execPath,
      secretsEmbeddedInPlist: false,
      cloudPortable: true,
      statusCommand: "node scripts/status-market-intel-worker-launchd.mjs",
      uninstallCommand: "node scripts/uninstall-market-intel-worker-launchd.mjs",
    },
    null,
    2,
  ),
);

function stringArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

function integerArg(name, fallback, minimum, maximum) {
  const raw = stringArg(name);
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function clampNumber(raw, fallback, minimum, maximum) {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function macosProtectedUserRoot(candidatePath) {
  const home = path.resolve(os.homedir());
  for (const folderName of ["Desktop", "Documents", "Downloads"]) {
    const protectedPath = path.join(home, folderName);
    if (candidatePath === protectedPath || candidatePath.startsWith(`${protectedPath}${path.sep}`)) {
      return protectedPath;
    }
  }
  return "";
}

function parseEnvFile(filePath) {
  const values = new Map();
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildPlist(input) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${xml(input.runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(input.repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MARKET_INTEL_WORKER_ENV_FILE</key>
    <string>${xml(input.envFile)}</string>
    <key>MARKET_INTEL_NODE_BIN</key>
    <string>${xml(input.nodeBinary)}</string>
    <key>MARKET_INTEL_WORKER_NAME</key>
    <string>mac-private-worker</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${input.intervalSeconds}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>Nice</key>
  <integer>5</integer>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${xml(input.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(input.stderrPath)}</string>
</dict>
</plist>
`;
}
