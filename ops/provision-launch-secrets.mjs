import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const [appDirInput, envPathInput, evidenceDirInput] = process.argv.slice(2);
if (!appDirInput || !envPathInput || !evidenceDirInput) {
  throw new Error("Usage: node provision-launch-secrets.mjs <appDir> <envPath> <evidenceDir>");
}

const appDir = path.resolve(appDirInput);
const envPath = path.resolve(envPathInput);
const evidenceDir = path.resolve(evidenceDirInput);
const token = String(process.env.VERCEL_TOKEN || "").trim();
const scope = String(process.env.VERCEL_SCOPE || "").trim();
if (!token || !scope) throw new Error("Vercel credentials are unavailable.");

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const current = parseEnv(fs.readFileSync(envPath, "utf8"));
const required = ["ADMIN_SESSION_SECRET", "CRON_SECRET"];
const provisionedNames = [];

for (const name of required) {
  if (String(current[name] || "").trim()) continue;
  const value = randomBytes(48).toString("base64url");
  const result = spawnSync(
    "npx",
    [
      "vercel@56.2.0",
      "env",
      "add",
      name,
      "production",
      "--force",
      "--scope",
      scope,
      "--token",
      token,
    ],
    {
      cwd: appDir,
      input: `${value}\n`,
      encoding: "utf8",
      env: process.env,
      timeout: 2 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const safe = String(result.stderr || result.stdout || "")
      .replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]")
      .slice(0, 3000);
    throw new Error(`Unable to provision ${name}: ${safe}`);
  }
  provisionedNames.push(name);
}

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "production-launch-secret-provisioning.json"),
  JSON.stringify(
    {
      ok: true,
      requiredNames: required,
      provisionedNames,
      valuesRecorded: false,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`PRODUCTION_LAUNCH_SECRETS_READY=${required.length}`);
