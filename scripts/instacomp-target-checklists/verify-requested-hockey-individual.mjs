import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.REQUESTED_HOCKEY_VERIFY_RECEIPT || `${ROOT}/requested-hockey-individual-verification.json`);
const CONCURRENCY = Math.max(1, Number(process.env.REQUESTED_HOCKEY_VERIFY_CONCURRENCY || 3));
const RETRIES = Math.max(1, Number(process.env.REQUESTED_HOCKEY_VERIFY_ATTEMPTS || 5));
const RETRY_MS = Math.max(1000, Number(process.env.REQUESTED_HOCKEY_VERIFY_RETRY_MS || 5000));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summary = JSON.parse(readFileSync(resolve(ROOT, "output/summary.json"), "utf8"));
const plansDir = resolve(ROOT, "output/plans");
const targets = (Array.isArray(summary.ready) ? summary.ready : [])
  .filter((row) => String(row?.exactSetKey || "").startsWith("hockey|"))
  .sort((a, b) => String(a.exactSetKey).localeCompare(String(b.exactSetKey)));
if (targets.length !== 83) throw new Error(`Expected 83 validated Hockey catalogs, got ${targets.length}.`);

const receipt = { schema: "tcos.requestedHockeyIndividualVerification.v1", targetCount: targets.length, results: [] };
function save() {
  receipt.updatedAt = new Date().toISOString();
  receipt.liveCount = receipt.results.filter((row) => row.complete === true).length;
  receipt.unresolvedCount = receipt.results.filter((row) => row.complete === false).length;
  receipt.failedQueryCount = receipt.results.filter((row) => row.queryFailed === true).length;
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function verifyOne(target) {
  const exactSetKey = String(target.exactSetKey);
  const planPath = resolve(plansDir, `${safeSlug(exactSetKey)}.json`);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const releaseSlug = String(plan?.release?.releaseSlug || "");
  let last = null;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const state = await preflightReleaseManagement(releaseSlug);
      return { exactSetKey, releaseSlug, complete: Boolean(state.complete), state, attempt };
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt < RETRIES) await sleep(RETRY_MS * attempt);
    }
  }
  return { exactSetKey, releaseSlug, complete: false, queryFailed: true, error: last?.message || "verification query failed" };
}

let cursor = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    const row = await verifyOne(targets[index]);
    receipt.results.push(row);
    console.log(`${row.complete ? "LIVE" : "UNRESOLVED"} ${row.exactSetKey}`);
    save();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
receipt.results.sort((a, b) => a.exactSetKey.localeCompare(b.exactSetKey));
save();
console.log(JSON.stringify({ targetCount: receipt.targetCount, liveCount: receipt.liveCount, unresolvedCount: receipt.unresolvedCount, failedQueryCount: receipt.failedQueryCount }, null, 2));
if (receipt.liveCount !== 83 || receipt.unresolvedCount !== 0 || receipt.failedQueryCount !== 0) process.exitCode = 2;
