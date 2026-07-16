import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TARGET_CARDS = 100;
const DEFAULT_TARGET_ACCURACY = 94;
const DEFAULT_TARGET_AVERAGE_SECONDS_PER_CARD = 15;
const DEFAULT_TARGET_P95_SECONDS_PER_CARD = 45;
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
const manifestCoreFields = ["player", "year", "setName", "cardNumber"];
const manifestRecommendedFields = ["brand", "parallel", "team", "sport"];
const groundTruthSheetColumns = [
  "trialCardId",
  "frontImage",
  "backImage",
  "player",
  "year",
  "setName",
  "cardNumber",
  "brand",
  "parallel",
  "variation",
  "serialNumber",
  "serialRun",
  "team",
  "sport",
  "isRookie",
  "isAuto",
  "isRelic",
  "notes",
];
const groundTruthExpectedFields = [
  "player",
  "year",
  "setName",
  "cardNumber",
  "brand",
  "parallel",
  "variation",
  "serialNumber",
  "serialRun",
  "team",
  "sport",
  "isRookie",
  "isAuto",
  "isRelic",
];
const groundTruthBooleanFields = new Set(["isRookie", "isAuto", "isRelic"]);

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

function readPositiveSecondsFlag(name, fallback = null) {
  const value = getFlagValue(name);
  if (value === null || value === undefined) return fallback;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
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
    "Audit the local ground-truth manifest before scanning/scoring:",
    "  node scripts/run-instacomp-trial-report.mjs --manifest instacomp-trial-manifest.local.json --audit-manifest --expected-cards 100",
    "",
    "Write/apply a local spreadsheet-style ground-truth worksheet:",
    "  node scripts/run-instacomp-trial-report.mjs --manifest instacomp-trial-manifest.local.json --write-groundtruth-sheet instacomp-trial-groundtruth.local.tsv",
    "  node scripts/run-instacomp-trial-report.mjs --manifest instacomp-trial-manifest.local.json --apply-groundtruth-sheet instacomp-trial-groundtruth.local.tsv",
    "",
    "Useful flags:",
    "  --target <percent>",
    "                   required accuracy percentage, defaults to 94",
    "  --target-average-seconds-per-card <seconds>",
    `                   optional speed gate for average completed-card scan time; final tester target is ${DEFAULT_TARGET_AVERAGE_SECONDS_PER_CARD}`,
    "  --target-p95-seconds-per-card <seconds>",
    `                   optional speed gate for p95 completed-card scan time; final tester target is ${DEFAULT_TARGET_P95_SECONDS_PER_CARD}`,
    "  --require-timing",
    "                   fail when the results export has no completed-card timing evidence",
    "  --audit-images <dir>",
    "                   audit a local front/back trial image folder before scanning",
    "  --audit-manifest",
    "                   audit expected player/year/set/card-number ground truth before scanning or scoring",
    "  --write-groundtruth-sheet <path>",
    "                   write a local TSV answer-key worksheet from the manifest",
    "  --apply-groundtruth-sheet <path>",
    "                   apply an edited local TSV answer-key worksheet back to the manifest",
    "  --write-manifest <path>",
    "                   with --apply-groundtruth-sheet, write the updated manifest to a different path",
    "  --expected-cards <count>",
    "                   expected card count for --audit-images when manifest target is absent",
    "  --write-image-map <path>",
    "                   write a local JSON front/back mapping receipt during --audit-images",
    "  --write-intake-packet <path>",
    "                   write a local Markdown operator packet with counts, pairing preview, problems, and next commands",
    "  --allow-not-ready",
    "                   with --audit-images, write/print the packet without returning a failing exit code when images are incomplete",
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

function readCatalogEvidence(result) {
  return (
    result?.catalogEvidence ||
    result?.result?.catalogEvidence ||
    result?.predicted?.catalogEvidence ||
    result?.ai?.catalogEvidence ||
    null
  );
}

function readOperatorReview(result) {
  return (
    result?.operatorReview ||
    result?.result?.operatorReview ||
    result?.predicted?.operatorReview ||
    result?.ai?.operatorReview ||
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

function readExpectedFields(card) {
  return card?.expected || {};
}

function tsvCell(value) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value ?? "")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function groundTruthSheetRow(card) {
  const expected = readExpectedFields(card);

  return {
    trialCardId: card.trialCardId || "",
    frontImage: card.frontImage || "",
    backImage: card.backImage || "",
    player: expected.player || "",
    year: expected.year || "",
    setName: expected.setName || "",
    cardNumber: expected.cardNumber || "",
    brand: expected.brand || "",
    parallel: expected.parallel || "",
    variation: expected.variation || "",
    serialNumber: expected.serialNumber || "",
    serialRun: expected.serialRun || "",
    team: expected.team || "",
    sport: expected.sport || "",
    isRookie: Boolean(expected.isRookie),
    isAuto: Boolean(expected.isAuto),
    isRelic: Boolean(expected.isRelic),
    notes: card.notes || "",
  };
}

function buildGroundTruthSheetText(manifest) {
  const rows = [
    groundTruthSheetColumns.join("\t"),
    ...manifest.cards.map((card) => {
      const row = groundTruthSheetRow(card);
      return groundTruthSheetColumns.map((column) => tsvCell(row[column])).join("\t");
    }),
  ];

  return `${rows.join("\n")}\n`;
}

function parseBooleanSheetCell(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "yes", "y", "1", "x"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return fallback;
}

function parseGroundTruthSheet(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("Ground-truth sheet is empty.");

  const headers = lines[0].split("\t").map((header) => header.trim());
  const missingRequiredHeaders = ["trialCardId", ...groundTruthExpectedFields].filter(
    (field) => !headers.includes(field),
  );
  if (missingRequiredHeaders.length > 0) {
    throw new Error(
      `Ground-truth sheet is missing required column(s): ${missingRequiredHeaders.join(", ")}`,
    );
  }

  return lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    const row = { rowNumber: index + 2 };
    for (const [headerIndex, header] of headers.entries()) {
      row[header] = cells[headerIndex] ?? "";
    }
    return row;
  });
}

