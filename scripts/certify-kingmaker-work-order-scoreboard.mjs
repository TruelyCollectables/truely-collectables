import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(
  "src/lib/kingmaker-private-pricing-work-order-scoreboard-server.ts",
  "utf8",
);
const route = fs.readFileSync(
  "src/app/api/instacomp/pricing/coverage/work-orders/execution/scoreboard/route.ts",
  "utf8",
);
const component = fs.readFileSync(
  "src/app/admin/instacomp/pricing/_components/private-pricing-work-order-scoreboard.tsx",
  "utf8",
);
const page = fs.readFileSync(
  "src/app/admin/instacomp/pricing/coverage/work-orders/page.tsx",
  "utf8",
);

assert(
  server.includes('actor.type !== "admin"') &&
    server.includes("KINGMAKER_SCOREBOARD_ADMIN_REQUIRED"),
  "Scoreboard reads must require an administrator actor.",
);
assert(
  server.includes("MAX_SCOREBOARD_TARGETS") &&
    server.includes("PAGE_FETCH_CONCURRENCY") &&
    server.includes("latestByTarget"),
  "Scoreboard aggregation must be bounded, concurrency-limited, and deduplicated.",
);
assert(
  server.includes("private_coverage_work_order_execution_only") &&
    server.includes("private_coverage_work_order_scoreboard_only"),
  "Scoreboard must verify its source report and publish a distinct boundary.",
);
assert(
  server.includes("highPriorityUnassignedTargets") &&
    server.includes("dueWithin24HoursTargets") &&
    server.includes("activeAssignees") &&
    server.includes("priorities") &&
    server.includes("assignees"),
  "Scoreboard must expose urgency, priority, and assignee workload summaries.",
);
assert(
  route.includes("export async function GET") &&
    !route.includes("export async function POST") &&
    route.includes('"cache-control": "no-store"') &&
    route.includes("sourceDisclosure: null"),
  "Scoreboard API must remain GET-only, no-store, and source-neutral.",
);
assert(
  component.includes("Workload Scoreboard") &&
    component.includes("P1/P2 Unassigned") &&
    component.includes("Operator Workload") &&
    component.includes("Most urgent assignments first"),
  "Scoreboard UI must surface queue urgency and operator workload.",
);
assert(
  page.includes("PrivatePricingWorkOrderScoreboard") &&
    page.indexOf("<PrivatePricingWorkOrderScoreboard />") <
      page.indexOf("<PrivatePricingWorkOrderExecution />"),
  "Scoreboard must appear before the execution queue.",
);

for (const source of [route, component]) {
  for (const forbidden of [
    "attackKey",
    "notesDigest",
    "notes_digest",
    "raw_text",
    "original_filename",
    "storage_object_path",
    "value_low",
    "value_high",
    "observation_id",
  ]) {
    assert(
      !source.toLowerCase().includes(forbidden.toLowerCase()),
      `Scoreboard application surface contains forbidden field: ${forbidden}`,
    );
  }
}

assert(
  !server.match(
    /(?:insert|update|delete)\s+.*tcos_kingmaker_(?:price_entries|observations|private_pricing_work_orders|private_pricing_work_order_audit)/i,
  ),
  "Scoreboard server must not mutate pricing or work-order records.",
);

console.log("KINGMAKER work-order operations scoreboard contract certified.");
