#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = process.cwd();
const VERCEL_SCOPE = "truelycollectables-projects";
const VERCEL_PROJECT = "truely-collectables";
const DEFAULT_PREVIEW_URL =
  "https://truely-collectables-git-agen-65e523-truelycollectables-projects.vercel.app";
const DEFAULT_DESTINATION = "/admin/market-intel/deals/identity-review";
const LOCAL_PREVIEW_AUTH_FILE = ".env.admin-preview.local";

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

function secureRandomSecret(bytes = 36) {
  return randomBytes(bytes).toString("base64url");
}

function writePreviewAuthVault(adminPassword, sessionSecret) {
  const filePath = path.join(REPO_ROOT, LOCAL_PREVIEW_AUTH_FILE);
  const contents = [
    "# TCOS Vercel Preview admin credentials.",
    "# Generated locally; ignored by git; never display or commit this file.",
    `ADMIN_PASSWORD=${adminPassword}`,
    `ADMIN_SESSION_SECRET=${sessionSecret}`,
    "",
  ].join("\n");
  writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
  return filePath;
}

function loadOrCreateLocalAdminSecrets() {
  const candidates = [
    ".env.local",
    ".env.development.local",
    ".env.market-intel-worker.local",
    LOCAL_PREVIEW_AUTH_FILE,
  ];
  const merged = {};
  const filesRead = [];
  for (const name of candidates) {
    const filePath = path.join(REPO_ROOT, name);
    if (!existsSync(filePath)) continue;
    Object.assign(merged, parseEnvFile(filePath));
    filesRead.push(name);
  }

  let adminPassword = String(merged.ADMIN_PASSWORD || "").trim();
  let sessionSecret = String(merged.ADMIN_SESSION_SECRET || "").trim();
  let generated = false;

  if (!adminPassword) {
    adminPassword = secureRandomSecret(36);
    generated = true;
  }
  if (!sessionSecret) {
    sessionSecret = secureRandomSecret(48);
    generated = true;
  }

  const vaultPath = writePreviewAuthVault(adminPassword, sessionSecret);
  if (!filesRead.includes(LOCAL_PREVIEW_AUTH_FILE)) {
    filesRead.push(LOCAL_PREVIEW_AUTH_FILE);
  }

  return {
    adminPassword,
    sessionSecret,
    filesRead,
    generated,
    vaultPath,
  };
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
  const text = String(value || "").trim();
  const urls = text.match(/https:\/\/[^\s]+/g) || [];
  const candidate = urls.at(-1) || text || DEFAULT_PREVIEW_URL;
  const url = new URL(candidate.replace(/[),.;]+$/, ""));
  return `${url.protocol}//${url.host}`;
}

const previewUrl = cleanPreviewUrl(process.argv[2] || DEFAULT_PREVIEW_URL);
const destination = String(process.argv[3] || DEFAULT_DESTINATION).startsWith("/")
  ? String(process.argv[3] || DEFAULT_DESTINATION)
  : `/${String(process.argv[3] || DEFAULT_DESTINATION)}`;

try {
  const {
    adminPassword,
    sessionSecret,
    filesRead,
    generated,
    vaultPath,
  } = loadOrCreateLocalAdminSecrets();
  ensureVercelCli();

  console.log(
    generated
      ? "Created a locked local preview-auth vault. Credentials will not be displayed."
      : "Reusing the locked local preview-auth vault. Credentials will not be displayed.",
  );
  console.log("Syncing admin credentials to Vercel Preview only...");
  setPreviewSecret("ADMIN_PASSWORD", adminPassword);
  setPreviewSecret("ADMIN_SESSION_SECRET", sessionSecret);

  console.log("Redeploying the preview so the synchronized credentials take effect...");
  const redeploy = run(
    "vercel",
    ["redeploy", previewUrl, "--target=preview", "--scope", VERCEL_SCOPE],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const redeployedUrl = cleanPreviewUrl(String(redeploy.stdout || previewUrl));

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
        previewAuthVault: vaultPath,
        previewAuthVaultMode: "0600",
        credentialsGenerated: generated,
        credentialsDisplayed: false,
        previewRedeployed: true,
        openedAdminDestination: destination,
        previewUrl: redeployedUrl,
        note: "The signed handoff is stripped from the URL immediately after the preview creates the 30-day admin cookie.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