function applyGroundTruthRowsToManifest(manifest, rows) {
  validateManifestShape(manifest);
  const rowsById = new Map();
  const duplicateTrialCardIds = [];

  for (const row of rows) {
    const trialCardId = String(row.trialCardId || "").trim();
    if (!trialCardId) continue;
    if (rowsById.has(trialCardId)) {
      duplicateTrialCardIds.push({
        trialCardId,
        firstRow: rowsById.get(trialCardId).rowNumber,
        duplicateRow: row.rowNumber,
      });
      continue;
    }
    rowsById.set(trialCardId, row);
  }

  const missingRows = [];
  let updatedRows = 0;
  let changedFields = 0;
  const cards = manifest.cards.map((card, index) => {
    const trialCardId = String(card.trialCardId || `trial-card-${padTrialNumber(index + 1)}`);
    const row = rowsById.get(trialCardId);
    if (!row) {
      missingRows.push(trialCardId);
      return card;
    }

    const nextExpected = {
      ...(card.expected || {}),
    };

    for (const field of groundTruthExpectedFields) {
      const previous = nextExpected[field];
      const nextValue = groundTruthBooleanFields.has(field)
        ? parseBooleanSheetCell(row[field], Boolean(previous))
        : String(row[field] ?? "").trim();
      if (previous !== nextValue) {
        nextExpected[field] = nextValue;
        changedFields += 1;
      }
    }

    const nextNotes = String(row.notes ?? "").trim();
    const notesChanged = (card.notes || "") !== nextNotes;
    if (notesChanged) changedFields += 1;
    updatedRows += 1;

    return {
      ...card,
      expected: nextExpected,
      notes: nextNotes,
    };
  });

  const manifestTrialCardIds = new Set(
    manifest.cards.map((card, index) =>
      String(card.trialCardId || `trial-card-${padTrialNumber(index + 1)}`),
    ),
  );
  const extraRows = [...rowsById.keys()].filter((trialCardId) => !manifestTrialCardIds.has(trialCardId));

  return {
    updatedManifest: {
      ...manifest,
      cards,
    },
    report: {
      schema: "tcos.instacompTrialGroundTruthSheetApply.v1",
      generatedAt: new Date().toISOString(),
      sideEffectBoundary:
        "Local manifest update only. Does not publish listings, buy postage, create Checkout, deploy, scan cards, call production APIs, approve live money, or mutate images.",
      observed: {
        sheetRows: rows.length,
        manifestRows: manifest.cards.length,
        updatedRows,
        changedFields,
      },
      problems: {
        duplicateTrialCardIds,
        missingRows,
        extraRows,
      },
      ok:
        duplicateTrialCardIds.length === 0 &&
        missingRows.length === 0 &&
        extraRows.length === 0,
    },
  };
}

