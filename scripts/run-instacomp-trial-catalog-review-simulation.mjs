#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const runDir = path.join(repoRoot, ".codex-run");
mkdirSync(runDir, { recursive: true });

const manifestPath = path.join(
  repoRoot,
  "scripts/fixtures/instacomp-trial-manifest.example.json",
);
const sourceResultsPath = path.join(
  repoRoot,
  "scripts/fixtures/instacomp-trial-results.example.json",
);
const reviewResultsPath = path.join(
  runDir,
  "instacomp-trial-catalog-review-fixture.local.json",
);
const failureReportPath = path.join(
  runDir,
  "instacomp-trial-catalog-review-failures.local.json",
);

const results = JSON.parse(readFileSync(sourceResultsPath, "utf8"));
const reviewCard = results.cards.find((card) => card.trialCardId === "fixture-002");
if (!reviewCard) {
  throw new Error("fixture-002 is missing from the InstaComp trial results fixture");
}

reviewCard.catalogEvidence = {
  schema: "tcos.instacomp.catalogEvidence.v1",
  status: "review_required",
  operatorState: "needs_operator_review",
  catalogConfirmed: false,
  sourceLabel: "Fixture Checklist",
  catalogId: "fixture-2024-prizm-draft-picks-22-review",
  matchScore: 79,
  identity: {
    player: "Caitlin Clark",
    year: "2024",
    setName: "Draft Picks",
    cardNumber: "22",
    parallel: "Silver Prizm",
    variation: "Silver Prizm",
  },
  matchedEvidence: ["player matched", "card number matched"],
  mismatchedEvidence: ["parallel needs checklist confirmation"],
  reviewReasons: ["selected catalog score gap is too small for exact-comp trust"],
  suggestedQuestion:
    "Confirm whether fixture-002 is Silver Prizm or a different Prizm parallel before trusting exact comps.",
  operatorAction:
    "Catalog/checklist review required before this row can be exact-comp-ready.",
  safeUseBoundary:
    "Fixture evidence only; no live listings, postage, Checkout, or deploy side effects.",
  actionPermissions: {
    exactCompSearchAllowed: false,
    trustedForExactComps: false,
    publicListingClaimAllowed: false,
    autoPriceAllowed: false,
    tradeValueRecommendationAllowed: false,
  },
};
writeFileSync(reviewResultsPath, `${JSON.stringify(results, null, 2)}\n`);

const command = process.execPath;
const args = [
  "scripts/run-instacomp-trial-report.mjs",
  "--manifest",
  manifestPath,
  "--results",
  reviewResultsPath,
  "--target",
  "94",
  "--target-average-seconds-per-card",
  "15",
  "--target-p95-seconds-per-card",
  "45",
  "--require-timing",
  "--write-failure-report",
  failureReportPath,
  "--json",
];
const result = spawnSync(command, args, {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (result.status === 0) {
  throw new Error("Expected catalog-review fixture to fail the final tester target");
}
if (!result.stdout.trim()) {
  throw new Error(`Expected JSON report on stdout. stderr=${result.stderr}`);
}

const report = JSON.parse(result.stdout);
if (report.targetMet !== false) {
  throw new Error("Expected targetMet=false when catalog review is required");
}
if (report.observed?.catalogEvidence?.reviewRequired !== 1) {
  throw new Error("Expected exactly one catalog-review-required row");
}
if (!report.observed?.catalogReviewIds?.includes("fixture-002")) {
  throw new Error("Expected fixture-002 in observed.catalogReviewIds");
}
if (!report.failures?.some((failure) => failure.trialCardId === "fixture-002" && failure.catalogReviewRequired)) {
  throw new Error("Expected fixture-002 catalog review blocker in failures");
}
if (!report.warnings?.some((warning) => warning.includes("catalog/checklist review"))) {
  throw new Error("Expected catalog/checklist review warning");
}
if (!existsSync(failureReportPath)) {
  throw new Error("Expected catalog-review failure report to be written");
}

const failureReport = JSON.parse(readFileSync(failureReportPath, "utf8"));
if (failureReport.summary?.catalogReviewRequired !== 1) {
  throw new Error("Expected failure report catalogReviewRequired=1");
}
if (
  !failureReport.failures?.some(
    (failure) =>
      failure.trialCardId === "fixture-002" &&
      failure.issueType === "catalog_review_required" &&
      failure.catalogReviewRequired,
  )
) {
  throw new Error("Expected failure report to classify fixture-002 as catalog_review_required");
}

console.log("PASS catalog-review-required row blocks the InstaComp final tester target");
console.log(`- report: ${reviewResultsPath}`);
console.log(`- failure report: ${failureReportPath}`);
