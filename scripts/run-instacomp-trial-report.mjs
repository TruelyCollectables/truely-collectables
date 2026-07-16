import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TARGET_CARDS = 100;
const DEFAULT_TARGET_ACCURACY = 94;
const DEFAULT_TRIAL_IMAGE_DIR = "instacomp-trial-images";
const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
]);
const frontTokens = new Set(["front", "fr", "f", "obverse"]);
const backTokens = new Set(["back", "bk", "b", "reverse", "rear"]);

const identityFields = [
  "player",
  "year",
  "brand",
  "setName",
  "cardNumber",
  "parallel",
  "variation",
  "team",
  "sport",
  "isRookie",
  "isAuto",
  "isRelic",
];

const args = process.argv.slice(2);

function getFlagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function usage() {
  return [
    "InstaComp 100-card trial report",
    "",
    "Create a local 100-card manifest:",
    "  node scripts/run-instacomp-trial-report.mjs --init-manifest instacomp-trial-manifest.local.json --cards 100",
    "",
    "Score a completed trial:",
    "  node scripts/run-instacomp-trial-report.mjs --manifest instacomp-trial-manifest.local.json --results instacomp-trial-results.local.json --target 94",
    "",
    "Useful flags:",
    "  --audit-images <dir>",
    "                   audit a local front/back trial image folder before scanning",
    "  --expected-cards <count>",
    "                   expected card count for --audit-images when manifest target is absent",
    "  --json            print machine-readable JSON only",
    "  --require-files   fail when manifest image paths do not exist locally",
    "  --write-failure-report <path>",
    "                   write a durable JSON fix queue for mismatches, missing rows, and consensus-review cards",
  ].join("\n");
}

