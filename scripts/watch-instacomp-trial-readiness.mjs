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

function gateStatus(ok, partial = false) {
  if (ok) return "ready";
  return partial ? "partial" : "blocked";
}

function buildReadinessGates({
  manifestAudit,
  answerKeyHtml,
  answerKeyValidation,
  localTrial,
  imageAudit,
  imageMap,
  intakePacket,
  groundTruthReady,
  imagesReady,
  receiptsReady,
}) {
  const answerKeyReadyRows = manifestAudit.readyRows ?? 0;
  const expectedCards = manifestAudit.expectedCards ?? 100;
  const imageFiles = localTrial.imageFileCount ?? 0;
  const expectedImages = localTrial.expectedImageCount ?? 200;
  const completePairs = imageAudit.completePairs ?? 0;

  return [
    {
      key: "answer_key_html",
      label: "Visual answer-key sheet",
      status:
        answerKeyHtml.exists && answerKeyHtml.matchesCurrentWorksheet
          ? answerKeyHtml.shortLot
            ? "partial"
            : "ready"
          : "blocked",
      detail: `${answerKeyHtml.path || "instacomp-trial-answer-key.local.html"} ${
        answerKeyHtml.matchesCurrentWorksheet
          ? answerKeyHtml.shortLot
            ? `matches loaded ${answerKeyHtml.loadedCards}/${answerKeyHtml.expectedCards} card worksheet`
            : "matches worksheet"
          : "needs refresh"
      }`,
      command: "npm run instacomp:trial:answer-key-html",
    },
    {
      key: "answer_key_rows",
      label: "Answer-key core rows",
      status: gateStatus(groundTruthReady, answerKeyReadyRows > 0),
      detail: `${answerKeyReadyRows}/${expectedCards} rows have player/year/setName/cardNumber`,
      command: "manual: fill instacomp-trial-groundtruth.local.tsv",
    },
    {
      key: "answer_key_validation",
      label: "Answer-key TSV validation",
      status: gateStatus(
        Boolean(answerKeyValidation.matchesCurrentWorksheet) && Boolean(answerKeyValidation.ok),
        Boolean(answerKeyValidation.exists) && Boolean(answerKeyValidation.matchesCurrentWorksheet),
      ),
      detail: answerKeyValidation.ok
        ? "validation clean"
        : answerKeyValidation.next ||
          "run validation before applying worksheet values to the manifest",
      command: "npm run instacomp:trial:answer-key:validate",
    },
    {
      key: "trial_images",
      label: "Trial front/back image files",
      status: gateStatus(imagesReady, imageFiles > 0 || completePairs > 0),
      detail: `${imageFiles}/${expectedImages} files, ${completePairs}/${expectedCards} complete pairs`,
      command: "manual: copy scanner files into instacomp-trial-inbox",
    },
    {
      key: "image_receipts",
      label: "Image map + intake packet receipts",
      status: gateStatus(receiptsReady, Boolean(imageMap.exists) || Boolean(intakePacket.exists)),
      detail: `image map ${imageMap.matchesCurrentAudit ? "current" : "not current"}, intake packet ${
        intakePacket.matchesCurrentAudit ? "current" : "not current"
      }`,
      command: "npm run instacomp:trial:prep",
    },
  ];
}

function buildOperatorNextActions({
  answerKeyHtml,
  answerKeyValidation,
  groundTruthReady,
  imagesReady,
  receiptsReady,
  localTrial,
}) {
  const actions = [];
  const visualAnswerKeyReady =
    Boolean(answerKeyHtml.exists) && Boolean(answerKeyHtml.matchesCurrentWorksheet);
  const validationCurrent = Boolean(answerKeyValidation.matchesCurrentWorksheet);
  const validationClean = validationCurrent && Boolean(answerKeyValidation.ok);
  const inboxCount = localTrial.inboxImageFileCount ?? 0;
  const stagedImageCount = localTrial.imageFileCount ?? 0;

  if (!visualAnswerKeyReady) {
    actions.push({
      key: "refresh_visual_answer_key",
      type: "command",
      command: "npm run instacomp:trial:answer-key-html",
      why: "Refresh the visual worksheet before filling card identities.",
    });
  }

  if (!groundTruthReady) {
    actions.push({
      key: "fill_answer_key",
      type: "manual",
      command: "open instacomp-trial-answer-key.local.html beside instacomp-trial-groundtruth.local.tsv",
      why: "Fill player, year, setName, and cardNumber for all 100 trial cards.",
    });
  }

  if (!validationClean) {
    actions.push({
      key: "validate_answer_key",
      type: "command",
      command: "npm run instacomp:trial:answer-key:validate",
      why: validationCurrent
        ? "Recheck the edited TSV and confirm there are no missing rows, duplicate IDs, or missing core fields."
        : "Create a current validation receipt before applying TSV values to the manifest.",
    });
  }

  if (validationClean && !groundTruthReady) {
    actions.push({
      key: "apply_answer_key",
      type: "command",
      command: "npm run instacomp:trial:groundtruth:apply",
      why: "Validation is clean; apply the TSV values back to the local manifest.",
    });
  }

  if (!imagesReady) {
    actions.push({
      key: "load_trial_images",
      type: "manual",
      command:
        inboxCount > 0 || stagedImageCount > 0
          ? "finish loading the missing front/back images"
          : "copy about 200 scanner images into instacomp-trial-inbox",
      why: "The 100-card trial needs complete front/back pairs before scanner time is spent.",
    });
    actions.push({
      key: "run_trial_intake",
      type: "command",
      command: "npm run instacomp:trial:intake",
      why: "Dry-run staging, sync image paths, and refresh local receipts after files are loaded.",
    });
  }

  if (groundTruthReady && imagesReady && !receiptsReady) {
    actions.push({
      key: "refresh_preflight_receipts",
      type: "command",
      command: "npm run instacomp:trial:prep",
      why: "Refresh image map, intake packet, and preflight evidence before scanning.",
    });
  }

  if (groundTruthReady && imagesReady && receiptsReady) {
    actions.push({
      key: "scan_trial",
      type: "operator",
      command: "open http://localhost:3000/admin/instacomp",
      why: "All local gates are ready; run the lot, export results, then score the trial.",
    });
  }

  return actions.slice(0, 6);
}

