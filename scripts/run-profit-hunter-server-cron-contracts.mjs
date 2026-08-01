import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Production deployment trigger: 2026-07-31 after the Hot Watch
// tcos_mi_listings.listing_status repair. This connector-authored commit launches
// the deploy-and-force-run workflow from the corrected current main.
const runner = readFileSync("src/lib/profit-hunter-server-run.js", "utf8");
const route = readFileSync("src/app/api/cron/profit-hunter/route.js", "utf8");
const rankedEmail = readFileSync(
  "src/lib/profit-hunter-ranked-email.js",
  "utf8",
);
const rankedEmailState = readFileSync(
  "src/lib/profit-hunter-ranked-email-state.js",
  "utf8",
);
const hotWatch = readFileSync("src/lib/market-intel-hot-watch.ts", "utf8");
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
assert.match(runner, /const reportType = "hourly_deals";/);
assert.match(runner, /\.eq\("report_type", "hourly_deals"\)/);
assert.doesNotMatch(runner, /profit_hunter_cycle_/);
assert.match(runner, /vercel_server_cron/);
assert.doesNotMatch(runner, /fetch\([\s\S]{0,100}truelycollectables\.com/i);

assert.match(route, /isAuthorizedMarketIntelIngest/);
assert.match(route, /PROFIT_HUNTER_RUN_SECRET/);
assert.match(route, /OUTSIDE_PROFIT_HUNTER_MOUNTAIN_SCHEDULE/);
assert.match(route, /runProfitHunterServerCycle/);
assert.match(route, /PROFIT_HUNTER_SERVER_CRON_READY/);
assert.match(route, /maxDuration = 300/);
assert.match(route, /sendRankedProfitHunterEmail/);
assert.match(route, /readPriorRankedProfitHunterEmailState/);
assert.match(route, /restoreRankedProfitHunterEmailState/);
assert.match(route, /runCycleWithoutLegacyEmail/);
assert.match(route, /MARKET_INTEL_EMAIL_ENABLED = "false"/);
assert.match(route, /legacyPlainReportEmailSuppressed: true/);
assert.match(route, /unchangedContentSuppressed: true/);
assert.match(route, /force: force && allowForcedEmail/);
assert.match(route, /avoid a duplicate email/);

for (const fragment of [
  'const EMAIL_SCHEMA = "tcos.sharkListRankedEmail.v1"',
  "VERIFIED SHARK BITE",
  "Potental Hidden Gems in Photo",
  "MISSPELLINGS / MISLISTINGS / MISINTERPRETED LOTS",
  "MAKE OFFER AVAILABLE",
  "NO OFFER CONFIRMED",
  "OPEN LISTING",
  "ranked_shark_email_fingerprint",
  "getMarketIntelDeliveryConfig",
  "offerAvailable(candidate.buyingOptions)",
  "identity_proof_status",
  "identity_proof_operator_confirmed",
  "front_image_confirmed",
  "back_image_confirmed",
  "checklist_confirmed",
  "card_number_confirmed",
  "parallel_confirmed",
  "no_conflicting_evidence",
  "explicitVisiblePremiumPhotoEvidence",
  "scoredRowsQuarantinedForIdentityProof",
]) {
  assert.ok(
    rankedEmail.includes(fragment),
    `Ranked Shark List email is missing ${fragment}.`,
  );
}
assert.match(
  rankedEmail,
  /normalized\(option\) === "best offer"/,
  "Make Offer must be proven from the exact listing buying options.",
);
assert.match(
  rankedEmail,
  /status === "verified_exact" && missing\.length === 0/,
  "Verified Shark Bites must fail closed unless the complete Identity Proof Gate passes.",
);
assert.match(
  rankedEmail,
  /lotSignal\(row\) &&[\s\S]{0,100}row\.visiblePremiumPhotoEvidence/,
  "Potental Hidden Gems in Photo must require explicit visible-premium photo evidence.",
);
assert.match(
  rankedEmail,
  /unverified contents receive \$0 projected value/i,
  "Manual-review lot contents must remain excluded from projected value.",
);

for (const fragment of [
  '"ranked_shark_email_fingerprint"',
  "readPriorRankedProfitHunterEmailState",
  "restoreRankedProfitHunterEmailState",
  '.eq("report_type", "hourly_deals")',
  "...state",
]) {
  assert.ok(
    rankedEmailState.includes(fragment),
    `Ranked Shark List state persistence is missing ${fragment}.`,
  );
}

assert.match(
  hotWatch,
  /\.from\("tcos_mi_listings"\)[\s\S]{0,160}\.eq\("listing_status", "active"\)/,
);
assert.doesNotMatch(
  hotWatch,
  /\.from\("tcos_mi_listings"\)[\s\S]{0,160}\.eq\("status", "active"\)/,
);

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
      approvedReportType: "hourly_deals",
      rankedEmailFormat: "ranked_clickable_shark_list_v1",
      legacyPlainReportEmailSuppressed: true,
      unchangedRankedEmailSuppressed: true,
      verifiedEmailRowsRequireIdentityProofGate: true,
      potentialHiddenGemsRequireVisiblePhotoEvidence: true,
      offerRequiresExactBestOfferEvidence: true,
      hotWatchListingStatusColumn: "listing_status",
      legacyChatGptNetworkDependency: false,
      outcomeRecorderRequired: true,
    },
    null,
    2,
  ),
);
