import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || process.argv[2] || "");
if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const plansDir = resolve(ROOT, "output/plans");
const summaryPath = resolve(ROOT, "output/summary.json");
const receiptPath = resolve(ROOT, "output/registry-plan-canonicalization-receipt.json");
if (!existsSync(plansDir) || !existsSync(summaryPath)) throw new Error("Verified harvest plans/summary are missing.");

function normalizedName(value) {
  const trimmed = String(value ?? "").trim().toLowerCase().replaceAll("&", " and ");
  const normalized = trimmed.replace(/[^\p{L}\p{N}/]+/gu, " ");
  return normalized || null;
}

function exactParallelKey(row) {
  const setSourceKey = String(row?.setSourceKey || "");
  const name = normalizedName(row?.name);
  const serialRun = Number(row?.serialRun || 0);
  if (!setSourceKey || !name) throw new Error(`Parallel is missing Registry uniqueness fields: ${JSON.stringify(row)}`);
  return JSON.stringify([setSourceKey, name, serialRun]);
}

function fingerprintKey(row) {
  const schema = String(row?.fingerprint?.schema || "tcos.checklist.identity.v1");
  const sha = String(row?.fingerprint?.fingerprintSha256 || "");
  if (!sha) throw new Error(`Identity is missing fingerprintSha256: ${JSON.stringify(row).slice(0, 500)}`);
  return `${schema}|${sha}`;
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const readyHockey = new Set((Array.isArray(summary.ready) ? summary.ready : [])
  .map((row) => String(row?.exactSetKey || ""))
  .filter((key) => key.startsWith("hockey|")));
const receipt = {
  schema: "tcos.registryPlanCanonicalization.v1",
  updatedAt: new Date().toISOString(),
  targetCount: 0,
  changedCount: 0,
  parallelRowsRemoved: 0,
  identityRowsRemoved: 0,
  results: [],
};

for (const filename of readdirSync(plansDir).filter((name) => name.endsWith(".json")).sort()) {
  const path = resolve(plansDir, filename);
  const plan = JSON.parse(readFileSync(path, "utf8"));
  const releaseSlug = String(plan?.release?.releaseSlug || "");
  const isHockey = String(plan?.release?.sport || "").toLowerCase() === "hockey" || releaseSlug.endsWith("-hockey");
  if (!isHockey || plan?.validation?.status !== "passed") continue;
  receipt.targetCount += 1;

  const originalParallelCount = Array.isArray(plan.parallels) ? plan.parallels.length : 0;
  const originalIdentityCount = Array.isArray(plan.identities) ? plan.identities.length : 0;
  const canonicalByKey = new Map();
  const aliasToCanonical = new Map();
  const configsByKey = new Map();
  const canonicalParallels = [];

  for (const parallel of Array.isArray(plan.parallels) ? plan.parallels : []) {
    const sourceKey = String(parallel?.sourceKey || "");
    if (!sourceKey) throw new Error(`${releaseSlug || filename}: parallel is missing sourceKey`);
    const key = exactParallelKey(parallel);
    const config = String(parallel?.configurationExclusivity || "");
    if (!configsByKey.has(key)) configsByKey.set(key, new Set());
    configsByKey.get(key).add(config);
    const canonical = canonicalByKey.get(key);
    if (!canonical) {
      const kept = { ...parallel };
      canonicalByKey.set(key, kept);
      aliasToCanonical.set(sourceKey, sourceKey);
      canonicalParallels.push(kept);
    } else {
      aliasToCanonical.set(sourceKey, String(canonical.sourceKey));
    }
  }

  for (const parallel of canonicalParallels) {
    const configs = configsByKey.get(exactParallelKey(parallel)) || new Set();
    if (configs.size > 1) parallel.configurationExclusivity = null;
  }

  const remappedIdentities = (Array.isArray(plan.identities) ? plan.identities : []).map((identity) => {
    const source = String(identity?.parallelSourceKey || "");
    if (!source) return identity;
    const canonical = aliasToCanonical.get(source);
    if (!canonical) throw new Error(`${releaseSlug || filename}: identity references unknown parallel source key ${source}`);
    return canonical === source ? identity : { ...identity, parallelSourceKey: canonical };
  });

  const identityByFingerprint = new Map();
  const canonicalIdentities = [];
  for (const identity of remappedIdentities) {
    const key = fingerprintKey(identity);
    const prior = identityByFingerprint.get(key);
    if (!prior) {
      identityByFingerprint.set(key, identity);
      canonicalIdentities.push(identity);
      continue;
    }
    const sameCard = String(prior.cardSourceKey || "") === String(identity.cardSourceKey || "");
    const sameParallel = String(prior.parallelSourceKey || "") === String(identity.parallelSourceKey || "");
    const sameCanonical = String(prior?.fingerprint?.canonicalKey || "") === String(identity?.fingerprint?.canonicalKey || "");
    if (!sameCard || !sameParallel || !sameCanonical) {
      throw new Error(`${releaseSlug || filename}: fingerprint collision would merge distinct identities for ${key}`);
    }
  }

  const parallelRowsRemoved = originalParallelCount - canonicalParallels.length;
  const identityRowsRemoved = originalIdentityCount - canonicalIdentities.length;
  if (parallelRowsRemoved || identityRowsRemoved) {
    plan.parallels = canonicalParallels;
    plan.identities = canonicalIdentities;
    plan.validation = {
      ...plan.validation,
      counts: {
        ...(plan.validation?.counts || {}),
        parallels: canonicalParallels.length,
        identities: canonicalIdentities.length,
      },
    };
    writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
    receipt.changedCount += 1;
    receipt.parallelRowsRemoved += parallelRowsRemoved;
    receipt.identityRowsRemoved += identityRowsRemoved;
  }

  receipt.results.push({
    filename,
    releaseSlug,
    originalParallels: originalParallelCount,
    canonicalParallels: canonicalParallels.length,
    parallelRowsRemoved,
    originalIdentities: originalIdentityCount,
    canonicalIdentities: canonicalIdentities.length,
    identityRowsRemoved,
  });
}

writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  targetCount: receipt.targetCount,
  changedCount: receipt.changedCount,
  parallelRowsRemoved: receipt.parallelRowsRemoved,
  identityRowsRemoved: receipt.identityRowsRemoved,
}, null, 2));
if (receipt.targetCount !== readyHockey.size) {
  throw new Error(`Canonicalizer saw ${receipt.targetCount} ready Hockey plans, expected ${readyHockey.size} from summary.`);
}
