import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = {
  migration: "supabase/migrations/20260804062000_private_pricing_coverage_work_orders.sql",
  server: "src/lib/kingmaker-private-pricing-work-orders-server.ts",
  route: "src/app/api/instacomp/pricing/coverage/work-orders/route.ts",
  component: "src/app/admin/instacomp/pricing/_components/private-pricing-work-orders.tsx",
  page: "src/app/admin/instacomp/pricing/coverage/work-orders/page.tsx",
  coveragePage: "src/app/admin/instacomp/pricing/coverage/page.tsx",
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
const route = source(files.route);
const component = source(files.component);
const page = source(files.page);
const coveragePage = source(files.coveragePage);
const combined = [migration, server, route, component, page, coveragePage].join("\n");

for (const [contents, expected, label] of [
  [migration, "tcos_kingmaker_private_pricing_work_orders", "Migration"],
  [migration, "tcos_kingmaker_private_pricing_work_order_audit", "Migration"],
  [migration, "p_expected_version", "Migration"],
  [migration, "pg_advisory_xact_lock", "Migration"],
  [migration, "private_coverage_work_orders_only", "Migration"],
  [migration, "enable row level security", "Migration"],
  [server, "actor.type !== \"admin\"", "Server boundary"],
  [server, "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STALE", "Server boundary"],
  [route, "assertTrustedInstaCompMutationRequest", "Mutation route"],
  [route, "sourceDisclosure: null", "API privacy boundary"],
  [component, "Coverage Work Orders", "Admin workspace"],
  [component, "No price promotion", "Admin workspace"],
  [component, "No source disclosure", "Admin workspace"],
  [page, "PrivatePricingWorkOrders", "Admin route"],
  [coveragePage, "Open Coverage Work Orders", "Coverage handoff"],
] as const) {
  requireText(contents, expected, label);
}

for (const forbidden of [
  "raw_text",
  "original_filename",
  "source_storage_bucket",
  "source_storage_object_path",
  "value_low",
  "value_high",
]) {
  rejectText(server + route + component + page + coveragePage, forbidden, "Application work-order path");
}

const privateProviderName = ["be", "ckett"].join("");
rejectText(combined, privateProviderName, "New work-order code");

if (/\b(insert|update|delete)\s+into?\s+public\.tcos_kingmaker_observations/i.test(migration)) {
  throw new Error("Work-order migration must not mutate pricing observations.");
}

if (!component.includes("expectedVersion: row.workOrder.version")) {
  throw new Error("Admin work-order updates must send the current optimistic version.");
}

if (!component.includes("disabled={!row.targetActive")) {
  throw new Error("Inactive historical targets must remain read-only in the admin workspace.");
}

console.log("KINGMAKER private pricing work-order application contracts passed.");
