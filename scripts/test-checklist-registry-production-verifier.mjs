import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isRetryableRegistryReadError,
  runRegistryReadWithRetry,
} from "./checklist-registry-read-retry.mjs";

const path = "scripts/verify-checklist-registry-production.mjs";
const source = readFileSync(path, "utf8");

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
assert(!source.includes('count: "exact"'), "Verifier must never request exact Production table counts.");
assert(!source.includes("head: true"), "Verifier must use an ordinary bounded row read, not a count-oriented HEAD query.");
assert(source.includes("runRegistryReadWithRetry"), "Verifier must use the bounded read-only retry helper.");
assert(source.includes("CHECKLIST_REGISTRY_READ_TIMEOUT_MS"), "Verifier must expose a bounded per-read timeout.");
assert(source.includes("CHECKLIST_REGISTRY_WRITER_PROBE_TIMEOUT_MS"), "Verifier must expose a bounded one-shot writer-probe timeout.");
assert(source.includes(".abortSignal(AbortSignal.timeout(readAttemptTimeoutMs))"), "Every bounded Registry read must abort a hung fetch.");
assert(source.includes(".abortSignal(AbortSignal.timeout(writerProbeTimeoutMs))"), "The one-shot writer probe must abort a hung fetch.");
assert(source.includes('rpc("tcos_apply_checklist_import_plan"'), "Verifier must probe the transactional writer RPC.");
assert(source.includes("contract_probe_must_fail"), "Verifier RPC must intentionally fail before persistence.");
assert(source.includes("Checklist import plan requires validation before persistence"), "Verifier must require the exact pre-write guard.");
assert(source.includes("The RPC itself is deliberately NOT retried"), "Writer contract probe must remain non-retried.");
assert(!/\.insert\s*\(/.test(source), "Verifier must not insert rows.");
assert(!/\.update\s*\(/.test(source), "Verifier must not update rows.");
assert(!/\.delete\s*\(/.test(source), "Verifier must not delete rows.");
assert(!/\.upsert\s*\(/.test(source), "Verifier must not upsert rows.");

assert.equal(
  isRetryableRegistryReadError({ code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }),
  true,
  "Observed Production PGRST002 schema-cache startup failure must be retryable.",
);
assert.equal(
  isRetryableRegistryReadError({ name: "TimeoutError", message: "The operation was aborted due to timeout" }),
  true,
  "A hard per-attempt network timeout must remain a retryable read failure.",
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
  }, { attempts: 6, baseMs: 10, sleep: async (ms) => sleeps.push(ms) });

  assert.equal(result.error, null);
  assert.equal(result.attemptsUsed, 3);
  assert.equal(result.retried, true);
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(calls, 3);
}

{
  let calls = 0;
  let sleeps = 0;
  const result = await runRegistryReadWithRetry(async () => {
    calls += 1;
    return { data: null, error: { code: "PGRST205", message: "Could not find the table in the schema cache" } };
  }, { attempts: 6, baseMs: 10, sleep: async () => { sleeps += 1; } });

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
  }, { attempts: 4, baseMs: 0, sleep: async () => {} });

  assert.equal(result.error.message, "fetch failed");
  assert.equal(result.attemptsUsed, 4);
  assert.equal(result.exhausted, true);
  assert.equal(calls, 4);
}

console.log(JSON.stringify({
  status: "passed",
  readOnlyTableChecks: true,
  boundedReads: true,
  perAttemptNetworkTimeout: true,
  writerProbeNetworkTimeout: true,
  transientSchemaCacheRetry: true,
  timeoutRetry: true,
  permanentContractFailuresRetry: false,
  retryExhaustionFailClosed: true,
  exactCountsAbsent: true,
  writerPreWriteGuardProbe: true,
  writerProbeRetried: false,
  directMutationsAbsent: true,
}));
