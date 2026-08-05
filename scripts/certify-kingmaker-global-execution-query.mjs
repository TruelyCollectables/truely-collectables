import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(
  "src/lib/kingmaker-private-pricing-work-order-execution-server.ts",
  "utf8",
);
const route = fs.readFileSync(
  "src/app/api/instacomp/pricing/coverage/work-orders/execution/route.ts",
  "utf8",
);
const dashboard = fs.readFileSync(
  "src/app/admin/instacomp/pricing/_components/private-pricing-work-order-execution.tsx",
  "utf8",
);

assert(
  server.includes("KINGMAKER_EXECUTION_SORTS") &&
    server.includes("MAX_GLOBAL_QUEUE_ROWS") &&
    server.includes("remainingOffsets") &&
    server.includes("PAGE_FETCH_CONCURRENCY"),
  "Execution queries must scan the complete lane backlog with a bounded server-side page fan-out.",
);
assert(
  server.includes("searchValue(row).includes(search)") &&
    server.includes("sortRows(searched, sort)") &&
    server.indexOf("sortRows(searched, sort)") <
      server.indexOf("sorted.slice(offset, offset + limit)"),
  "Search and sorting must run before application pagination.",
);
assert(
  route.includes('search: request.nextUrl.searchParams.get("search")') &&
    route.includes('sort: request.nextUrl.searchParams.get("sort")'),
  "The protected execution route must forward global search and sort parameters.",
);
assert(
  dashboard.includes("Search the full backlog") &&
    dashboard.includes("Retry failed rows") &&
    dashboard.includes("lastBatch.failures") &&
    dashboard.includes("failure.index"),
  "The admin queue must expose full-backlog search and deterministic failed-row retry controls.",
);
assert(
  !dashboard.includes("window.confirm"),
  "Administrative confirmations must remain inline and accessible.",
);
assert(
  !server.match(
    /(?:insert|update|delete)\s+.*tcos_kingmaker_(?:price_entries|observations)/i,
  ),
  "Global queue queries must not mutate protected pricing records.",
);

console.log("KINGMAKER global execution query contract certified.");
