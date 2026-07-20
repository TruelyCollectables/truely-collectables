#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = process.cwd();
const VERCEL_PROJECT = "truely-collectables";
const KNOWN_PROJECT_ID = "prj_8mJZCaMhTddaKgcFFJYPwWWu0P4mk";
const DEFAULT_PREVIEW_URL =
  "https://truely-collectables-git-agen-65e523-truelycollectables-projects.vercel.app";
const DEFAULT_DESTINATION = "/admin/market-intel/deals/identity-review";
const LOCAL_PREVIEW_AUTH_FILE = ".env.admin-preview.local";
const LOCAL_VERCEL_LINK_FILE = path.join(REPO_ROOT, ".vercel", "project.json");

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
    const stdout = String(result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${stderr || stdout ? `: ${stderr || stdout}` : "."}`,
    );
  }
  return result;
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...options,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    status: result.status,
  };
}

function readProjectLink(filePath) {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    const orgId = String(value.orgId || "").trim();
    const projectId = String(value.projectId || "").trim();
    const projectName = String(value.projectName || "").trim();
    if (!orgId || !projectId) return null;
    return { orgId, projectId, projectName };
  } catch {
    return null;
  }
}

function isTargetProjectLink(link) {
  return Boolean(
    link &&
      (link.projectId === KNOWN_PROJECT_ID || link.projectName === VERCEL_PROJECT),
  );
}

function installProjectLink(link) {
  mkdirSync(path.dirname(LOCAL_VERCEL_LINK_FILE), { recursive: true });
  writeFileSync(
    LOCAL_VERCEL_LINK_FILE,
    `${JSON.stringify(
      {
        orgId: link.orgId,
        projectId: link.projectId,
        projectName: link.projectName || VERCEL_PROJECT,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(LOCAL_VERCEL_LINK_FILE, 0o600);
  return readProjectLink(LOCAL_VERCEL_LINK_FILE);
}

function recoverProjectLinkFromEnvironment() {
  const orgId = String(process.env.VERCEL_ORG_ID || "").trim();
  const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();
  if (!orgId || !projectId) return null;
  const link = { orgId, projectId, projectName: VERCEL_PROJECT };
  return isTargetProjectLink(link) ? installProjectLink(link) : null;
}

function recoverProjectLinkFromMac() {
  if (process.platform !== "darwin") return null;
  const query = 'kMDItemFSName == "project.json"c';
  const result = tryRun("mdfind", [query], { stdio: ["ignore", "pipe", "ignore"] });
  if (!result.ok) return null;

  const paths = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(
      (value) =>
        value &&
        value !== LOCAL_VERCEL_LINK_FILE &&
        value.endsWith(`${path.sep}.vercel${path.sep}project.json`) &&
        value.startsWith(homedir()),
    );

  for (const candidatePath of paths) {
    const link = readProjectLink(candidatePath);
    if (isTargetProjectLink(link)) {
      return {
        link: installProjectLink(link),
        source: candidatePath,
      };
    }
  }
  return null;
}

function currentProjectLink() {
  const link = readProjectLink(LOCAL_VERCEL_LINK_FILE);
  return isTargetProjectLink(link) ? link : null;
}

function tryGitIntegratedLink() {
  const result = tryRun("vercel", ["link", "--repo", "--yes"], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  return result.ok ? currentProjectLink() : null;
}

function tryProjectLink(scope) {
  const inspectArgs = ["project", "inspect", VERCEL_PROJECT];
  if (scope) inspectArgs.push("--scope", scope);
  const inspected = tryRun("vercel", inspectArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!inspected.ok) return null;

  const linkArgs = ["link", "--yes", "--project", VERCEL_PROJECT];
  if (scope) linkArgs.push("--scope", scope);
  const linked = tryRun("vercel", linkArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return linked.ok ? currentProjectLink() : null;
}

function teamIdsFromCli() {
  const result = tryRun("vercel", ["teams", "list"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!result.ok) return [];
  return Array.from(
    new Set((`${result.stdout}\n${result.stderr}`.match(/\bteam_[A-Za-z0-9]+\b/g) || [])),
  );
}

function ensureVercelProjectLink() {
  run("vercel", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });

  const existing = currentProjectLink();
  if (existing) return { link: existing, source: "current-worker-link" };

  const environmentLink = recoverProjectLinkFromEnvironment();
  if (environmentLink) {
    return { link: environmentLink, source: "VERCEL_ORG_ID/VERCEL_PROJECT_ID" };
  }

  const recovered = recoverProjectLinkFromMac();
  if (recovered?.link) {
    return { link: recovered.link, source: `recovered:${recovered.source}` };
  }

  const gitLinked = tryGitIntegratedLink();
  if (gitLinked) return { link: gitLinked, source: "vercel-link-repo" };

  const currentScopeLink = tryProjectLink(null);
  if (currentScopeLink) {
    return { link: currentScopeLink, source: "current-vercel-scope" };
  }

  for (const teamId of teamIdsFromCli()) {
    const teamLink = tryProjectLink(teamId);
    if (teamLink) return { link: teamLink, source: `vercel-team:${teamId}` };
  }

  const whoami = tryRun("vercel", ["whoami"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const account = String(whoami.stdout || whoami.stderr || "unknown account").trim();
  throw new Error(
    `The Vercel CLI account (${account}) cannot access the Git-linked ${VERCEL_PROJECT} project. Run \"vercel logout\", then \"vercel login\" with the account that owns Truely Collectables, and rerun this script. No production settings were changed.`,
  );
}

function setPreviewSecret(name, value) {
  run(
    "vercel",
    ["env", "add", name, "preview", "--force", "--sensitive"],
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
  const projectLink = ensureVercelProjectLink();

  console.log(
    generated
      ? "Created a locked local preview-auth vault. Credentials will not be displayed."
      : "Reusing the locked local preview-auth vault. Credentials will not be displayed.",
  );
  console.log(`Linked Vercel project recovered through ${projectLink.source}.`);
  console.log("Syncing admin credentials to Vercel Preview only...");
  setPreviewSecret("ADMIN_PASSWORD", adminPassword);
  setPreviewSecret("ADMIN_SESSION_SECRET", sessionSecret);

  console.log("Redeploying the preview so the synchronized credentials take effect...");
  const redeploy = run(
    "vercel",
    ["redeploy", previewUrl, "--target=preview"],
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
        projectName: projectLink.link.projectName || VERCEL_PROJECT,
        projectId: projectLink.link.projectId,
        projectLinkSource: projectLink.source,
        localFilesRead: filesRead,
        previewAuthVault: vaultPath,
        previewAuthVaultMode: "0600",
        credentialsGenerated: generated,
        credentialsDisplayed: false,
        previewRedeployed: true,
        openedAdminDestination: destination,
        previewUrl: redeployedUrl,
        productionChanged: false,
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
