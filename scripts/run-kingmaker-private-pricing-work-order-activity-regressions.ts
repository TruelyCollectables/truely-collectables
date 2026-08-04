import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = {
  migration: "supabase/migrations/20260804074500_private_pricing_work_order_activity.sql",
  server: "src/lib/kingmaker-private-pricing-work-order-activity-server.ts",
  route: "src/app/api/instacomp/pricing/coverage/work-orders/activity/route.ts",
  component: "src/app/admin/instacomp/pricing/_components/private-pricing-work-order-activity.tsx",
  page: "src/app/admin/instacomp/pricing/coverage/work-orders/page.tsx",
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
const application = `${server}\n${route}\n${component}\n${page}`;
const combined = `${migration}\n${application}`;

for (const [contents, expected, label] of [
  [migration, "private_coverage_work_order_activity_only", "Migration"],
  [migration, "notesChanged", "Aggregate activity contract"],
  [migration, "actorType", "Aggregate activity contract"],
  [migration, "service_role", "Service-only activity boundary"],
  [server, 'actor.type !== "admin"', "Server admin boundary"],
  [server, "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_BOUNDARY_INVALID", "Server response boundary"],
  [server, "private_coverage_work_order_activity_only", "Server response boundary"],
  [route, '"cache-control": "no-store"', "API cache boundary"],
  [route, "sourceDisclosure: null", "API source boundary"],
  [component, "Coverage Work-Order Audit Timeline", "Admin timeline"],
  [component, "Open Audit Timeline", "Admin timeline entry point"],
  [component, "Lifecycle metadata only", "Admin evidence boundary"],
  [component, "No private text", "Admin privacy boundary"],
  [component, "No source disclosure", "Admin privacy boundary"],
  [component, "No price promotion", "Admin pricing boundary"],
  [page, "PrivatePricingWorkOrderActivity", "Work-order page integration"],
] as const) {
  requireText(contents, expected, label);
}

for (const forbidden of [
  "raw_text",
  "original_filename",
  "source_storage_bucket",
  "source_storage_object_path",
  "storage_object_path",
  "value_low",
  "value_high",
  "low_observation_id",
  "high_observation_id",
]) {
  rejectText(application, forbidden, "Activity application path");
}

const privateProviderName = ["be", "ckett"].join("");
rejectText(combined, privateProviderName, "Activity feature");

if (/\battackKey\b/.test(application)) {
  throw new Error("Activity application path must not receive or render private target keys.");
}

if (/\bnotes\s*:/.test(server) || /\bnotes\s*:/.test(component)) {
  throw new Error("Activity types must not expose private operator text.");
}

if (/notesDigest|notes_digest/.test(application)) {
  throw new Error("Activity application path must not receive private note digests.");
}

if (!server.includes("notesChanged: row.notesChanged === true")) {
  throw new Error("Activity server must reduce note evidence to a boolean change flag.");
}

if (!component.includes("row.notesChanged ?")) {
  throw new Error("Admin timeline must visibly distinguish private-text change events.");
}

if (/\b(insert|update|delete)\b/i.test(route)) {
  throw new Error("Activity API must remain GET-only and read-only.");
}

console.log("KINGMAKER private pricing work-order activity contracts passed.");
