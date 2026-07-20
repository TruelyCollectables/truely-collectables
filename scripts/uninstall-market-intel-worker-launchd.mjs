import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LABEL = "com.truelycollectables.market-intel-worker";
if (process.platform !== "darwin") {
  throw new Error("This uninstaller is only available on macOS.");
}

const uid = process.getuid?.();
if (uid === undefined) throw new Error("Unable to resolve the current macOS user ID.");
const domain = `gui/${uid}`;
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logDirectory = path.join(os.homedir(), "Library", "Logs", "TCOS-Market-Intel");
const purgeLogs = process.argv.includes("--purge-logs");

spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
if (fs.existsSync(plistPath)) fs.rmSync(plistPath);
if (purgeLogs && fs.existsSync(logDirectory)) {
  fs.rmSync(logDirectory, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      uninstalled: true,
      label: LABEL,
      plistRemoved: !fs.existsSync(plistPath),
      logsPurged: purgeLogs,
      environmentFilePreserved: true,
      note: "The local worker environment file and Supabase data were not deleted.",
    },
    null,
    2,
  ),
);
