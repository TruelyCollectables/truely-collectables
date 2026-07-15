import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TARGET_CARDS = 100;
const DEFAULT_TARGET_ACCURACY = 94;

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
    "  --json            print machine-readable JSON only",
    "  --require-files   fail when manifest image paths do not exist locally",
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
  const identityFieldTotal = cardScores.reduce((sum, item) => sum + item.identityFieldTotal, 0);
  const identityFieldPassed = cardScores.reduce((sum, item) => sum + item.identityFieldPassed, 0);
  const combinedPassed = identityExactPassed + serialNumberPassed + serialRunPassed;
  const combinedTotal = identityExactTotal + serialNumberTotal + serialRunTotal;
  const imageSummary = imageStats(manifestPath, manifest.cards);
  const missingResultIds = cardScores
    .filter((item) => !item.hasResult)
    .map((item) => item.trialCardId);
  const failures = cardScores
    .filter((item) => item.mismatches.length > 0 || !item.hasResult)
    .map((item) => ({
      trialCardId: item.trialCardId,
      hasResult: item.hasResult,
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
    missingResultIds.length === 0;

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

  return report;
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

      if (hasFlag("--require-files") && report.observed.missingImages.length > 0) {
        report.targetMet = false;
      }

      if (hasFlag("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printTextReport(report);
      }

      if (!report.targetMet) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
