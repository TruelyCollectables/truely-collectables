import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = {
  migration: "supabase/migrations/20260804070000_private_pricing_work_order_reconciliation.sql",
  server: "src/lib/kingmaker-private-pricing-work-orders-server.ts",
  component: "src/app/admin/instacomp/pricing/_components/private-pricing-work-orders.tsx",
} as const;

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function requireText(contents: string, expected: string, label: string) {
  if (!contents.includes(expected)) {
    throw new Error(`${label} is missing required contract: ${expected}`);
  }
}

function rejectText(contents: string, forbidden: string, label: string) {
  if (contents.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

const migration = source(files.migration);
const server = source(files.server);
const component = source(files.component);
const combined = `${migration}\n${server}\n${component}`;

for (const [contents, expected, label] of [
  [migration, "tcos_reconcile_kingmaker_private_pricing_work_orders", "Migration"],
  [migration, "auto_resolved", "Migration"],
  [migration, "auto_reopened", "Migration"],
  [migration, "last_refresh_status = 'succeeded'", "Successful-refresh trigger"],
  [migration, "work.status in ('queued','in_progress','blocked')", "Automatic resolution scope"],
  [migration, "work.status = 'resolved'", "Automatic reopen scope"],
  [migration, "notes_changed", "Audit note preservation"],
  [migration, "actor_type", "System audit actor"],
  [server, '"resolved"', "Server status contract"],
  [server, "resolvedAt", "Server lifecycle timestamp"],
  [server, "reopenedAt", "Server lifecycle timestamp"],
  [server, "resolvedTargets", "Server summary contract"],
  [component, "Automatic reconciliation", "Admin workspace"],
  [component, "Auto-Resolved", "Admin workspace"],
  [component, "resolutionCycle", "Admin workspace"],
  [component, "Cleared targets are reconciled automatically", "Admin workspace"],
] as const) {
  requireText(contents, expected, label);
}

if (component.includes('<option value="resolved">')) {
  throw new Error("Automatic resolution must not be exposed as a manual operator status.");
}

if (!server.includes("KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES.includes")) {
  throw new Error("Manual saves must remain restricted to operator-controlled statuses.");
}

if (!migration.includes("status in ('queued','in_progress','blocked')")) {
  throw new Error("Manual completion and dismissal must remain outside auto-resolution scope.");
}

if (/\b(insert|update|delete)\s+into?\s+public\.tcos_kingmaker_observations/i.test(migration)) {
  throw new Error("Reconciliation migration must not mutate pricing observations.");
}

for (const forbidden of [
  "raw_text",
  "original_filename",
  "source_storage_bucket",
  "source_storage_object_path",
  "value_low",
  "value_high",
]) {
  rejectText(combined, forbidden, "Reconciliation path");
}

const privateProviderName = ["be", "ckett"].join("");
rejectText(combined, privateProviderName, "Reconciliation path");

console.log("KINGMAKER private pricing work-order reconciliation contracts passed.");
