import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync("src/lib/profit-hunter-server-run.js", "utf8");
const route = readFileSync("src/app/api/cron/profit-hunter/route.js", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

assert.match(runner, /const PROFIT_HUNTER_HOURS = Object\.freeze\(\[7, 9, 11, 13, 15, 17, 19, 21\]\)/);
assert.match(runner, /const EXPECTED_TOTAL_FAMILIES/);
assert.match(runner, /EXPECTED_WNBA_FAMILIES = 15/);
assert.match(runner, /EXPECTED_MICHKOV_YOUNG_GUNS_FAMILIES = 8/);
assert.match(runner, /EXPECTED_MICHKOV_OPC_FAMILIES = 10/);
assert.match(runner, /new EbayBrowseAdapter\(\)/);
assert.match(runner, /runMarketIntelHotWatch/);
assert.match(runner, /getMarketIntelDealWorkbench/);
assert.match(runner, /expectedNetRoiPercent >= 20/);
assert.match(runner, /Number\(deal\.exactSoldCount \|\| 0\) >= 2/);
assert.match(runner, /maximumDeliveredCostFor20PercentRoi/);
assert.match(runner, /vercel_server_cron/);
assert.doesNotMatch(runner, /fetch\([\s\S]{0,100}truelycollectables\.com/i);

assert.match(route, /isAuthorizedMarketIntelIngest/);
assert.match(route, /OUTSIDE_PROFIT_HUNTER_MOUNTAIN_SCHEDULE/);
assert.match(route, /runProfitHunterServerCycle/);
assert.match(route, /PROFIT_HUNTER_SERVER_CRON_READY/);
assert.match(route, /maxDuration = 300/);

const profitCron = vercel.crons.find(
  (entry) => entry.path === "/api/cron/profit-hunter?perQuery=20",
);
assert.ok(profitCron, "Profit Hunter Vercel cron is missing.");
assert.equal(profitCron.schedule, "1 * * * *");
assert.equal(
  vercel.crons.some((entry) => entry.path.includes("/market-intel/ebay/hot-watch")),
  false,
  "Legacy standalone Hot Watch cron must be removed to prevent duplicate and overnight deal searches.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      executionPath: "vercel_server_cron",
      scheduleGuard: "America/Denver 07,09,11,13,15,17,19,21",
      expectedNativeFamilies: 51,
      exactCompMinimumSales: 2,
      minimumNetRoiPercent: 20,
      legacyChatGptNetworkDependency: false,
    },
    null,
    2,
  ),
);