function isKnown(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function normalizeText(value) {
  if (!isKnown(value)) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/\brookie card\b/g, "rookie")
    .replace(/\brc\b/g, "rookie")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSerial(value) {
  if (!isKnown(value)) return "";
  return String(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[｜⁄]/g, "/")
    .replace(/\bOF\b/g, "/")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[^0-9/]+/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

function normalizeForField(field, value) {
  if (field === "serialNumber" || field === "serialRun") return normalizeSerial(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return normalizeText(value);
}

function compareField(field, expected, actual) {
  return normalizeForField(field, expected) === normalizeForField(field, actual);
}

function readResultFields(result) {
  return result?.actual || result?.result || result?.predicted || result?.ai || result || {};
}

function readConsensus(result) {
  return (
    result?.consensus ||
    result?.result?.consensus ||
    result?.predicted?.consensus ||
    result?.ai?.consensus ||
    null
  );
}

function buildPlaceholderManifest(cards) {
  const cardRows = Array.from({ length: cards }, (_, index) => {
    const id = String(index + 1).padStart(3, "0");
    return {
      trialCardId: `trial-card-${id}`,
      frontImage: `./instacomp-trial-images/${id}-front.jpg`,
      backImage: `./instacomp-trial-images/${id}-back.jpg`,
      expected: {
        player: "",
        year: "",
        brand: "",
        setName: "",
        cardNumber: "",
        parallel: "",
        variation: "",
        serialNumber: "",
        serialRun: "",
        team: "",
        sport: "",
        isRookie: false,
        isAuto: false,
        isRelic: false,
      },
      notes: "",
    };
  });

  return {
    schema: "tcos.instacompTrialManifest.v1",
    trialName: "InstaComp 100-card front/back accuracy trial",
    targetCards: cards,
    targetScans: cards * 2,
    targetAccuracyPercent: DEFAULT_TARGET_ACCURACY,
    instructions:
      "Fill expected fields from the physical card before scoring. Use one row per card and include both front/back image paths when available.",
    cards: cardRows,
  };
}

async function writeManifestTemplate() {
  if (!hasFlag("--init-manifest")) return false;

  const output = getFlagValue("--init-manifest");
  if (!output) {
    console.error("Missing --init-manifest path.\n\n" + usage());
    process.exitCode = 1;
    return true;
  }

  const cardsValue = Number.parseInt(getFlagValue("--cards", String(DEFAULT_TARGET_CARDS)), 10);
  const cards = Number.isFinite(cardsValue) && cardsValue > 0 ? cardsValue : DEFAULT_TARGET_CARDS;
  const manifest = buildPlaceholderManifest(cards);
  const resolved = path.resolve(output);

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created InstaComp trial manifest template: ${resolved}`);
  console.log(`Cards: ${cards}`);
  console.log(`Expected scans: ${cards * 2}`);
  return true;
}

async function readJsonFile(filePath, label) {
  if (!filePath) throw new Error(`Missing ${label} path.`);
  const resolved = path.resolve(filePath);
  const raw = await readFile(resolved, "utf8");
  return { resolved, data: JSON.parse(raw) };
}

function validateManifestShape(manifest) {
  if (manifest?.schema !== "tcos.instacompTrialManifest.v1") {
    throw new Error("Manifest schema must be tcos.instacompTrialManifest.v1");
  }
  if (!Array.isArray(manifest.cards) || manifest.cards.length === 0) {
    throw new Error("Manifest must include at least one card.");
  }
}

function validateResultsShape(results) {
  if (results?.schema !== "tcos.instacompTrialResults.v1") {
    throw new Error("Results schema must be tcos.instacompTrialResults.v1");
  }
  if (!Array.isArray(results.cards)) {
    throw new Error("Results must include a cards array.");
  }
}

function padTrialNumber(value) {
  return String(value).padStart(3, "0");
}

function sideFromFilename(filename) {
  const parsed = path.parse(filename);
  const tokens = parsed.name
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const last = tokens.at(-1);
  if (frontTokens.has(last)) return "front";
  if (backTokens.has(last)) return "back";
  return null;
}

function trialNumberFromFilename(filename) {
  const parsed = path.parse(filename);
  const matches = [...parsed.name.matchAll(/\d+/g)].map((match) => match[0]);
  if (matches.length === 0) return null;
  const numeric = Number.parseInt(matches.at(-1), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return padTrialNumber(numeric);
}

function naturalFileSort(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function expectedImageAuditRows(manifest, expectedCards) {
  const cardCount =
    Array.isArray(manifest?.cards) && manifest.cards.length > 0
      ? manifest.cards.length
      : expectedCards;

  return Array.from({ length: cardCount }, (_, index) => {
    const ordinal = padTrialNumber(index + 1);
    const manifestCard = manifest?.cards?.[index];
    return {
      ordinal,
      trialCardId: manifestCard?.trialCardId || `trial-card-${ordinal}`,
    };
  });
}

async function auditTrialImages() {
  if (!hasFlag("--audit-images")) return false;

  const manifestInput = getFlagValue("--manifest");
  const imageDirInput = getFlagValue("--audit-images", DEFAULT_TRIAL_IMAGE_DIR);
  const expectedCardsValue = Number.parseInt(
    getFlagValue("--expected-cards", String(DEFAULT_TARGET_CARDS)),
    10
  );
  const expectedCards =
    Number.isFinite(expectedCardsValue) && expectedCardsValue > 0
      ? expectedCardsValue
      : DEFAULT_TARGET_CARDS;

  let manifest = null;
  let manifestPath = null;
  const warnings = [];
  if (manifestInput) {
    const loaded = await readJsonFile(manifestInput, "manifest");
    manifestPath = loaded.resolved;
    manifest = loaded.data;
    validateManifestShape(manifest);
  } else {
    warnings.push(
      "No manifest was provided; auditing image count and filename pairs only."
    );
  }

  const resolvedImageDir = path.resolve(imageDirInput);
  const expectedRows = expectedImageAuditRows(manifest, expectedCards);
  const expectedOrdinals = new Set(expectedRows.map((row) => row.ordinal));
  const groups = new Map();
  const unknownFiles = [];
  const orderedPairFiles = [];
  const nonImageFiles = [];

  let entries = [];
  if (existsSync(resolvedImageDir)) {
    entries = await readdir(resolvedImageDir, { withFileTypes: true });
  } else {
    warnings.push(`Image folder does not exist: ${resolvedImageDir}`);
  }

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!imageExtensions.has(extension)) {
      nonImageFiles.push(entry.name);
      continue;
    }

    const side = sideFromFilename(entry.name);
    if (!side) {
      orderedPairFiles.push(entry.name);
      continue;
    }

    const ordinal = trialNumberFromFilename(entry.name);
    if (!ordinal) {
      unknownFiles.push({
        file: entry.name,
        reason: "missing card number",
      });
      continue;
    }

    const group = groups.get(ordinal) || { ordinal, front: [], back: [] };
    group[side].push(entry.name);
    groups.set(ordinal, group);
  }

  const missingFronts = [];
  const missingBacks = [];
  const duplicateFronts = [];
  const duplicateBacks = [];
  const completePairs = [];
  const orderedPairAssignments = [];
  const sortedOrderedPairFiles = orderedPairFiles.sort(naturalFileSort);

  for (const [index, row] of expectedRows.entries()) {
    const group = groups.get(row.ordinal) || { ordinal: row.ordinal, front: [], back: [] };
    const orderedFront = sortedOrderedPairFiles[index * 2] || null;
    const orderedBack = sortedOrderedPairFiles[index * 2 + 1] || null;
    const frontCount = group.front.length + (orderedFront ? 1 : 0);
    const backCount = group.back.length + (orderedBack ? 1 : 0);

    if (orderedFront || orderedBack) {
      orderedPairAssignments.push({
        trialCardId: row.trialCardId,
        front: orderedFront,
        back: orderedBack,
      });
    }

    if (frontCount === 0) {
      missingFronts.push(row.trialCardId);
    } else if (frontCount > 1) {
      duplicateFronts.push({
        trialCardId: row.trialCardId,
        files: [...group.front, orderedFront].filter(Boolean),
      });
    }

    if (backCount === 0) {
      missingBacks.push(row.trialCardId);
    } else if (backCount > 1) {
      duplicateBacks.push({
        trialCardId: row.trialCardId,
        files: [...group.back, orderedBack].filter(Boolean),
      });
    }

    if (frontCount === 1 && backCount === 1) {
      completePairs.push(row.trialCardId);
    }
  }

  const unpairedOrderedFiles = sortedOrderedPairFiles
    .slice(expectedRows.length * 2)
    .map((file) => ({
      file,
      reason: "ordered image has no matching trial-card slot",
    }));

  const extraFiles = [...groups.values()]
    .filter((group) => !expectedOrdinals.has(group.ordinal))
    .flatMap((group) =>
      [...group.front, ...group.back].map((file) => ({
        file,
        parsedCardNumber: group.ordinal,
      }))
    );

  const imageFileCount = [...groups.values()].reduce(
    (sum, group) => sum + group.front.length + group.back.length,
    0
  ) + sortedOrderedPairFiles.length + unknownFiles.length;
  const expectedImageCount = expectedRows.length * 2;
  const ready =
    expectedRows.length > 0 &&
    imageFileCount >= expectedImageCount &&
    missingFronts.length === 0 &&
    missingBacks.length === 0 &&
    duplicateFronts.length === 0 &&
    duplicateBacks.length === 0 &&
    unknownFiles.length === 0 &&
    extraFiles.length === 0 &&
    unpairedOrderedFiles.length === 0;

  const report = {
    schema: "tcos.instacompTrialImageAudit.v1",
    generatedAt: new Date().toISOString(),
    sideEffectBoundary:
      "Read-only image audit. Does not publish listings, buy postage, create Checkout, deploy, scan cards, or call production APIs.",
    manifestPath,
    imageDir: resolvedImageDir,
    expected: {
      cards: expectedRows.length,
      images: expectedImageCount,
    },
    observed: {
      parsedImageFiles: imageFileCount,
      completePairs: completePairs.length,
      orderedPairCandidateFiles: sortedOrderedPairFiles.length,
      orderedPairCompletePairs: orderedPairAssignments.filter(
        (item) => item.front && item.back,
      ).length,
      nonImageFiles,
    },
    readyToScan: ready,
    problems: {
      missingFronts,
      missingBacks,
      duplicateFronts,
      duplicateBacks,
      unknownFiles,
      extraFiles,
      unpairedOrderedFiles,
    },
    orderedPairAssignments: orderedPairAssignments.slice(0, 25),
    warnings,
    next: ready
      ? "Run the lot through /admin/instacomp, export trial results, then score with npm run instacomp:trial:report."
      : "Fix the missing, duplicate, unknown, or extra image files before scanning the 100-card lot.",
  };

  if (hasFlag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printImageAudit(report);
  }

  if (!report.readyToScan) process.exitCode = 1;
  return true;
}

function printImageAudit(report) {
  console.log("InstaComp trial image audit:");
  console.log(`Cards expected: ${report.expected.cards}`);
  console.log(`Images expected: ${report.expected.images}`);
  console.log(`Parsed image files: ${report.observed.parsedImageFiles}`);
  console.log(`Complete front/back pairs: ${report.observed.completePairs}`);
  console.log(`Ordered-pair candidate files: ${report.observed.orderedPairCandidateFiles}`);
  if (report.observed.orderedPairCandidateFiles > 0) {
    console.log(
      `Ordered-pair complete pairs: ${report.observed.orderedPairCompletePairs}`,
    );
  }
  console.log(`Ready to scan: ${report.readyToScan ? "yes" : "no"}`);
  if (report.manifestPath) console.log(`Manifest: ${report.manifestPath}`);
  console.log(`Image folder: ${report.imageDir}`);

  if (report.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }

  const problemLines = [
    ["missing fronts", report.problems.missingFronts],
    ["missing backs", report.problems.missingBacks],
    ["duplicate fronts", report.problems.duplicateFronts],
    ["duplicate backs", report.problems.duplicateBacks],
    ["unknown image files", report.problems.unknownFiles],
    ["extra image files", report.problems.extraFiles],
    ["unpaired ordered image files", report.problems.unpairedOrderedFiles],
  ];

  if (problemLines.some(([, rows]) => rows.length > 0)) {
    console.log("");
    console.log("Problems:");
    for (const [label, rows] of problemLines) {
      if (rows.length === 0) continue;
      console.log(`- ${label}: ${rows.length}`);
      for (const row of rows.slice(0, 10)) {
        console.log(`  - ${typeof row === "string" ? row : JSON.stringify(row)}`);
      }
      if (rows.length > 10) console.log(`  - ... ${rows.length - 10} more`);
    }
  }

  if (report.observed.nonImageFiles.length > 0) {
    console.log("");
    console.log(`Ignored non-image files: ${report.observed.nonImageFiles.length}`);
  }

  console.log("");
  console.log(`Next: ${report.next}`);
}

function imageStats(manifestPath, cards) {
  const baseDir = path.dirname(manifestPath);
  const missingImages = [];
  let frontCount = 0;
  let backCount = 0;
  let pairCount = 0;

  for (const card of cards) {
    const frontKnown = isKnown(card.frontImage);
    const backKnown = isKnown(card.backImage);
    if (frontKnown) frontCount += 1;
    if (backKnown) backCount += 1;
    if (frontKnown && backKnown) pairCount += 1;

    for (const side of ["frontImage", "backImage"]) {
      const value = card[side];
      if (!isKnown(value)) continue;
      const resolved = path.resolve(baseDir, value);
      if (!existsSync(resolved)) {
        missingImages.push({
          trialCardId: card.trialCardId,
          side,
          path: value,
        });
      }
    }
  }

  return {
    declaredFrontImages: frontCount,
    declaredBackImages: backCount,
    declaredScanCount: frontCount + backCount,
    declaredFrontBackPairs: pairCount,
    missingImages,
  };
}

function scoreCard(card, result) {
  const expected = card.expected || {};
  const actual = readResultFields(result);
  const consensus = readConsensus(result);
  const consensusReviewRequired = consensus?.status === "review_required";
  const mismatches = [];
  let identityFieldTotal = 0;
  let identityFieldPassed = 0;

  for (const field of identityFields) {
    if (!isKnown(expected[field])) continue;
    identityFieldTotal += 1;
    if (compareField(field, expected[field], actual[field])) {
      identityFieldPassed += 1;
    } else {
      mismatches.push({
        field,
        expected: expected[field],
        actual: actual[field] ?? null,
      });
    }
  }

  const serialChecks = [];
  for (const field of ["serialNumber", "serialRun"]) {
    if (!isKnown(expected[field])) continue;
    const passed = compareField(field, expected[field], actual[field]);
    serialChecks.push({ field, passed });
    if (!passed) {
      mismatches.push({
        field,
        expected: expected[field],
        actual: actual[field] ?? null,
      });
    }
  }

  const identityExactEligible = identityFieldTotal > 0;
  const identityExactPassed =
    identityExactEligible &&
    mismatches.every((item) => !identityFields.includes(item.field));
  const serialNumberEligible = isKnown(expected.serialNumber);
  const serialNumberPassed =
    serialNumberEligible && compareField("serialNumber", expected.serialNumber, actual.serialNumber);
  const serialRunEligible = isKnown(expected.serialRun);
  const serialRunPassed =
    serialRunEligible && compareField("serialRun", expected.serialRun, actual.serialRun);

  return {
    trialCardId: card.trialCardId,
    hasResult: Boolean(result),
    identityFieldTotal,
    identityFieldPassed,
    identityExactEligible,
    identityExactPassed,
    serialNumberEligible,
    serialNumberPassed,
    serialRunEligible,
    serialRunPassed,
    consensusReviewRequired,
    consensusReviewReasons: Array.isArray(consensus?.reviewReasons)
      ? consensus.reviewReasons
      : [],
    mismatches,
  };
}

function percent(passed, total) {
  if (total === 0) return null;
  return Number(((passed / total) * 100).toFixed(2));
}

function summarizeScores(manifest, manifestPath, results, targetAccuracyPercent) {
  const resultById = new Map(
    results.cards
      .filter((item) => isKnown(item.trialCardId))
      .map((item) => [String(item.trialCardId), item])
  );
  const cardScores = manifest.cards.map((card) =>
    scoreCard(card, resultById.get(String(card.trialCardId)))
  );

  const identityExactTotal = cardScores.filter((item) => item.identityExactEligible).length;
  const identityExactPassed = cardScores.filter((item) => item.identityExactPassed).length;
  const serialNumberTotal = cardScores.filter((item) => item.serialNumberEligible).length;
  const serialNumberPassed = cardScores.filter((item) => item.serialNumberPassed).length;
  const serialRunTotal = cardScores.filter((item) => item.serialRunEligible).length;
  const serialRunPassed = cardScores.filter((item) => item.serialRunPassed).length;
  const consensusReviewIds = cardScores
    .filter((item) => item.consensusReviewRequired)
    .map((item) => item.trialCardId);
  const identityFieldTotal = cardScores.reduce((sum, item) => sum + item.identityFieldTotal, 0);
  const identityFieldPassed = cardScores.reduce((sum, item) => sum + item.identityFieldPassed, 0);
  const combinedPassed = identityExactPassed + serialNumberPassed + serialRunPassed;
  const combinedTotal = identityExactTotal + serialNumberTotal + serialRunTotal;
  const imageSummary = imageStats(manifestPath, manifest.cards);
  const missingResultIds = cardScores
    .filter((item) => !item.hasResult)
    .map((item) => item.trialCardId);
  const failures = cardScores
    .filter((item) => item.mismatches.length > 0 || item.consensusReviewRequired || !item.hasResult)
    .map((item) => ({
      trialCardId: item.trialCardId,
      hasResult: item.hasResult,
      consensusReviewRequired: item.consensusReviewRequired,
      consensusReviewReasons: item.consensusReviewReasons,
      mismatches: item.mismatches,
    }));

  const report = {
    schema: "tcos.instacompTrialReport.v1",
    generatedAt: new Date().toISOString(),
    trialName: manifest.trialName || "InstaComp trial",
    sideEffectBoundary:
      "Read-only scoring report. Does not publish listings, buy postage, create Checkout, deploy, or call production APIs.",
    target: {
      targetCards: manifest.targetCards ?? DEFAULT_TARGET_CARDS,
      targetScans:
        manifest.targetScans ??
        (manifest.targetCards ? Number(manifest.targetCards) * 2 : DEFAULT_TARGET_CARDS * 2),
      targetAccuracyPercent,
    },
    observed: {
      cards: manifest.cards.length,
      ...imageSummary,
      results: results.cards.length,
      missingResultIds,
      consensusReviewIds,
    },
    accuracy: {
      identityExact: {
        passed: identityExactPassed,
        total: identityExactTotal,
        percent: percent(identityExactPassed, identityExactTotal),
      },
      identityFields: {
        passed: identityFieldPassed,
        total: identityFieldTotal,
        percent: percent(identityFieldPassed, identityFieldTotal),
      },
      serialNumberExact: {
        passed: serialNumberPassed,
        total: serialNumberTotal,
        percent: percent(serialNumberPassed, serialNumberTotal),
      },
      serialRunExact: {
        passed: serialRunPassed,
        total: serialRunTotal,
        percent: percent(serialRunPassed, serialRunTotal),
      },
      combinedIdentityAndSerial: {
        passed: combinedPassed,
        total: combinedTotal,
        percent: percent(combinedPassed, combinedTotal),
      },
    },
    targetMet: false,
    warnings: [],
    failures,
  };

  const combinedPercent = report.accuracy.combinedIdentityAndSerial.percent;
  const identityPercent = report.accuracy.identityExact.percent;
  const serialPercent = report.accuracy.serialNumberExact.percent;
  report.targetMet =
    combinedPercent !== null &&
    combinedPercent >= targetAccuracyPercent &&
    (identityPercent === null || identityPercent >= targetAccuracyPercent) &&
    (serialPercent === null || serialPercent >= targetAccuracyPercent) &&
    missingResultIds.length === 0 &&
    consensusReviewIds.length === 0;

  if (manifest.cards.length < report.target.targetCards) {
    report.warnings.push(
      `Manifest has ${manifest.cards.length} card(s), below target ${report.target.targetCards}.`
    );
  }
  if (imageSummary.declaredScanCount < report.target.targetScans) {
    report.warnings.push(
      `Manifest declares ${imageSummary.declaredScanCount} scan image(s), below target ${report.target.targetScans}.`
    );
  }
  if (imageSummary.missingImages.length > 0) {
    report.warnings.push(`${imageSummary.missingImages.length} declared image path(s) do not exist locally.`);
  }
  if (missingResultIds.length > 0) {
    report.warnings.push(`${missingResultIds.length} card(s) are missing trial results.`);
  }
  if (consensusReviewIds.length > 0) {
    report.warnings.push(
      `${consensusReviewIds.length} card(s) still require multi-scanner consensus review.`
    );
  }

  return report;
}

function issueTypeForFailure(failure) {
  if (!failure.hasResult) return "missing_result";
  if (failure.consensusReviewRequired && failure.mismatches.length > 0) {
    return "consensus_review_and_field_mismatch";
  }
  if (failure.consensusReviewRequired) return "consensus_review_required";
  return "field_mismatch";
}

function suggestedActionForFailure(failure) {
  if (!failure.hasResult) {
    return "Re-run or re-export this trial card so the results file includes the row.";
  }
  if (failure.consensusReviewRequired) {
    return "Resolve the multi-scanner consensus review with checklist/catalog evidence or operator correction, then re-export trial results.";
  }

  return "Correct the scanner identity or ground-truth manifest field, then rerun the trial report.";
}

function buildFailureReport(report) {
  const failures = report.failures.map((failure) => ({
    ...failure,
    issueType: issueTypeForFailure(failure),
    suggestedAction: suggestedActionForFailure(failure),
    mismatchFields: failure.mismatches.map((item) => item.field),
  }));

  return {
    schema: "tcos.instacompTrialFailureReport.v1",
    generatedAt: new Date().toISOString(),
    sourceReportSchema: report.schema,
    trialName: report.trialName,
    targetMet: report.targetMet,
    sideEffectBoundary:
      "Read-only failure report. Does not publish listings, buy postage, create Checkout, deploy, or call production APIs.",
    summary: {
      targetAccuracyPercent: report.target.targetAccuracyPercent,
      totalFailures: failures.length,
      missingResults: failures.filter((failure) => failure.issueType === "missing_result").length,
      consensusReviewRequired: failures.filter((failure) => failure.consensusReviewRequired).length,
      fieldMismatchCards: failures.filter((failure) => failure.mismatches.length > 0).length,
      combinedIdentityAndSerialPercent:
        report.accuracy.combinedIdentityAndSerial.percent,
      identityExactPercent: report.accuracy.identityExact.percent,
      serialNumberExactPercent: report.accuracy.serialNumberExact.percent,
    },
    warnings: report.warnings,
    observed: {
      missingResultIds: report.observed.missingResultIds,
      consensusReviewIds: report.observed.consensusReviewIds,
      missingImages: report.observed.missingImages,
    },
    failures,
    next:
      failures.length > 0
        ? "Fix these rows, re-export instacomp-trial-results.local.json from /admin/instacomp, then rerun npm run instacomp:trial:report with this failure report path."
        : "No failure rows were found; if targetMet is true, archive this passing trial evidence before calling the tester done-done.",
  };
}

async function writeFailureReport(filePath, report) {
  if (!filePath) return null;

  const resolved = path.resolve(filePath);
  const payload = buildFailureReport(report);

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`);

  return {
    path: resolved,
    failureCount: payload.summary.totalFailures,
    consensusReviewRequired: payload.summary.consensusReviewRequired,
  };
}

function printTextReport(report) {
  console.log(`InstaComp trial report: ${report.trialName}`);
  console.log(`Cards: ${report.observed.cards}/${report.target.targetCards}`);
  console.log(`Declared scans: ${report.observed.declaredScanCount}/${report.target.targetScans}`);
  console.log(`Front/back pairs: ${report.observed.declaredFrontBackPairs}`);
  console.log(`Results: ${report.observed.results}`);
  console.log(`Target accuracy: ${report.target.targetAccuracyPercent}%`);
  console.log("");
  console.log(
    `Identity exact: ${report.accuracy.identityExact.passed}/${report.accuracy.identityExact.total} (${report.accuracy.identityExact.percent ?? "n/a"}%)`
  );
  console.log(
    `Identity field accuracy: ${report.accuracy.identityFields.passed}/${report.accuracy.identityFields.total} (${report.accuracy.identityFields.percent ?? "n/a"}%)`
  );
  console.log(
    `Serial number exact: ${report.accuracy.serialNumberExact.passed}/${report.accuracy.serialNumberExact.total} (${report.accuracy.serialNumberExact.percent ?? "n/a"}%)`
  );
  console.log(
    `Serial run exact: ${report.accuracy.serialRunExact.passed}/${report.accuracy.serialRunExact.total} (${report.accuracy.serialRunExact.percent ?? "n/a"}%)`
  );
  console.log(
    `Combined identity + serial: ${report.accuracy.combinedIdentityAndSerial.passed}/${report.accuracy.combinedIdentityAndSerial.total} (${report.accuracy.combinedIdentityAndSerial.percent ?? "n/a"}%)`
  );
  console.log("");
  console.log(report.targetMet ? "PASS target met" : "FAIL target not met");

  if (report.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }

  if (report.failures.length > 0) {
    console.log("");
    console.log("Mismatches:");
    for (const failure of report.failures.slice(0, 25)) {
      if (!failure.hasResult) {
        console.log(`- ${failure.trialCardId}: missing result`);
        continue;
      }
      if (failure.consensusReviewRequired) {
        const reasons = failure.consensusReviewReasons.length
          ? failure.consensusReviewReasons.join(", ")
          : "no detailed reason supplied";
        console.log(`- ${failure.trialCardId}: consensus review required (${reasons})`);
      }
      if (failure.mismatches.length === 0) continue;
      const details = failure.mismatches
        .map((item) => `${item.field} expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}`)
        .join("; ");
      console.log(`- ${failure.trialCardId}: ${details}`);
    }
    if (report.failures.length > 25) {
      console.log(`- ... ${report.failures.length - 25} more failure(s) omitted from text output`);
    }
  }
}

if (await writeManifestTemplate()) {
  // Template mode already handled the command.
} else if (await auditTrialImages()) {
  // Image-audit mode already handled the command.
} else {
  try {
    const targetAccuracyPercent = Number.parseFloat(
      getFlagValue("--target", String(DEFAULT_TARGET_ACCURACY))
    );
    const manifestInput = getFlagValue("--manifest");
    const resultsInput = getFlagValue("--results");

    if (!manifestInput || !resultsInput) {
      console.error(usage());
      process.exitCode = 1;
    } else {
      const { resolved: manifestPath, data: manifest } = await readJsonFile(
        manifestInput,
        "manifest"
      );
      const { data: results } = await readJsonFile(resultsInput, "results");
      validateManifestShape(manifest);
      validateResultsShape(results);

      const report = summarizeScores(
        manifest,
        manifestPath,
        results,
        Number.isFinite(targetAccuracyPercent) ? targetAccuracyPercent : DEFAULT_TARGET_ACCURACY
      );
      const failureReportInput =
        getFlagValue("--write-failure-report") || getFlagValue("--failure-report");

      if (hasFlag("--require-files") && report.observed.missingImages.length > 0) {
        report.targetMet = false;
      }

      const failureReportResult = await writeFailureReport(failureReportInput, report);

      if (hasFlag("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printTextReport(report);
        if (failureReportResult) {
          console.log("");
          console.log("Failure report:");
          console.log(`- path: ${failureReportResult.path}`);
          console.log(`- failure rows: ${failureReportResult.failureCount}`);
          console.log(
            `- consensus review rows: ${failureReportResult.consensusReviewRequired}`
          );
        }
      }

      if (!report.targetMet) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