async function writeGroundTruthSheet() {
  const output = getFlagValue("--write-groundtruth-sheet");
  if (!output) return false;

  const manifestInput = getFlagValue("--manifest");
  if (!manifestInput) {
    console.error("Missing --manifest path for --write-groundtruth-sheet.\n\n" + usage());
    process.exitCode = 1;
    return true;
  }

  try {
    const { resolved: manifestPath, data: manifest } = await readJsonFile(
      manifestInput,
      "manifest",
    );
    validateManifestShape(manifest);
    const resolvedOutput = path.resolve(output);
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, buildGroundTruthSheetText(manifest));

    const report = {
      schema: "tcos.instacompTrialGroundTruthSheet.v1",
      generatedAt: new Date().toISOString(),
      sideEffectBoundary:
        "Local worksheet export only. Does not publish listings, buy postage, create Checkout, deploy, scan cards, call production APIs, approve live money, mutate manifest data, or mutate images.",
      manifestPath,
      sheetPath: resolvedOutput,
      columns: groundTruthSheetColumns,
      rows: manifest.cards.length,
      next:
        "Open the TSV in a spreadsheet, fill player/year/setName/cardNumber plus recommended fields, save it, then run npm run instacomp:trial:groundtruth:apply.",
    };

    if (hasFlag("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("InstaComp trial ground-truth worksheet written:");
      console.log(`- sheet: ${report.sheetPath}`);
      console.log(`- manifest: ${report.manifestPath}`);
      console.log(`- rows: ${report.rows}`);
      console.log(`- columns: ${report.columns.join(", ")}`);
      console.log(`Next: ${report.next}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }

  return true;
}

async function applyGroundTruthSheet() {
  const sheetInput = getFlagValue("--apply-groundtruth-sheet");
  if (!sheetInput) return false;

  const manifestInput = getFlagValue("--manifest");
  if (!manifestInput) {
    console.error("Missing --manifest path for --apply-groundtruth-sheet.\n\n" + usage());
    process.exitCode = 1;
    return true;
  }

  try {
    const { resolved: manifestPath, data: manifest } = await readJsonFile(
      manifestInput,
      "manifest",
    );
    const resolvedSheetPath = path.resolve(sheetInput);
    const sheetText = await readFile(resolvedSheetPath, "utf8");
    const rows = parseGroundTruthSheet(sheetText);
    const { updatedManifest, report } = applyGroundTruthRowsToManifest(manifest, rows);
    const manifestOutput = path.resolve(getFlagValue("--write-manifest", manifestPath));

    await mkdir(path.dirname(manifestOutput), { recursive: true });
    await writeFile(manifestOutput, `${JSON.stringify(updatedManifest, null, 2)}\n`);
    report.manifestPath = manifestPath;
    report.sheetPath = resolvedSheetPath;
    report.writtenManifestPath = manifestOutput;
    report.next = report.ok
      ? "Run npm run instacomp:trial:groundtruth to audit the updated manifest."
      : "Fix duplicate, missing, or extra trialCardId rows in the worksheet, then re-apply it.";

    if (hasFlag("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("InstaComp trial ground-truth worksheet applied:");
      console.log(`- sheet: ${report.sheetPath}`);
      console.log(`- written manifest: ${report.writtenManifestPath}`);
      console.log(`- updated rows: ${report.observed.updatedRows}/${report.observed.manifestRows}`);
      console.log(`- changed fields: ${report.observed.changedFields}`);
      console.log(`- duplicate trialCardIds: ${report.problems.duplicateTrialCardIds.length}`);
      console.log(`- missing manifest rows in sheet: ${report.problems.missingRows.length}`);
      console.log(`- extra sheet rows: ${report.problems.extraRows.length}`);
      console.log(`Next: ${report.next}`);
    }

    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }

  return true;
}

function countKnownFields(expected, fields) {
  return fields.filter((field) => isKnown(expected[field])).length;
}

function auditManifestGroundTruth(manifest, manifestPath, expectedCards) {
  validateManifestShape(manifest);

  const trialCardIds = new Map();
  const duplicateTrialCardIds = [];
  const missingTrialCardIds = [];
  const missingCoreFields = [];
  const recommendedFieldWarnings = [];
  const serialWarnings = [];
  const cards = manifest.cards.map((card, index) => {
    const ordinal = padTrialNumber(index + 1);
    const trialCardId = isKnown(card.trialCardId)
      ? String(card.trialCardId)
      : `trial-card-${ordinal}`;
    const expected = readExpectedFields(card);
    const missingCore = manifestCoreFields.filter((field) => !isKnown(expected[field]));
    const missingRecommended = manifestRecommendedFields.filter(
      (field) => !isKnown(expected[field]),
    );
    const identityKnown = countKnownFields(expected, identityFields);
    const serialKnown = countKnownFields(expected, ["serialNumber", "serialRun"]);

    if (!isKnown(card.trialCardId)) {
      missingTrialCardIds.push({ row: index + 1, fallbackTrialCardId: trialCardId });
    }

    if (trialCardIds.has(trialCardId)) {
      duplicateTrialCardIds.push({
        trialCardId,
        firstRow: trialCardIds.get(trialCardId),
        duplicateRow: index + 1,
      });
    } else {
      trialCardIds.set(trialCardId, index + 1);
    }

    if (missingCore.length > 0) {
      missingCoreFields.push({
        trialCardId,
        row: index + 1,
        missing: missingCore,
      });
    }

    if (missingRecommended.length > 0) {
      recommendedFieldWarnings.push({
        trialCardId,
        row: index + 1,
        missing: missingRecommended,
      });
    }

    if (isKnown(expected.serialNumber) && !isKnown(expected.serialRun)) {
      serialWarnings.push({
        trialCardId,
        row: index + 1,
        warning: "serialNumber is filled but serialRun is blank",
      });
    }

    return {
      trialCardId,
      row: index + 1,
      coreFieldsKnown: manifestCoreFields.length - missingCore.length,
      coreFieldsTotal: manifestCoreFields.length,
      missingCoreFields: missingCore,
      identityFieldsKnown: identityKnown,
      serialFieldsKnown: serialKnown,
      readyForScore: missingCore.length === 0,
    };
  });

  const shortManifestRows = Math.max(0, expectedCards - manifest.cards.length);
  const readyRows = cards.filter((card) => card.readyForScore).length;
  const readyToScore =
    manifest.cards.length >= expectedCards &&
    shortManifestRows === 0 &&
    missingTrialCardIds.length === 0 &&
    duplicateTrialCardIds.length === 0 &&
    missingCoreFields.length === 0;

  return {
    schema: "tcos.instacompTrialManifestAudit.v1",
    generatedAt: new Date().toISOString(),
    sideEffectBoundary:
      "Read-only ground-truth manifest audit. Does not publish listings, buy postage, create Checkout, deploy, scan cards, call production APIs, approve live money, or mutate trial images.",
    manifestPath,
    expected: {
      cards: expectedCards,
      coreFields: manifestCoreFields,
      recommendedFields: manifestRecommendedFields,
    },
    observed: {
      cards: manifest.cards.length,
      readyRows,
      missingCoreRows: missingCoreFields.length,
      duplicateTrialCardIds: duplicateTrialCardIds.length,
      missingTrialCardIds: missingTrialCardIds.length,
      shortManifestRows,
    },
    readyToScore,
    cards: cards.slice(0, 25),
    problems: {
      missingCoreFields,
      duplicateTrialCardIds,
      missingTrialCardIds,
      shortManifestRows,
    },
    warnings: {
      recommendedFieldWarnings,
      serialWarnings,
    },
    next: readyToScore
      ? "Ground-truth manifest is ready. Run npm run instacomp:trial:ready, scan the lot in /admin/instacomp, export results, then run npm run instacomp:trial:score."
      : "Fill the missing player/year/set/card-number ground-truth fields and fix duplicate or missing trialCardId rows before scanning or scoring.",
  };
}

function printManifestAudit(report) {
  console.log("InstaComp trial ground-truth manifest audit:");
  console.log(`Cards expected: ${report.expected.cards}`);
  console.log(`Manifest rows: ${report.observed.cards}`);
  console.log(`Core-ready rows: ${report.observed.readyRows}/${report.observed.cards}`);
  console.log(`Core fields: ${report.expected.coreFields.join(", ")}`);
  console.log(`Ready to score: ${report.readyToScore ? "yes" : "no"}`);
  if (report.manifestPath) console.log(`Manifest: ${report.manifestPath}`);

  const problemLines = [
    ["missing core fields", report.problems.missingCoreFields],
    ["duplicate trialCardId rows", report.problems.duplicateTrialCardIds],
    ["missing trialCardId rows", report.problems.missingTrialCardIds],
  ];

  if (
    report.problems.shortManifestRows > 0 ||
    problemLines.some(([, rows]) => rows.length > 0)
  ) {
    console.log("");
    console.log("Problems:");
    if (report.problems.shortManifestRows > 0) {
      console.log(`- short manifest rows: ${report.problems.shortManifestRows}`);
    }
    for (const [label, rows] of problemLines) {
      if (rows.length === 0) continue;
      console.log(`- ${label}: ${rows.length}`);
      for (const row of rows.slice(0, 10)) {
        console.log(`  - ${typeof row === "string" ? row : JSON.stringify(row)}`);
      }
      if (rows.length > 10) console.log(`  - ... ${rows.length - 10} more`);
    }
  }

  if (
    report.warnings.recommendedFieldWarnings.length > 0 ||
    report.warnings.serialWarnings.length > 0
  ) {
    console.log("");
    console.log("Warnings:");
    if (report.warnings.recommendedFieldWarnings.length > 0) {
      console.log(
        `- recommended fields missing on ${report.warnings.recommendedFieldWarnings.length} row(s)`,
      );
    }
    for (const warning of report.warnings.serialWarnings.slice(0, 10)) {
      console.log(`- ${warning.trialCardId}: ${warning.warning}`);
    }
  }

  console.log("");
  console.log(`Next: ${report.next}`);
}

async function auditTrialManifest() {
  if (!hasFlag("--audit-manifest")) return false;

  const manifestInput = getFlagValue("--manifest");
  const expectedCardsValue = Number.parseInt(
    getFlagValue("--expected-cards", String(DEFAULT_TARGET_CARDS)),
    10,
  );
  const expectedCards =
    Number.isFinite(expectedCardsValue) && expectedCardsValue > 0
      ? expectedCardsValue
      : DEFAULT_TARGET_CARDS;

  if (!manifestInput) {
    console.error("Missing --manifest path for --audit-manifest.\n\n" + usage());
    process.exitCode = 1;
    return true;
  }

  try {
    const { resolved: manifestPath, data: manifest } = await readJsonFile(
      manifestInput,
      "manifest",
    );
    const report = auditManifestGroundTruth(manifest, manifestPath, expectedCards);

    if (hasFlag("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printManifestAudit(report);
    }

    if (!report.readyToScore) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }

  return true;
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

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function buildProblemPreviewRows(report) {
  const rows = [];
  const problemGroups = [
    ["Missing front", report.problems.missingFronts],
    ["Missing back", report.problems.missingBacks],
    ["Duplicate front", report.problems.duplicateFronts],
    ["Duplicate back", report.problems.duplicateBacks],
    ["Unknown image", report.problems.unknownFiles],
    ["Extra image", report.problems.extraFiles],
    ["Unpaired ordered image", report.problems.unpairedOrderedFiles],
  ];

  for (const [label, items] of problemGroups) {
    for (const item of items.slice(0, 12)) {
      rows.push({
        type: label,
        detail: typeof item === "string" ? item : JSON.stringify(item),
      });
    }
  }

  return rows;
}

function buildTrialIntakePacketMarkdown(report, imageMapRows) {
  const problemRows = buildProblemPreviewRows(report);
  const mapRows = imageMapRows.slice(0, 25);
  const readyLabel = report.readyToScan ? "YES - ready to upload/scan" : "NO - fix image intake first";

  return [
    "# TCOS InstaComp Trial Intake Packet",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Safe boundary: local read-only trial intake packet. It does not publish listings, buy postage, create Checkout, deploy, scan cards, call production APIs, approve live money, or change runtime switches.",
    "",
    "## Status",
    "",
    `- Ready to scan: ${readyLabel}`,
    `- Manifest: ${report.manifestPath || "not provided"}`,
    `- Image folder: ${report.imageDir}`,
    `- Expected cards: ${report.expected.cards}`,
    `- Expected images: ${report.expected.images}`,
    `- Parsed image files: ${report.observed.parsedImageFiles}`,
    `- Complete front/back pairs: ${report.observed.completePairs}`,
    `- Ordered-pair candidate files: ${report.observed.orderedPairCandidateFiles}`,
    `- Ordered-pair complete pairs: ${report.observed.orderedPairCompletePairs}`,
    report.imageMap?.writtenPath ? `- Image map receipt: ${report.imageMap.writtenPath}` : "- Image map receipt: not written",
    "",
    "## Accepted file patterns",
    "",
    "- Ordered scanner files are paired as `1+2`, `3+4`, `5+6`, etc. Example: `scan_0001.jpg` is card 001 front and `scan_0002.jpg` is card 001 back.",
    "- Explicit side filenames can use `front`, `fr`, `f`, `obverse` and `back`, `bk`, `b`, `reverse`, `rear`. Example: `001-front.jpg` + `001-back.jpg`.",
    "",
    "## Pairing preview",
    "",
    "| Trial card | Front image | Front source | Back image | Back source |",
    "| --- | --- | --- | --- | --- |",
    ...mapRows.map((row) =>
      [
        markdownCell(row.trialCardId),
        markdownCell(row.frontImage || "MISSING"),
        markdownCell(row.frontSource || "-"),
        markdownCell(row.backImage || "MISSING"),
        markdownCell(row.backSource || "-"),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    ),
    mapRows.length < imageMapRows.length
      ? `\nShowing first ${mapRows.length} of ${imageMapRows.length} rows. Use the JSON image map for the full receipt.`
      : "",
    "",
    "## Problems",
    "",
    `- Missing fronts: ${report.problems.missingFronts.length}`,
    `- Missing backs: ${report.problems.missingBacks.length}`,
    `- Duplicate fronts: ${report.problems.duplicateFronts.length}`,
    `- Duplicate backs: ${report.problems.duplicateBacks.length}`,
    `- Unknown image files: ${report.problems.unknownFiles.length}`,
    `- Extra image files: ${report.problems.extraFiles.length}`,
    `- Unpaired ordered image files: ${report.problems.unpairedOrderedFiles.length}`,
    "",
    ...(problemRows.length
      ? [
          "| Type | Detail |",
          "| --- | --- |",
          ...problemRows.map((row) => `| ${markdownCell(row.type)} | ${markdownCell(row.detail)} |`),
          "",
        ]
      : ["No intake problems detected.", ""]),
    report.warnings.length ? "## Warnings" : "",
    ...report.warnings.map((warning) => `- ${warning}`),
    report.warnings.length ? "" : "",
    "## Next commands",
    "",
    "```bash",
    "npm run instacomp:trial:ready",
    "npm run status:instacomp-final-tester",
    "# after scanning/exporting results:",
    "npm run instacomp:trial:score",
    "npm run instacomp:trial:failures",
    "```",
    "",
    `Next: ${report.next}`,
    "",
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === "" && lines[index + 1] === ""))
    .join("\n");
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
  const imageMapInput = getFlagValue("--write-image-map") || getFlagValue("--image-map");
  const intakePacketInput = getFlagValue("--write-intake-packet");
  const allowNotReady = hasFlag("--allow-not-ready");
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
  const imageMapRows = [];
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

    imageMapRows.push({
      trialCardId: row.trialCardId,
      ordinal: row.ordinal,
      frontImage: group.front[0] || orderedFront || null,
      frontSource: group.front[0] ? "explicit_filename" : orderedFront ? "ordered_pair" : null,
      backImage: group.back[0] || orderedBack || null,
      backSource: group.back[0] ? "explicit_filename" : orderedBack ? "ordered_pair" : null,
      frontCandidates: [...group.front, orderedFront].filter(Boolean),
      backCandidates: [...group.back, orderedBack].filter(Boolean),
    });

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
    imageMap: {
      rowCount: imageMapRows.length,
      previewRows: imageMapRows.slice(0, 10),
      writtenPath: null,
    },
    intakePacket: {
      writtenPath: null,
    },
    orderedPairAssignments: orderedPairAssignments.slice(0, 25),
    warnings,
    next: ready
      ? "Run npm run instacomp:trial:groundtruth, then run the lot through /admin/instacomp, export trial results, and score with npm run instacomp:trial:score."
      : "Fix the missing, duplicate, unknown, or extra image files before scanning the 100-card lot.",
  };

  if (imageMapInput) {
    const resolvedImageMapPath = path.resolve(imageMapInput);
    const imageMapPayload = {
      schema: "tcos.instacompTrialImageMap.v1",
      generatedAt: report.generatedAt,
      sourceAuditSchema: report.schema,
      sideEffectBoundary:
        "Read-only image map. Does not publish listings, buy postage, create Checkout, deploy, scan cards, or call production APIs.",
      manifestPath,
      imageDir: resolvedImageDir,
      readyToScan: report.readyToScan,
      expected: report.expected,
      observed: report.observed,
      problems: report.problems,
      rows: imageMapRows,
      next: report.next,
    };

    await mkdir(path.dirname(resolvedImageMapPath), { recursive: true });
    await writeFile(resolvedImageMapPath, `${JSON.stringify(imageMapPayload, null, 2)}\n`);
    report.imageMap.writtenPath = resolvedImageMapPath;
  }

  if (intakePacketInput) {
    const resolvedIntakePacketPath = path.resolve(intakePacketInput);
    const intakePacketMarkdown = buildTrialIntakePacketMarkdown(report, imageMapRows);

    await mkdir(path.dirname(resolvedIntakePacketPath), { recursive: true });
    await writeFile(resolvedIntakePacketPath, `${intakePacketMarkdown}\n`);
    report.intakePacket.writtenPath = resolvedIntakePacketPath;
  }

  if (hasFlag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printImageAudit(report);
  }

  if (!report.readyToScan && !allowNotReady) process.exitCode = 1;
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
  if (report.imageMap?.writtenPath) {
    console.log(`Image map written: ${report.imageMap.writtenPath}`);
  }
  if (report.intakePacket?.writtenPath) {
    console.log(`Intake packet written: ${report.intakePacket.writtenPath}`);
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
  const catalogEvidence = readCatalogEvidence(result);
  const operatorReview = readOperatorReview(result);
  const consensusReviewRequired = consensus?.status === "review_required";
  const catalogConfirmed =
    catalogEvidence?.catalogConfirmed === true ||
    catalogEvidence?.status === "catalog_confirmed";
  const catalogReviewRequired = catalogEvidence?.status === "review_required";
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
    hasCatalogEvidence: Boolean(catalogEvidence),
    hasOperatorReview: Boolean(operatorReview),
    operatorMarkedWrong: operatorReview?.markedWrong === true,
    operatorMarkedCorrect:
      operatorReview?.markedCorrect === true ||
      (Boolean(operatorReview) && operatorReview?.markedWrong !== true),
    catalogConfirmed,
    catalogReviewRequired,
    catalogReviewReasons: Array.isArray(catalogEvidence?.reviewReasons)
      ? catalogEvidence.reviewReasons
      : [],
    catalogId:
      catalogEvidence?.catalogId ||
      catalogEvidence?.sourceAttribution?.catalogId ||
      catalogEvidence?.selectedMatch?.catalogId ||
      null,
    catalogSourceLabel:
      catalogEvidence?.sourceLabel ||
      catalogEvidence?.sourceAttribution?.sourceLabel ||
      catalogEvidence?.selectedMatch?.sourceLabel ||
      null,
    mismatches,
  };
}

