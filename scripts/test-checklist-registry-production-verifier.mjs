import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assert(source.includes("MAX_READ_ATTEMPTS"), "Verifier must bound transient read retries.");
assert(source.includes("STABLE_ROUNDS"), "Verifier must require multiple stable read rounds.");
assert(source.includes("STABLE_ROUNDS = Math.max(2"), "Verifier must require at least two healthy read rounds.");
assert(source.includes("isTransientReadError"), "Verifier must classify retryable read failures.");
assert(source.includes("retryBoundedRead"), "Verifier must retry only bounded reads through an explicit helper.");
assert(source.includes("retryDelay"), "Verifier must use one bounded backoff policy.");
assert(source.includes('kind: "thrown"'), "Verifier must capture thrown transport failures.");
assert(source.includes('kind: "returned"'), "Verifier must capture returned transient failures.");
assert(source.includes("thrownTransportErrorsCovered: true"), "Verifier proof must confirm thrown transport errors are covered.");
assert(source.includes("transientOnly: true"), "Verifier proof must state that only transient errors retry.");
assert(source.includes('db.rpc("tcos_apply_checklist_import_plan"'), "Verifier must probe the transactional writer RPC.");
assert(source.includes("contract_probe_must_fail"), "Verifier RPC must intentionally fail before persistence.");
assert(source.includes("Checklist import plan requires validation before persistence"), "Verifier must require the exact pre-write guard.");
assert(source.includes("rpcFailures"), "Verifier must retain bounded RPC probe retry evidence.");
assert(!/\.insert\s*\(/.test(source), "Verifier must not insert rows.");
assert(!/\.update\s*\(/.test(source), "Verifier must not update rows.");
assert(!/\.delete\s*\(/.test(source), "Verifier must not delete rows.");
assert(!/\.upsert\s*\(/.test(source), "Verifier must not upsert rows.");

console.log(JSON.stringify({
  status: "passed",
  readOnlyTableChecks: true,
  boundedReads: true,
  transientReadRetries: true,
  thrownTransportRetries: true,
  minimumStableRounds: 2,
  exactCountsAbsent: true,
  writerPreWriteGuardProbe: true,
  directMutationsAbsent: true,
}));
