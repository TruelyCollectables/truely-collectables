import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260805012500_private_pricing_work_order_target_history.sql",
  "utf8",
);
const server = fs.readFileSync(
  "src/lib/kingmaker-private-pricing-work-order-target-history-server.ts",
  "utf8",
);
const route = fs.readFileSync(
  "src/app/api/instacomp/pricing/coverage/work-orders/execution/history/route.ts",
  "utf8",
);
const drawer = fs.readFileSync(
  "src/app/admin/instacomp/pricing/_components/private-pricing-work-order-target-history.tsx",
  "utf8",
);
const queue = fs.readFileSync(
  "src/app/admin/instacomp/pricing/_components/private-pricing-work-order-execution.tsx",
  "utf8",
);

assert(
  migration.includes("private_coverage_work_order_target_history_only") &&
    migration.includes("security definer") &&
    migration.includes("to service_role") &&
    migration.includes("from public, anon, authenticated"),
  "Target history RPC must preserve the source-neutral service-role boundary.",
);
assert(
  migration.includes("where audit.attack_key = effective_key") &&
    migration.includes("order by created_at desc, version desc, action") &&
    migration.includes("'attackKey'") === false,
  "Target history must filter one key, order newest first, and never serialize that key.",
);
for (const action of [
  "created",
  "updated",
  "auto_resolved",
  "auto_reopened",
  "review_scheduled",
  "review_cleared",
  "claimed",
  "released",
  "execution_updated",
  "resolution_recorded",
]) {
  assert(
    migration.includes(`action = '${action}'`),
    `Target history summary is missing ${action}.`,
  );
}
assert(
  server.includes('actor.type !== "admin"') &&
    server.includes("KINGMAKER_TARGET_HISTORY_ADMIN_REQUIRED") &&
    server.includes("KINGMAKER_TARGET_HISTORY_BOUNDARY_INVALID"),
  "Target history server must require an administrator and verify the RPC boundary.",
);
assert(
  route.includes("export async function GET") &&
    !route.includes("export async function POST") &&
    route.includes('"cache-control": "no-store"') &&
    route.includes("sourceDisclosure: null"),
  "Target history API must remain GET-only, no-store, and source-neutral.",
);
assert(
  drawer.includes("KINGMAKER Target History") &&
    drawer.includes("Version-by-version lifecycle evidence") &&
    drawer.includes("Private text changed") &&
    drawer.includes("Previous 50") &&
    drawer.includes("Next 50"),
  "Target history drawer must expose the complete paginated lifecycle evidence.",
);
assert(
  queue.includes("PrivatePricingWorkOrderTargetHistory") &&
    queue.includes("View History") === false &&
    queue.includes("inspect a target&apos;s immutable history"),
  "Every execution row must mount the reusable target history drawer.",
);
for (const source of [route, drawer]) {
  for (const forbidden of [
    "notesDigest",
    "notes_digest",
    "blockedReason",
    "resolutionCode",
    "raw_text",
    "original_filename",
    "storage_object_path",
    "value_low",
    "value_high",
    "observation_id",
  ]) {
    assert(
      !source.toLowerCase().includes(forbidden.toLowerCase()),
      `Target history application surface contains forbidden field: ${forbidden}`,
    );
  }
}
assert(
  !server.match(
    /(?:insert|update|delete)\s+.*tcos_kingmaker_(?:price_entries|observations|private_pricing_work_orders|private_pricing_work_order_audit)/i,
  ),
  "Target history server must not mutate pricing or work-order records.",
);
assert(
  !drawer.includes("window.confirm") && !queue.includes("window.confirm"),
  "Target history and execution controls must keep confirmations inline.",
);

console.log("KINGMAKER per-target history contract certified.");
