import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const watchMode = args.includes("--watch");

function getFlagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function parsePositiveInteger(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = getFlagValue(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}.`);
  }
  return value;
}

function runFinalTesterStatus() {
  const result = spawnSync("node", ["scripts/status-instacomp-final-tester.mjs", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = (result.stdout || "").trim();

  try {
    return {
      ok: true,
      exitStatus: result.status,
      payload: JSON.parse(stdout),
      stderr: (result.stderr || "").trim(),
    };
  } catch (error) {
    return {
      ok: false,
      exitStatus: result.status,
      payload: null,
      stderr:
        (result.stderr || "").trim() ||
        `Could not parse status:instacomp-final-tester JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

function pct(count, expected) {
  if (!Number.isFinite(count) || !Number.isFinite(expected) || expected <= 0) return 0;
  return Math.round((count / expected) * 100);
}

function buildMonitorReport(iteration = 1) {
  const status = runFinalTesterStatus();
  const payload = status.payload || {};
  const localTrial = payload.localTrial || {};
  const manifestAudit = localTrial.manifestAudit || {};
  const imageAudit = localTrial.imageAudit || {};
  const imageMap = localTrial.imageMap || {};
  const intakePacket = localTrial.intakePacket || {};

  const groundTruthReady = Boolean(manifestAudit.readyToScore);
  const imagesReady = Boolean(imageAudit.readyToScan);
  const receiptsReady =
    Boolean(imageMap.matchesCurrentAudit) && Boolean(intakePacket.matchesCurrentAudit);
  const readyForFinalTrial = status.ok && groundTruthReady && imagesReady && receiptsReady;

  const blockers = [];
  if (!status.ok) {
    blockers.push({
      key: "final_tester_status_unreadable",
      label: "Could not read the InstaComp final tester JSON status.",
      next: status.stderr || "Run npm run status:instacomp-final-tester:json directly.",
    });
  }
  if (status.ok && !groundTruthReady) {
    blockers.push({
      key: "ground_truth_not_ready",
      label: `${manifestAudit.readyRows ?? 0}/${manifestAudit.expectedCards ?? 100} answer-key rows are core-ready.`,
      next:
        manifestAudit.next ||
        "Fill instacomp-trial-groundtruth.local.tsv, then run npm run instacomp:trial:groundtruth:apply.",
      firstRows: manifestAudit.firstMissingCoreRows || [],
    });
  }
  if (status.ok && !imagesReady) {
    blockers.push({
      key: "images_not_ready",
      label: `${imageAudit.completePairs ?? 0}/${imageAudit.expectedCards ?? 100} front/back pairs are complete.`,
      next:
        imageAudit.next ||
        "Copy 200 front/back images into instacomp-trial-images, then run npm run instacomp:trial:prep.",
      firstMissingFronts: imageAudit.firstMissingFronts || [],
      firstMissingBacks: imageAudit.firstMissingBacks || [],
    });
  }
  if (status.ok && imagesReady && !receiptsReady) {
    blockers.push({
      key: "receipts_not_current",
      label: "Image-map and intake-packet receipts are not both current.",
      next: "Run npm run instacomp:trial:prep before scanning.",
    });
  }

  return {
    schema: "tcos.instacompTrialReadinessWatch.v1",
    generatedAt: new Date().toISOString(),
    iteration,
    readyForFinalTrial,
    readyToScanImages: imagesReady,
    readyToScoreGroundTruth: groundTruthReady,
    receiptsCurrent: receiptsReady,
    testerUrl: payload.testerUrl || "http://localhost:3000/admin/instacomp",
    paths: {
      imageDropZone: localTrial.imagesAbsolutePath || null,
      worksheet: "instacomp-trial-groundtruth.local.tsv",
      manifest: localTrial.manifestPath || "instacomp-trial-manifest.local.json",
      preflightJson: "instacomp-trial-preflight.local.json",
      preflightMarkdown: "instacomp-trial-preflight.local.md",
    },
    progress: {
      groundTruthRows: {
        ready: manifestAudit.readyRows ?? 0,
        expected: manifestAudit.expectedCards ?? 100,
        percent: pct(manifestAudit.readyRows ?? 0, manifestAudit.expectedCards ?? 100),
      },
      imageFiles: {
        observed: localTrial.imageFileCount ?? 0,
        expected: localTrial.expectedImageCount ?? 200,
        percent: pct(localTrial.imageFileCount ?? 0, localTrial.expectedImageCount ?? 200),
      },
      imagePairs: {
        complete: imageAudit.completePairs ?? 0,
        expected: imageAudit.expectedCards ?? 100,
        percent: pct(imageAudit.completePairs ?? 0, imageAudit.expectedCards ?? 100),
      },
    },
    blockers,
    next: readyForFinalTrial
      ? "Ready: scan the lot at http://localhost:3000/admin/instacomp, export trial results, then run npm run instacomp:trial:score."
      : blockers[0]?.next || "Run npm run instacomp:trial:prep, then rerun this monitor.",
    commands: {
      prep: "npm run instacomp:trial:prep",
      monitor: "npm run instacomp:trial:monitor",
      monitorJson: "npm run instacomp:trial:monitor:json",
      watch: "node scripts/watch-instacomp-trial-readiness.mjs --watch",
      applyGroundTruth: "npm run instacomp:trial:groundtruth:apply",
      preflight: "npm run instacomp:trial:preflight",
      score: "npm run instacomp:trial:score",
    },
    safeBuildBoundary:
      "Local InstaComp trial readiness monitoring only. Does not scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
}

function printReport(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("TCOS InstaComp trial readiness monitor:");
  console.log(`- generated: ${report.generatedAt}`);
  console.log(`- iteration: ${report.iteration}`);
  console.log(`- tester URL: ${report.testerUrl}`);
  console.log(`- ready for final trial: ${report.readyForFinalTrial ? "YES" : "NO"}`);
  console.log(
    `- answer key: ${report.progress.groundTruthRows.ready}/${report.progress.groundTruthRows.expected} rows (${report.progress.groundTruthRows.percent}%)`,
  );
  console.log(
    `- images: ${report.progress.imageFiles.observed}/${report.progress.imageFiles.expected} files (${report.progress.imageFiles.percent}%)`,
  );
  console.log(
    `- pairs: ${report.progress.imagePairs.complete}/${report.progress.imagePairs.expected} complete (${report.progress.imagePairs.percent}%)`,
  );
  console.log(`- receipts current: ${report.receiptsCurrent ? "yes" : "no"}`);
  console.log(`- image drop zone: ${report.paths.imageDropZone}`);
  console.log(`- worksheet: ${report.paths.worksheet}`);

  if (report.blockers.length > 0) {
    console.log("- blockers:");
    for (const blocker of report.blockers) {
      console.log(`  - ${blocker.key}: ${blocker.label}`);
      if (blocker.next) console.log(`    next: ${blocker.next}`);
      if (Array.isArray(blocker.firstMissingFronts) && blocker.firstMissingFronts.length > 0) {
        console.log(`    first missing fronts: ${blocker.firstMissingFronts.join(", ")}`);
      }
      if (Array.isArray(blocker.firstMissingBacks) && blocker.firstMissingBacks.length > 0) {
        console.log(`    first missing backs: ${blocker.firstMissingBacks.join(", ")}`);
      }
      if (Array.isArray(blocker.firstRows) && blocker.firstRows.length > 0) {
        console.log(
          `    first missing answer-key rows: ${blocker.firstRows
            .map((row) => row.trialCardId || "unknown")
            .join(", ")}`,
        );
      }
    }
  }

  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

async function main() {
  const intervalMs = parsePositiveInteger("--interval-ms", 5000, { min: 1000, max: 60000 });
  const maxIterations = watchMode
    ? parsePositiveInteger("--max-iterations", 0, { min: 0, max: 100000 })
    : 1;

  let iteration = 1;
  while (true) {
    const report = buildMonitorReport(iteration);
    printReport(report);
    if (!watchMode || report.readyForFinalTrial) break;
    if (maxIterations > 0 && iteration >= maxIterations) break;
    iteration += 1;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
