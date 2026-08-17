import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const PLAN_DIR = resolve(process.env.THE_CUP_CERTIFIED_PLAN_DIR || "");
const OUTPUT = resolve(process.env.THE_CUP_MANAGEMENT_RECEIPT || `${ROOT}/the-cup-management-receipt.json`);
const EXACT_KEY = "hockey|2022-23|upper-deck|the-cup-nhl";
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b50[0234]\b|\b52[125]\b|\b544\b|fetch failed|network|aborted|temporar|lock timeout/i.test(String(message || ""));

async function retry(label, fn) {
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { return await fn(); }
    catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      console.warn(`${label} attempt ${attempt}/6 failed: ${last.message}`);
      if (attempt === 6 || !transient(last.message)) break;
      await sleep(Math.min(60_000, attempt * 10_000));
    }
  }
  throw last || new Error(`${label} failed`);
}

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
if (!PLAN_DIR || !existsSync(PLAN_DIR)) throw new Error(`Certified The Cup plan directory is missing: ${PLAN_DIR}`);
const planPath = resolve(PLAN_DIR, `${safeSlug(EXACT_KEY)}.json`);
if (!existsSync(planPath)) throw new Error(`Certified plan is missing: ${planPath}`);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (plan?.validation?.status !== "passed") throw new Error(`Certified The Cup plan is not validation-passed.`);
if (!String(plan?.release?.releaseSlug || "").endsWith("-hockey")) throw new Error(`Refusing non-Hockey The Cup plan.`);
const sourcesDir = resolve(ROOT, "output/sources");
const prefix = `${safeSlug(EXACT_KEY)}__`;
const sourceName = readdirSync(sourcesDir).find((name) => name.startsWith(prefix));
if (!sourceName) throw new Error(`Immutable The Cup source is missing.`);
const bytes = readFileSync(resolve(sourcesDir, sourceName));
const receipt = { schema: "tcos.certifiedTheCupManagementApply.v1", exactSetKey: EXACT_KEY, releaseSlug: plan.release.releaseSlug, counts: plan.validation.counts };
try {
  const before = await retry("The Cup preflight", () => preflightReleaseManagement(plan.release.releaseSlug));
  receipt.preflight = before;
  if (before.complete) {
    receipt.status = "already_live";
  } else {
    receipt.transaction = await retry("The Cup persist", () => persistPlanManagement(plan, bytes));
    const after = await retry("The Cup postflight", () => preflightReleaseManagement(plan.release.releaseSlug));
    receipt.postflight = after;
    if (!after.complete) throw new Error(`Postflight incomplete for ${plan.release.releaseSlug}`);
    receipt.status = "persisted";
  }
} catch (error) {
  receipt.status = "failed";
  receipt.error = error instanceof Error ? error.message : String(error);
}
receipt.updatedAt = new Date().toISOString();
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (receipt.status === "failed") process.exitCode = 2;
