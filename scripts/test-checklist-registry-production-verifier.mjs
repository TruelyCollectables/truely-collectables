import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isRetryableRegistryReadError,
  runRegistryReadWithRetry,
} from "./checklist-registry-read-retry.mjs";

const path = "scripts/verify-checklist-registry-production.mjs";
const source = readFileSync(path, "utf8");
const writerSource = readFileSync("supabase/migrations/20260731161500_checklist_registry_transactional_writer.sql", "utf8");
const importerSource = readFileSync("scripts/mainstream-checklist/registry-tools.mjs", "utf8");

for (const table of [
  "checklist_source_catalog",
  "checklist_releases",
  "checklist_source_files",
  "checklist_versions",
  "checklist_sets",
  "checklist_cards",
  "checklist_card_identities",
]) {
  assert(source.includes(`\"${table}\"`), `Verifier must check ${table}.`);
}

assert(source.includes(".limit(1)"), "Verifier table probes must be bounded to one row.");
assert(source.includes(".abortSignal(signal)"), "Verifier table probes must abort hung read attempts.");
assert(source.includes("CHECKLIST_REGISTRY_READ_ATTEMPT_TIMEOUT_MS"), "Verifier must expose a bounded per-read attempt timeout.");
assert(!source.includes('count: "exact"'), "Verifier must never request exact Production table counts.");
assert(!source.includes("head: true"), "Verifier must use an ordinary bounded row read, not a count-oriented HEAD query.");
assert(source.includes("runRegistryReadWithRetry"), "Verifier must use the bounded read-only retry helper.");
assert(source.includes('db.rpc("tcos_apply_checklist_import_plan"'), "Verifier must probe the transactional writer RPC.");
assert(source.includes("contract_probe_must_fail"), "Verifier RPC must intentionally fail before persistence.");
assert(source.includes("Checklist import plan requires validation before persistence"), "Verifier must require the exact pre-write guard.");
assert(source.includes("RPC itself is deliberately NOT retried"), "Writer contract probe must remain non-retried.");
assert(!/\.insert\s*\(/.test(source), "Verifier must not insert rows.");
assert(!/\.update\s*\(/.test(source), "Verifier must not update rows.");
assert(!/\.delete\s*\(/.test(source), "Verifier must not delete rows.");
assert(!/\.upsert\s*\(/.test(source), "Verifier must not upsert rows.");

const productionSchema = writerSource.match(/p_plan->>'schema'\s*<>\s*'([^']+)'/)?.[1];
const verifierSchema = source.match(/const invalidPlan = \{[\s\S]*?schema:\s*"([^"]+)"/)?.[1];
const importerSchema = importerSource.match(/schema:\s*"(tcos\.checklist\.importPlan\.v1)"/)?.[1];
assert.equal(productionSchema, "tcos.checklist.importPlan.v1", "Production writer schema contract changed unexpectedly.");
assert.equal(verifierSchema, productionSchema, "Verifier probe schema must exactly match the Production writer schema guard.");
assert.equal(importerSchema, productionSchema, "Real importer schema must exactly match the Production writer schema guard.");
assert(!source.includes("tcos.checklist.import-plan.v1"), "Obsolete hyphenated verifier schema must never return.");

assert.equal(
  isRetryableRegistryReadError({ code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }),
  true,
  "Observed Production PGRST002 schema-cache startup failure must be retryable.",
);
assert.equal(
  isRetryableRegistryReadError({ code: "REGISTRY_READ_TIMEOUT", message: "Registry read attempt timed out." }),
  true,
  "A bounded read-attempt timeout must be retryable.",
);
assert.equal(
  isRetryableRegistryReadError({ code: "PGRST205", message: "Could not find the table 'public.missing' in the schema cache" }),
  false,
  "A missing table/schema contract must fail immediately rather than being hidden by retries.",
);
assert.equal(
  isRetryableRegistryReadError({ code: "42501", message: "permission denied for table checklist_cards" }),
  false,
  "A permission failure must fail immediately.",
);

{
  let calls = 0;
  const sleeps = [];
  const result = await runRegistryReadWithRetry(async () => {
    calls += 1;
    if (calls < 3) {
      return { data: null, error: { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." } };
    }
    return { data: [], error: null };
  }, { attempts: 6, baseMs: 10, attemptTimeoutMs: 1_000, sleep: async (ms) => sleeps.push(ms) });

  assert.equal(result.error, null);
  assert.equal(result.attemptsUsed, 3);
  assert.equal(result.retried, true);
  assert.equal(result.attemptTimeoutMs, 1_000);
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(calls, 3);
}

{
  let calls = 0;
  let sleeps = 0;
  const result = await runRegistryReadWithRetry(async () => {
    calls += 1;
    return { data: null, error: { code: "PGRST205", message: "Could not find the table in the schema cache" } };
  }, { attempts: 6, baseMs: 10, attemptTimeoutMs: 1_000, sleep: async () => { sleeps += 1; } });

  assert.equal(result.error.code, "PGRST205");
  assert.equal(result.attemptsUsed, 1);
  assert.equal(result.retried, false);
  assert.equal(result.retryable, false);
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
}

{
  let calls = 0;
  const result = await runRegistryReadWithRetry(async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }, { attempts: 4, baseMs: 0, attemptTimeoutMs: 1_000, sleep: async () => {} });

  assert.equal(result.error.message, "fetch failed");
  assert.equal(result.attemptsUsed, 4);
  assert.equal(result.exhausted, true);
  assert.equal(calls, 4);
}

{
  let calls = 0;
  let aborts = 0;
  const result = await runRegistryReadWithRetry((signal) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborts += 1;
        reject(signal.reason || new Error("aborted"));
      }, { once: true });
    });
  }, { attempts: 2, baseMs: 0, attemptTimeoutMs: 5, sleep: async () => {} });

  assert.equal(result.error.code, "REGISTRY_READ_TIMEOUT");
  assert.equal(result.retryable, true);
  assert.equal(result.exhausted, true);
  assert.equal(result.attemptsUsed, 2);
  assert.equal(result.attemptTimeoutMs, 5);
  assert.equal(calls, 2);
  assert.equal(aborts, 2);
}

console.log(JSON.stringify({
  status: "passed",
  readOnlyTableChecks: true,
  boundedReads: true,
  boundedReadWallClock: true,
  abortSignalApplied: true,
  transientSchemaCacheRetry: true,
  permanentContractFailuresRetry: false,
  retryExhaustionFailClosed: true,
  exactCountsAbsent: true,
  writerPreWriteGuardProbe: true,
  writerProbeRetried: false,
  productionVerifierImporterSchemaAligned: true,
  directMutationsAbsent: true,
}));