function buildMonitorReport(iteration = 1) {
  const status = runFinalTesterStatus();
  const payload = status.payload || {};
  const localTrial = payload.localTrial || {};
  const manifestAudit = localTrial.manifestAudit || {};
  const imageAudit = localTrial.imageAudit || {};
  const imageMap = localTrial.imageMap || {};
  const intakePacket = localTrial.intakePacket || {};
  const answerKeyHtml = localTrial.answerKeyHtml || {};
  const answerKeyValidation = localTrial.answerKeyValidation || {};

  const groundTruthReady = Boolean(manifestAudit.readyToScore);
  const expectedCards = manifestAudit.expectedCards ?? 100;
  const expectedImages = localTrial.expectedImageCount ?? expectedCards * 2;
  const imageFiles = localTrial.imageFileCount ?? 0;
  const completePairs = imageAudit.completePairs ?? 0;
  const imagesReady =
    Boolean(imageAudit.readyToScan) &&
    imageFiles >= expectedImages &&
    completePairs >= expectedCards;
  const receiptsReady =
    Boolean(imageMap.matchesCurrentAudit) && Boolean(intakePacket.matchesCurrentAudit);
  const readyForFinalTrial = status.ok && groundTruthReady && imagesReady && receiptsReady;

  const blockers = [];
  if (!status.ok) {
    blockers.push({
      key: "final_tester_status_unreadable",
      label: "Could not read the InstaComp™ final tester JSON status.",
      next: status.stderr || "Run npm run status:instacomp-final-tester:json directly.",
    });
  }
  if (status.ok && !groundTruthReady) {
    const visualAnswerKeyReady =
      Boolean(answerKeyHtml.exists) && Boolean(answerKeyHtml.matchesCurrentWorksheet);
    const validationCurrent = Boolean(answerKeyValidation.matchesCurrentWorksheet);
    const validationClean = validationCurrent && Boolean(answerKeyValidation.ok);
    const visualAnswerKeyPath = answerKeyHtml.path || "instacomp-trial-answer-key.local.html";
    const validationNext = validationClean
      ? "Answer-key validation is clean. Run npm run instacomp:trial:groundtruth:apply, then npm run instacomp:trial:groundtruth."
      : validationCurrent
        ? `Use ${visualAnswerKeyPath} beside instacomp-trial-groundtruth.local.tsv. ${
            answerKeyValidation.next ||
            "Fix the validation issues, save the TSV, then rerun npm run instacomp:trial:answer-key:validate."
          }`
        : "Run npm run instacomp:trial:answer-key:validate before applying the TSV back to the manifest.";
    blockers.push({
      key: "ground_truth_not_ready",
      label: `${manifestAudit.readyRows ?? 0}/${manifestAudit.expectedCards ?? 100} answer-key rows are core-ready.`,
      next:
        (visualAnswerKeyReady
          ? validationNext
          : answerKeyHtml.next) ||
        manifestAudit.next ||
        "Fill instacomp-trial-groundtruth.local.tsv, then run npm run instacomp:trial:answer-key:validate before applying it.",
      firstRows: manifestAudit.firstMissingCoreRows || [],
      answerKeyValidation: {
        exists: Boolean(answerKeyValidation.exists),
        matchesCurrentWorksheet: validationCurrent,
        ok: validationClean,
        path: answerKeyValidation.path || "instacomp-trial-answer-key-validation.local.json",
        next: validationNext,
      },
    });
  }
  if (status.ok && !imagesReady) {
    const missingImageFiles = Math.max(0, expectedImages - imageFiles);
    const missingPairs = Math.max(0, expectedCards - completePairs);
    blockers.push({
      key: "images_not_ready",
      label: `${completePairs}/${expectedCards} final-trial front/back pairs are complete.`,
      next:
        missingImageFiles > 0 || missingPairs > 0
          ? `Copy the missing ${missingImageFiles} image file(s) / ${missingPairs} card pair(s) into instacomp-trial-inbox, then run npm run instacomp:trial:intake.`
          : imageAudit.next ||
            "Copy 200 front/back images into instacomp-trial-inbox, then run npm run instacomp:trial:intake.",
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

  const readinessGates = buildReadinessGates({
    manifestAudit,
    answerKeyHtml,
    answerKeyValidation,
    localTrial,
    imageAudit,
    imageMap,
    intakePacket,
    groundTruthReady,
    imagesReady,
    receiptsReady,
  });
  const operatorNextActions = buildOperatorNextActions({
    answerKeyHtml,
    answerKeyValidation,
    groundTruthReady,
    imagesReady,
    receiptsReady,
    localTrial,
  });

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
      rawInbox: localTrial.inboxAbsolutePath || "instacomp-trial-inbox",
      imageDropZone: localTrial.imagesAbsolutePath || null,
      normalizedImages: localTrial.imagesAbsolutePath || null,
      worksheet: "instacomp-trial-groundtruth.local.tsv",
      answerKeyHtml: answerKeyHtml.path || "instacomp-trial-answer-key.local.html",
      answerKeyValidation:
        answerKeyValidation.path || "instacomp-trial-answer-key-validation.local.json",
      manifest: localTrial.manifestPath || "instacomp-trial-manifest.local.json",
      preflightJson: "instacomp-trial-preflight.local.json",
      preflightMarkdown: "instacomp-trial-preflight.local.md",
    },
    answerKeyHtml: {
      exists: Boolean(answerKeyHtml.exists),
      matchesCurrentWorksheet: Boolean(answerKeyHtml.matchesCurrentWorksheet),
      path: answerKeyHtml.path || "instacomp-trial-answer-key.local.html",
      next:
        answerKeyHtml.next ||
        "Run npm run instacomp:trial:answer-key-html to refresh the local visual answer-key sheet.",
    },
    answerKeyValidation: {
      exists: Boolean(answerKeyValidation.exists),
      matchesCurrentWorksheet: Boolean(answerKeyValidation.matchesCurrentWorksheet),
      ok: Boolean(answerKeyValidation.ok),
      path: answerKeyValidation.path || "instacomp-trial-answer-key-validation.local.json",
      next:
        answerKeyValidation.next ||
        "Run npm run instacomp:trial:answer-key:validate before applying the TSV back to the manifest.",
    },
    readinessGates,
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
        expected: expectedCards,
        percent: pct(imageAudit.completePairs ?? 0, expectedCards),
      },
    },
    blockers,
    operatorNextActions,
    next: readyForFinalTrial
      ? "Ready: scan the lot at http://localhost:3000/admin/instacomp, export trial results, then run npm run instacomp:trial:score."
      : operatorNextActions[0]?.command ||
        blockers[0]?.next ||
        "Run npm run instacomp:trial:prep, then rerun this monitor.",
    commands: {
      prep: "npm run instacomp:trial:prep",
      monitor: "npm run instacomp:trial:monitor",
      monitorJson: "npm run instacomp:trial:monitor:json",
      watch: "node scripts/watch-instacomp-trial-readiness.mjs --watch",
      intake: "npm run instacomp:trial:intake",
      writeAnswerKeyHtml: "npm run instacomp:trial:answer-key-html",
      validateAnswerKey: "npm run instacomp:trial:answer-key:validate",
      applyGroundTruth: "npm run instacomp:trial:groundtruth:apply",
      preflight: "npm run instacomp:trial:preflight",
      score: "npm run instacomp:trial:score",
    },
    safeBuildBoundary:
      "Local InstaComp™ trial readiness monitoring only. Does not scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
}