function percent(passed, total) {
  if (total === 0) return null;
  return Number(((passed / total) * 100).toFixed(2));
}

function finitePositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function secondsFromMilliseconds(value) {
  const milliseconds = finitePositiveNumber(value);
  if (milliseconds === null) return null;
  return Number((milliseconds / 1000).toFixed(2));
}

function readScanElapsedMs(result) {
  return (
    finitePositiveNumber(result?.timing?.elapsedMs) ??
    finitePositiveNumber(result?.scanTiming?.elapsedMs) ??
    finitePositiveNumber(result?.scanElapsedMs) ??
    finitePositiveNumber(result?.elapsedMs) ??
    null
  );
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) return null;
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, index))];
}

function summarizeTiming(cardScores, results, speedTargets) {
  const completedTimingRows = cardScores
    .map((score) => ({
      trialCardId: score.trialCardId,
      elapsedMs: score.scanElapsedMs,
      elapsedSeconds: secondsFromMilliseconds(score.scanElapsedMs),
    }))
    .filter((row) => row.elapsedMs !== null);
  const elapsedMsValues = completedTimingRows
    .map((row) => row.elapsedMs)
    .sort((left, right) => left - right);
  const totalElapsedMs =
    finitePositiveNumber(results?.summary?.totalElapsedMs) ??
    finitePositiveNumber(results?.timing?.totalElapsedMs) ??
    finitePositiveNumber(results?.batchTiming?.totalElapsedMs) ??
    null;
  const averageElapsedMs =
    elapsedMsValues.length > 0
      ? elapsedMsValues.reduce((sum, value) => sum + value, 0) / elapsedMsValues.length
      : null;
  const p95ElapsedMs = percentile(elapsedMsValues, 95);
  const slowestRows = completedTimingRows
    .slice()
    .sort((left, right) => right.elapsedMs - left.elapsedMs)
    .slice(0, 10);
  const averageTargetMs =
    speedTargets.targetAverageSecondsPerCard === null
      ? null
      : speedTargets.targetAverageSecondsPerCard * 1000;
  const p95TargetMs =
    speedTargets.targetP95SecondsPerCard === null
      ? null
      : speedTargets.targetP95SecondsPerCard * 1000;
  const timingCoveragePassed =
    !speedTargets.requireTiming || completedTimingRows.length === cardScores.length;
  const averagePassed =
    averageTargetMs === null ||
    (averageElapsedMs !== null && averageElapsedMs <= averageTargetMs);
  const p95Passed =
    p95TargetMs === null || (p95ElapsedMs !== null && p95ElapsedMs <= p95TargetMs);

  return {
    targetAverageSecondsPerCard: speedTargets.targetAverageSecondsPerCard,
    targetP95SecondsPerCard: speedTargets.targetP95SecondsPerCard,
    requireTiming: speedTargets.requireTiming,
    completedRowsWithTiming: completedTimingRows.length,
    totalResultRows: cardScores.length,
    totalElapsedSeconds: secondsFromMilliseconds(totalElapsedMs),
    averageSecondsPerCard: secondsFromMilliseconds(averageElapsedMs),
    p95SecondsPerCard: secondsFromMilliseconds(p95ElapsedMs),
    slowestRows,
    timingCoveragePassed,
    averagePassed,
    p95Passed,
    targetMet: timingCoveragePassed && averagePassed && p95Passed,
  };
}

