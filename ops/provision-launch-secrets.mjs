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

const projectLink = JSON.parse(fs.readFileSync(path.join(appDir, ".vercel", "project.json"), "utf8"));
const projectId = String(projectLink.projectId || "").trim();
const orgId = String(projectLink.orgId || "").trim();
if (!projectId || !orgId) throw new Error("Vercel project linkage is incomplete.");

const response = await fetch(
  `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?teamId=${encodeURIComponent(orgId)}&decrypt=false`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const responseBody = await response.text();
if (!response.ok) {
  throw new Error(`Unable to list Vercel Production environment names: HTTP ${response.status}.`);
}
const payload = JSON.parse(responseBody);
const envRows = Array.isArray(payload?.envs) ? payload.envs : [];
const existingProductionNames = new Set(
  envRows
    .filter((row) => Array.isArray(row?.target) && row.target.includes("production"))
    .map((row) => String(row?.key || "").trim())
    .filter(Boolean),
);

const required = ["ADMIN_SESSION_SECRET", "CRON_SECRET"];
const provisionedNames = [];

for (const name of required) {
  if (existingProductionNames.has(name)) continue;
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
      previouslyPresentNames: required.filter((name) => existingProductionNames.has(name)),
      provisionedNames,
      valuesRecorded: false,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`PRODUCTION_LAUNCH_SECRETS_READY=${required.length}`);
