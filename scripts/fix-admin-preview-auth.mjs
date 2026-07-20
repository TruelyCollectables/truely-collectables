#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = process.cwd();
const VERCEL_SCOPE = "truelycollectables-projects";
const VERCEL_PROJECT = "truely-collectables";
const DEFAULT_PREVIEW_URL =
  "https://truely-collectables-git-agen-65e523-truelycollectables-projects.vercel.app";
const DEFAULT_DESTINATION = "/admin/market-intel/deals/identity-review";

function parseEnvFile(filePath) {
  const values = {};
  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadLocalAdminSecrets() {
  const candidates = [
    ".env.local",
    ".env.development.local",
    ".env.market-intel-worker.local",
  ];
  const merged = {};
  const filesRead = [];
  for (const name of candidates) {
    const filePath = path.join(REPO_ROOT, name);
    if (!existsSync(filePath)) continue;
    Object.assign(merged, parseEnvFile(filePath));
    filesRead.push(name);
  }
  const adminPassword = String(merged.ADMIN_PASSWORD || "").trim();
  const sessionSecret = String(
    merged.ADMIN_SESSION_SECRET || merged.ADMIN_PASSWORD || "",
  ).trim();
  if (!adminPassword) {
    throw new Error(
      "ADMIN_PASSWORD was not found in .env.local, .env.development.local, or .env.market-intel-worker.local.",
    );
  }
  if (!sessionSecret) {
    throw new Error("ADMIN_SESSION_SECRET or ADMIN_PASSWORD is required.");
  }
  return { adminPassword, sessionSecret, filesRead };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : "."}`,
    );
  }
  return result;
}

function ensureVercelCli() {
  run("vercel", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  if (existsSync(path.join(REPO_ROOT, ".vercel", "project.json"))) return;
  run(
    "vercel",
    [
      "link",
      "--yes",
      "--project",
      VERCEL_PROJECT,
      "--scope",
      VERCEL_SCOPE,
    ],
    { stdio: "inherit" },
  );
}

function setPreviewSecret(name, value) {
  run(
    "vercel",
    [
      "env",
      "add",
      name,
      "preview",
      "--force",
      "--sensitive",
      "--scope",
      VERCEL_SCOPE,
    ],
    {
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
}

function createAdminHandoff(secret) {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(issuedAt)
    .digest("base64url");
  return `${issuedAt}.${signature}`;
}

function openUrl(url) {
  run("open", [url], { stdio: "ignore" });
}

function cleanPreviewUrl(value) {
  const url = new URL(value || DEFAULT_PREVIEW_URL);
  return `${url.protocol}//${url.host}`;
}

const previewUrl = cleanPreviewUrl(process.argv[2] || DEFAULT_PREVIEW_URL);
const destination = String(process.argv[3] || DEFAULT_DESTINATION).startsWith("/")
  ? String(process.argv[3] || DEFAULT_DESTINATION)
  : `/${String(process.argv[3] || DEFAULT_DESTINATION)}`;

try {
  const { adminPassword, sessionSecret, filesRead } = loadLocalAdminSecrets();
  ensureVercelCli();

  console.log("Syncing the local admin credentials to Vercel Preview without displaying them...");
  setPreviewSecret("ADMIN_PASSWORD", adminPassword);
  setPreviewSecret("ADMIN_SESSION_SECRET", sessionSecret);

  console.log("Redeploying the current preview so the corrected credentials take effect...");
  const redeploy = run(
    "vercel",
    ["redeploy", previewUrl, "--target=preview", "--scope", VERCEL_SCOPE],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const redeployedUrl = cleanPreviewUrl(String(redeploy.stdout || previewUrl).trim());

  const handoff = createAdminHandoff(sessionSecret);
  const target = new URL(destination, redeployedUrl);
  target.searchParams.set("admin_handoff", handoff);
  openUrl(target.toString());

  console.log(
    JSON.stringify(
      {
        fixed: true,
        environment: "preview",
        project: `${VERCEL_SCOPE}/${VERCEL_PROJECT}`,
        localFilesRead: filesRead,
        credentialsDisplayed: false,
        previewRedeployed: true,
        openedAdminDestination: destination,
        previewUrl: redeployedUrl,
        note: "The signed handoff is stripped from the URL immediately after the preview creates the admin cookie.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
