import { spawnSync } from "node:child_process";

const checks = [
  "check:admin-controls",
  "check:admin-routes",
  "check:admin-copy",
  "simulate:admin-login",
  "simulate:admin-dashboard-actions",
  "simulate:admin-product-bulk",
  "simulate:admin-product-status",
  "simulate:admin-offer-decision",
  "simulate:admin-ebay-actions",
  "simulate:ebay-duplicates",
  "simulate:admin-security-actions",
  "simulate:admin-order-review-actions",
  "simulate:admin-payment-simulation-actions",
  "simulate:admin-live-launch-gates",
  "simulate:admin-seller-payout-actions",
  "simulate:admin-shipping-actions",
  "simulate:admin-financial-reconciliation",
  "simulate:admin-store-settings",
  "simulate:admin-market-intel-watchlist",
  "simulate:admin-market-intel-notices",
  "simulate:admin-market-intel-delivery-report",
  "simulate:admin-market-intel-discovery",
  "simulate:admin-market-intel-ebay-comps",
  "simulate:admin-market-intel-portfolio-actions",
  "simulate:instacomp-row-actions",
  "simulate:instacomp-row-removal",
  "simulate:instacomp-jobs",
];

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];

for (const check of checks) {
  const startedAt = Date.now();
  console.log(`\n▶ ${check}`);

  const result = spawnSync(npmCommand, ["run", check], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  });

  const elapsedMs = Date.now() - startedAt;

  results.push({
    check,
    status: result.status === 0 ? "passed" : "failed",
    elapsedMs,
  });

  if (result.status !== 0) {
    console.error(`\n✗ ${check} failed after ${elapsedMs}ms.`);
    break;
  }
}

const passed = results.filter((result) => result.status === "passed").length;
const failed = results.filter((result) => result.status === "failed").length;

console.log(
  `\nAdmin dashboard verification: ${passed}/${checks.length} passed${
    failed ? `, ${failed} failed` : ""
  }.`,
);

if (failed > 0 || passed !== checks.length) {
  process.exitCode = 1;
}
