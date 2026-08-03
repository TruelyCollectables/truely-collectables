import { readFile } from "node:fs/promises";

const delivery = await readFile(new URL("../src/lib/kingmaker-morning-intelligence-delivery.ts", import.meta.url), "utf8");
const live = await readFile(new URL("../src/lib/kingmaker-morning-intelligence-live.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260803021000_kingmaker_delivery_ledger.sql", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const fragment of [
  'from("tcos_kingmaker_delivery_runs")',
  'rpc("tcos_claim_kingmaker_delivery"',
  'delivery_already_claimed_or_sent',
  'email_sent_ledger_confirmation_failed',
  'const deliveryKey = ["kingmaker-morning", deliveryDate, payload.mode, payload.fingerprint].join(":")',
  'safeErrorCode',
  'status: "failed"',
  'status: "sent"',
]) {
  assert(delivery.includes(fragment), `Missing delivery hardening contract: ${fragment}`);
}

for (const forbidden of [
  'const REPORT_TYPE = "hourly_deals"',
  '.from("tcos_mi_report_runs")',
  'error?.message || "Resend did not return an email ID."',
]) {
  assert(!delivery.includes(forbidden), `Legacy delivery coupling remains: ${forbidden}`);
}

for (const fragment of [
  'MIN_ACTIONABLE_CONFIDENCE',
  'MAX_OPPORTUNITY_AGE_HOURS',
  'expectedProfit !== null && expectedProfit > 0',
  'itemConfidence !== null && itemConfidence >= MIN_ACTIONABLE_CONFIDENCE',
  'were withheld by KINGMAKER eligibility guards',
  'Raw diagnostics were retained server-side.',
]) {
  assert(live.includes(fragment), `Missing live eligibility contract: ${fragment}`);
}

for (const fragment of [
  'create table if not exists public.tcos_kingmaker_delivery_runs',
  'delivery_key text not null unique',
  'create function public.tcos_claim_kingmaker_delivery',
  'on conflict (delivery_key) do update',
  "status = 'failed'",
  "status = 'claimed'",
  'grant execute on function public.tcos_claim_kingmaker_delivery',
]) {
  assert(migration.includes(fragment), `Missing ledger migration contract: ${fragment}`);
}

console.log("KINGMAKER Phase 2.1 delivery hardening contracts passed.");
