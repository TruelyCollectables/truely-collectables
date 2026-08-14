import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(message);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function walk(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(target));
    else out.push(target);
  }
  return out;
}

for (const removed of ["vercel.json", ".vercelignore"]) {
  if (fs.existsSync(removed)) fail(`${removed} must not exist after Cloudflare cutover.`);
}

const packageJson = read("package.json");
const packageLock = read("package-lock.json");
for (const [label, text] of [["package.json", packageJson], ["package-lock.json", packageLock]]) {
  if (/@vercel\/|node_modules\/vercel/i.test(text)) {
    fail(`${label} still contains a Vercel package dependency.`);
  }
}

const operationalFiles = [
  ...walk(".github/workflows"),
  ...walk("src"),
  ...walk("services"),
  ...walk("scripts"),
].filter((file) => !file.endsWith("check-production-guardrails.mjs"));

const forbidden = /api\.vercel\.com|\bnpx\s+vercel\b|\bvercel\s+env\b|VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID|@vercel\//i;
const violations = operationalFiles.filter((file) => forbidden.test(read(file)));
if (violations.length > 0) {
  fail(`Operational Vercel references remain:\n${violations.join("\n")}`);
}

const worker = read("cloudflare-worker.ts");
const wrangler = read("wrangler.jsonc");
if (!worker.includes('headers.set("X-Truely-Origin", "cloudflare-worker")')) {
  fail("Cloudflare origin receipt header is missing.");
}
if (!wrangler.includes('"name": "truely-collectables"')) {
  fail("Cloudflare Worker production name is missing.");
}
if (!wrangler.includes('"* * * * *"')) {
  fail("Cloudflare production cron trigger is missing.");
}

console.log("PASS Cloudflare is the only production deployment target in operational code.");
console.log("PASS Legacy deployment packages, config, API calls, and workflow credentials are absent.");
console.log("PASS Cloudflare Worker origin receipt and scheduler are configured.");