function summarizeScores(
  manifest,
  manifestPath,
  results,
  targetAccuracyPercent,
  speedTargets = {
    targetAverageSecondsPerCard: null,
    targetP95SecondsPerCard: null,
    requireTiming: false,
  }
) {
  const resultById = new Map(
    results.cards
      .filter((item) => isKnown(item.trialCardId))
      .map((item) => [String(item.trialCardId), item])
  );
  const cardScores = manifest.cards.map((card) => {
    const result = resultById.get(String(card.trialCardId));
    return {
      ...scoreCard(card, result),
      scanElapsedMs: result ? readScanElapsedMs(result) : null,
    };
  });

  const identityExactTotal = cardScores.filter((item) => item.identityExactEligible).length;
  const identityExactPassed = cardScores.filter((item) => item.identityExactPassed).length;
  const serialNumberTotal = cardScores.filter((item) => item.serialNumberEligible).length;
  const serialNumberPassed = cardScores.filter((item) => item.serialNumberPassed).length;
  const serialRunTotal = cardScores.filter((item) => item.serialRunEligible).length;
  const serialRunPassed = cardScores.filter((item) => item.serialRunPassed).length;
  const consensusReviewIds = cardScores
    .filter((item) => item.consensusReviewRequired)
    .map((item) => item.trialCardId);
  const catalogConfirmedIds = cardScores
    .filter((item) => item.catalogConfirmed)
    .map((item) => item.trialCardId);
  const catalogReviewIds = cardScores
    .filter((item) => item.catalogReviewRequired)
    .map((item) => item.trialCardId);
  const catalogMissingEvidenceIds = cardScores
    .filter((item) => item.hasResult && !item.hasCatalogEvidence)
    .map((item) => item.trialCardId);
  const operatorReviewedScores = cardScores.filter(
    (item) => item.hasResult && item.hasOperatorReview,
  );
  const operatorMarkedWrongIds = operatorReviewedScores
    .filter((item) => item.operatorMarkedWrong)
    .map((item) => item.trialCardId);
  const operatorMarkedCorrectIds = operatorReviewedScores
    .filter((item) => item.operatorMarkedCorrect)
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
    .filter(
      (item) =>
        item.mismatches.length > 0 ||
        item.consensusReviewRequired ||
        item.catalogReviewRequired ||
        !item.hasResult
    )
    .map((item) => ({
      trialCardId: item.trialCardId,
      hasResult: item.hasResult,
      consensusReviewRequired: item.consensusReviewRequired,
      consensusReviewReasons: item.consensusReviewReasons,
      catalogConfirmed: item.catalogConfirmed,
      catalogReviewRequired: item.catalogReviewRequired,
      catalogReviewReasons: item.catalogReviewReasons,
      catalogId: item.catalogId,
      catalogSourceLabel: item.catalogSourceLabel,
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
      targetAverageSecondsPerCard: speedTargets.targetAverageSecondsPerCard,
      targetP95SecondsPerCard: speedTargets.targetP95SecondsPerCard,
      requireTiming: speedTargets.requireTiming,
    },
    observed: {
      cards: manifest.cards.length,
      ...imageSummary,
      results: results.cards.length,
      missingResultIds,
      consensusReviewIds,
      catalogConfirmedIds,
      catalogReviewIds,
      catalogMissingEvidenceIds,
      catalogEvidence: {
        confirmed: catalogConfirmedIds.length,
        reviewRequired: catalogReviewIds.length,
        missing: catalogMissingEvidenceIds.length,
        coveragePercent: percent(
          cardScores.length - catalogMissingEvidenceIds.length,
          cardScores.length,
        ),
      },
      operatorReview: {
        reviewed: operatorReviewedScores.length,
        markedWrong: operatorMarkedWrongIds.length,
        markedCorrect: operatorMarkedCorrectIds.length,
        markedWrongIds: operatorMarkedWrongIds,
        accuracyPercent: percent(
          operatorMarkedCorrectIds.length,
          operatorReviewedScores.length,
        ),
        gradingMode:
          "operator wrong-checkbox triage; use the full answer-key manifest for final 94% certification",
      },
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
    speed: summarizeTiming(cardScores, results, speedTargets),
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
    consensusReviewIds.length === 0 &&
    catalogReviewIds.length === 0 &&
    report.speed.targetMet;

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
  if (catalogReviewIds.length > 0) {
    report.warnings.push(
      `${catalogReviewIds.length} card(s) still require catalog/checklist review before exact comps are trusted.`
    );
  }
  if (catalogMissingEvidenceIds.length > 0) {
    report.warnings.push(
      `${catalogMissingEvidenceIds.length} completed result row(s) have no catalog/checklist evidence yet; this is coverage debt, not an automatic score failure.`
    );
  }
  if (report.speed.requireTiming && !report.speed.timingCoveragePassed) {
    report.warnings.push(
      `Timing evidence is required, but ${report.speed.completedRowsWithTiming}/${report.speed.totalResultRows} completed result row(s) include elapsed time.`
    );
  }
  if (!report.speed.averagePassed) {
    report.warnings.push(
      `Average scan speed ${report.speed.averageSecondsPerCard ?? "n/a"}s/card is slower than target ${report.speed.targetAverageSecondsPerCard}s/card.`
    );
  }
  if (!report.speed.p95Passed) {
    report.warnings.push(
      `P95 scan speed ${report.speed.p95SecondsPerCard ?? "n/a"}s/card is slower than target ${report.speed.targetP95SecondsPerCard}s/card.`
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
  if (failure.catalogReviewRequired) return "catalog_review_required";
  return "field_mismatch";
}

function suggestedActionForFailure(failure) {
  if (!failure.hasResult) {
    return "Re-run or re-export this trial card so the results file includes the row.";
  }
  if (failure.consensusReviewRequired) {
    return "Resolve the multi-scanner consensus review with checklist/catalog evidence or operator correction, then re-export trial results.";
  }
  if (failure.catalogReviewRequired) {
    return "Resolve the catalog/checklist review or add approved checklist evidence before trusting exact comps, then re-export trial results.";
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
      catalogConfirmedFailures: failures.filter((failure) => failure.catalogConfirmed).length,
      catalogReviewFailures: failures.filter((failure) => failure.catalogReviewRequired).length,
      catalogReviewRequired: failures.filter((failure) => failure.catalogReviewRequired).length,
      fieldMismatchCards: failures.filter((failure) => failure.mismatches.length > 0).length,
      combinedIdentityAndSerialPercent:
        report.accuracy.combinedIdentityAndSerial.percent,
      identityExactPercent: report.accuracy.identityExact.percent,
      serialNumberExactPercent: report.accuracy.serialNumberExact.percent,
      averageSecondsPerCard: report.speed.averageSecondsPerCard,
      p95SecondsPerCard: report.speed.p95SecondsPerCard,
      completedRowsWithTiming: report.speed.completedRowsWithTiming,
      speedTargetMet: report.speed.targetMet,
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
  console.log(
    `Timing evidence: ${report.speed.completedRowsWithTiming}/${report.speed.totalResultRows} row(s)`
  );
  console.log(
    `Average speed: ${report.speed.averageSecondsPerCard ?? "n/a"}s/card${
      report.speed.targetAverageSecondsPerCard === null
        ? ""
        : ` (target <= ${report.speed.targetAverageSecondsPerCard}s)`
    }`
  );
  console.log(
    `P95 speed: ${report.speed.p95SecondsPerCard ?? "n/a"}s/card${
      report.speed.targetP95SecondsPerCard === null
        ? ""
        : ` (target <= ${report.speed.targetP95SecondsPerCard}s)`
    }`
  );
  if (report.speed.slowestRows.length > 0) {
    const slowest = report.speed.slowestRows
      .slice(0, 5)
      .map((row) => `${row.trialCardId} ${row.elapsedSeconds}s`)
      .join(", ");
    console.log(`Slowest rows: ${slowest}`);
  }
  console.log("");
  console.log(
    `Catalog evidence: confirmed ${report.observed.catalogEvidence.confirmed}, review ${report.observed.catalogEvidence.reviewRequired}, missing ${report.observed.catalogEvidence.missing} (${report.observed.catalogEvidence.coveragePercent ?? "n/a"}% coverage)`
  );
  if (report.observed.operatorReview?.reviewed > 0) {
    console.log(
      `Operator review: wrong ${report.observed.operatorReview.markedWrong}/${report.observed.operatorReview.reviewed}, quick accuracy ${report.observed.operatorReview.accuracyPercent ?? "n/a"}%`
    );
  }
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
      if (failure.catalogReviewRequired) {
        const reasons = failure.catalogReviewReasons.length
          ? failure.catalogReviewReasons.join(", ")
          : "no detailed reason supplied";
        console.log(`- ${failure.trialCardId}: catalog review required (${reasons})`);
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
} else if (await writeGroundTruthSheet()) {
  // Ground-truth worksheet export mode already handled the command.
} else if (await applyGroundTruthSheet()) {
  // Ground-truth worksheet import mode already handled the command.
} else if (await auditTrialManifest()) {
  // Manifest-audit mode already handled the command.
} else if (await auditTrialImages()) {
  // Image-audit mode already handled the command.
} else {
  try {
    const targetAccuracyPercent = Number.parseFloat(
      getFlagValue("--target", String(DEFAULT_TARGET_ACCURACY))
    );
    const targetAverageSecondsPerCard = readPositiveSecondsFlag(
      "--target-average-seconds-per-card"
    );
    const targetP95SecondsPerCard = readPositiveSecondsFlag(
      "--target-p95-seconds-per-card"
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
        Number.isFinite(targetAccuracyPercent) ? targetAccuracyPercent : DEFAULT_TARGET_ACCURACY,
        {
          targetAverageSecondsPerCard,
          targetP95SecondsPerCard,
          requireTiming: hasFlag("--require-timing"),
        }
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