function printReport(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("TCOS InstaComp™ trial readiness monitor:");
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
  console.log(`- raw scanner inbox: ${report.paths.rawInbox}`);
  console.log(`- image drop zone: ${report.paths.imageDropZone}`);
  console.log(`- worksheet: ${report.paths.worksheet}`);
  console.log(
    `- visual answer key: ${report.answerKeyHtml.exists ? "present" : "missing"} - ${
      report.answerKeyHtml.matchesCurrentWorksheet ? "matches worksheet" : "not ready"
    } - ${report.paths.answerKeyHtml}`,
  );
  console.log(
    `- answer-key validation: ${report.answerKeyValidation.exists ? "present" : "missing"} - ${
      report.answerKeyValidation.matchesCurrentWorksheet ? "matches worksheet" : "not ready"
    } - ${report.answerKeyValidation.ok ? "clean" : "needs fixes"} - ${
      report.paths.answerKeyValidation
    }`,
  );
  if (Array.isArray(report.readinessGates) && report.readinessGates.length > 0) {
    console.log("- readiness gates:");
    for (const gate of report.readinessGates) {
      console.log(`  - ${gate.status}: ${gate.label} - ${gate.detail}`);
    }
  }
  if (Array.isArray(report.operatorNextActions) && report.operatorNextActions.length > 0) {
    console.log("- operator next actions:");
    for (const [index, action] of report.operatorNextActions.entries()) {
      console.log(`  ${index + 1}. ${action.command}`);
      console.log(`     why: ${action.why}`);
    }
  }

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
