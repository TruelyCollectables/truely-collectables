import { spawnSync } from "node:child_process";
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

function parseSchedulePart(name, fallback, min, max) {
  const raw = readOption(name, fallback);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}. Received: ${raw}`);
  }
  return parsed;
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function printCommandFailure(name, result) {
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  console.error(`${name} failed${output ? `:\n${output}` : ""}`);
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

if (process.platform !== "darwin") {
  throw new Error("The nightly LaunchAgent installer is macOS-only.");
}

const label = readOption("--label", "com.truelycollectables.nightly-emergency-backup");
const hour = parseSchedulePart("--hour", "2", 0, 23);
const minute = parseSchedulePart("--minute", "30", 0, 59);
const noLoad = hasFlag("--no-load");
const home = os.homedir();
const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
const backupRoot = path.join(home, "TCOS_BACKUP", "nightly");
const logsDir = path.join(backupRoot, "logs");
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const command = `cd ${shellQuote(repoRoot)} && /usr/bin/env npm run backup:nightly`;
const uid = typeof process.getuid === "function" ? process.getuid() : null;
const target = uid === null ? null : `gui/${uid}`;

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logsDir, "nightly-emergency-backup.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logsDir, "nightly-emergency-backup.err.log"))}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
</dict>
</plist>
`;

fs.writeFileSync(plistPath, plist);

console.log(`Wrote LaunchAgent: ${plistPath}`);
console.log(`Nightly backup schedule: ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} local time`);
console.log(`Backup/log root: ${backupRoot}`);

if (noLoad) {
  console.log("LaunchAgent load skipped by --no-load.");
  process.exit(0);
}

if (!target) {
  console.log("LaunchAgent load skipped because the current user id could not be detected.");
  process.exit(0);
}

run("launchctl", ["bootout", target, plistPath]);
const bootstrap = run("launchctl", ["bootstrap", target, plistPath]);
if (bootstrap.status !== 0) {
  printCommandFailure("launchctl bootstrap", bootstrap);
  process.exit(1);
}

const enable = run("launchctl", ["enable", `${target}/${label}`]);
if (enable.status !== 0) {
  printCommandFailure("launchctl enable", enable);
  process.exit(1);
}

console.log(`Loaded LaunchAgent ${label}.`);
console.log("To run an immediate manual backup: npm run backup:nightly");
