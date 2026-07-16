import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const jsonOutput = process.argv.includes("--json");

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function countFilesIfPresent(relativeDir) {
  const dir = join(repoRoot, relativeDir);
  if (!existsSync(dir)) return 0;

  return readdirSync(dir).filter((name) => !name.startsWith(".")).length;
}

const manifestPath = "instacomp-trial-manifest.local.json";
const resultsPath = "instacomp-trial-results.local.json";
const trialImagesDir = "instacomp-trial-images";
const trialImageCount = countFilesIfPresent(trialImagesDir);

const checklist = [
  {
    key: "multi_scanner_consensus",
    label:
      "InstaComp™ Multi-Scanner Consensus is wired into scan results: independent AI/OCR readers submit structured findings, TCOS consensus compares them, checklist/catalog truth can referee, and the UI shows the reason trail before comps, sell, or trade confidence is trusted.",
    status: "ready_to_test",
  },
  {
    key: "durable_batch_queue",
    label: "Durable batch upload, queue claims, retry, clear batch, and recovery are testable.",
    status: "ready_to_test",
  },
  {
    key: "image_review_controls",
    label:
      "Front/back thumbnails open large, rotate in 45-degree steps, and must not shrink images or mutate filenames.",
    status: "ready_to_test",
  },
  {
    key: "identity_accuracy",
    label:
      "Set/checklist identity must catch variants, inserts, Clear Cut, serial runs, and avoid generic Base unless it is real card text.",
    status: "ready_to_test",
  },
  {
    key: "title_quality",
    label:
      "Draft titles must avoid repeated names, repeated releases, repeated parallels, and wrong Upper Deck/O-Pee-Chee manufacturer wording.",
    status: "ready_to_test",
  },
  {
    key: "pricing_and_comps",
    label:
      "COMC active listing pricing stays out; comps must use approved sources or fall back to manual/listing review without pretending certainty.",
    status: "ready_to_test",
  },
  {
    key: "sell_or_trade_handoff",
    label:
      "Buy Me on TCOS, Trade For Me on TCOS, and Add to Available for Trade are mutually safe; a scan row cannot become both sell and trade.",
    status: "ready_to_test",
  },
  {
    key: "speed_and_pressure",
    label:
      "Fast batch prep, five-row claim mini-packs, and database-pressure governor are ready for a real lot timing test.",
    status: "ready_to_test",
  },
  {
    key: "trial_results_export",
    label:
      "Admin InstaComp can export or copy completed visible batch rows as tcos.instacompTrialResults.v1 JSON for the 94% scorekeeper, including consensus/review status and row-stable trialCardId values.",
    status: "ready_to_test",
  },
  {
    key: "trial_failure_report",
    label:
      "The 94% scorekeeper can write tcos.instacompTrialFailureReport.v1 JSON with missing rows, mismatched fields, consensus-review blockers, and suggested fix actions.",
    status: "ready_to_test",
  },
  {
    key: "hundred_card_trial",
    label:
      "100-card / 200-scan final trial must score at least 94% against the local ground-truth manifest.",
    status:
      existsSync(join(repoRoot, manifestPath)) && existsSync(join(repoRoot, resultsPath))
        ? "ready_to_score"
        : "needs_local_trial_files",
  },
  {
    key: "ui_cleanup",
    label:
      "Final tester should identify the ugly UI spots before the polish pass; no production-live claim until the tester is clean.",
    status: "ready_to_test",
  },
];

const readiness = {
  schema: "tcos.instacompFinalTesterReadiness.v1",
  generatedAt: new Date().toISOString(),
  targetReadyByLocal: "2026-07-16",
  priority: "front_of_goal_todo",
  testerUrl: "http://localhost:3000/admin/instacomp",
  git: {
    head: runGit(["rev-parse", "--short", "HEAD"]) || "unknown",
    originMain: runGit(["rev-parse", "--short", "origin/main"]) || "unknown",
    workingTreeClean: runGit(["status", "--short"]) === "",
  },
  localTrial: {
    manifestPath,
    manifestExists: existsSync(join(repoRoot, manifestPath)),
    resultsPath,
    resultsExists: existsSync(join(repoRoot, resultsPath)),
    imagesDir: trialImagesDir,
    imagesDirExists: existsSync(join(repoRoot, trialImagesDir)),
    imageFileCount: trialImageCount,
    expectedImageCount: 200,
  },
  checklist,
  commands: {
    openTester: "http://localhost:3000/admin/instacomp",
    buildConsensus:
      "Implement InstaComp™ Multi-Scanner Consensus before the final July 16 tester pass.",
    verifyHarness: "npm run verify:instacomp",
    initTrial: "npm run instacomp:trial:init",
    scoreTrial:
      "npm run instacomp:trial:report -- --manifest instacomp-trial-manifest.local.json --results instacomp-trial-results.local.json --target 94",
    scoreTrialFailures: "npm run instacomp:trial:failures",
    fullLocalSafety:
      "npm run lint && npm run verify:instacomp && npm run build && npm run check:production-guardrails",
  },
  next:
    "Run the 100-card lot through the wired Multi-Scanner Consensus path, score it against 94%, record misses, and clean the UI before calling it done-done.",
  safeBuildBoundary:
    "This InstaComp tester status is read-only. It does not approve live money, buy postage, release payouts, create Checkout, publish listings, or start production deploys.",
};

if (jsonOutput) {
  console.log(JSON.stringify(readiness, null, 2));
} else {
  console.log("TCOS InstaComp final tester readiness:");
  console.log(`- target ready by local: ${readiness.targetReadyByLocal}`);
  console.log(`- priority: ${readiness.priority}`);
  console.log(`- tester URL: ${readiness.testerUrl}`);
  console.log(`- git HEAD: ${readiness.git.head}`);
  console.log(`- git origin/main: ${readiness.git.originMain}`);
  console.log(`- git working tree clean: ${readiness.git.workingTreeClean ? "yes" : "no"}`);
  console.log(`- trial manifest: ${readiness.localTrial.manifestExists ? "present" : "missing"}`);
  console.log(`- trial results: ${readiness.localTrial.resultsExists ? "present" : "missing"}`);
  console.log(
    `- trial images: ${readiness.localTrial.imageFileCount}/${readiness.localTrial.expectedImageCount} files in ${trialImagesDir}`,
  );
  console.log("");
  console.log("Done-done tester checklist:");
  for (const item of checklist) {
    console.log(`- ${item.status}: ${item.label}`);
  }
  console.log("");
  console.log("Commands:");
  console.log(`- verify harness: ${readiness.commands.verifyHarness}`);
  console.log(`- init trial: ${readiness.commands.initTrial}`);
  console.log(`- score trial: ${readiness.commands.scoreTrial}`);
  console.log(`- score + write failure report: ${readiness.commands.scoreTrialFailures}`);
  console.log(`- full local safety: ${readiness.commands.fullLocalSafety}`);
  console.log("");
  console.log(`Next: ${readiness.next}`);
  console.log(`Safe build boundary: ${readiness.safeBuildBoundary}`);
}
