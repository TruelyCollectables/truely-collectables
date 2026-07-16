import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");

const schema = "tcos.instacompTrialAnswerKeyValidation.v1";
const requiredColumns = ["trialCardId", "player", "year", "setName", "cardNumber"];
const coreFields = ["player", "year", "setName", "cardNumber"];
const defaultColumns = [
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
const booleanFields = ["isRookie", "isAuto", "isRelic"];
const allowedBooleanValues = new Set(["", "true", "false", "yes", "no", "y", "n", "1", "0"]);

function getFlagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function resolveFromRepo(input) {
  return path.resolve(repoRoot, input);
}

function relativeToRepo(input) {
  return path.relative(repoRoot, input) || ".";
}

function tsvCell(value) {
  return String(value ?? "")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function parseTsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].split("\t").map((header) => header.trim());
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    const row = { rowNumber: index + 2 };
    for (const [headerIndex, header] of headers.entries()) {
      row[header] = tsvCell(cells[headerIndex]);
    }
    return row;
  });

  return { headers, rows };
}

function manifestExpectedFields(card) {
  return card && typeof card.expected === "object" && card.expected ? card.expected : {};
}

function manifestRow(card, index) {
  const expected = manifestExpectedFields(card);
  return {
    trialCardId: tsvCell(card?.trialCardId) || `trial-card-${String(index + 1).padStart(3, "0")}`,
    frontImage: tsvCell(card?.frontImage),
    backImage: tsvCell(card?.backImage),
    player: tsvCell(expected.player),
    year: tsvCell(expected.year),
    setName: tsvCell(expected.setName),
    cardNumber: tsvCell(expected.cardNumber),
    brand: tsvCell(expected.brand),
    parallel: tsvCell(expected.parallel),
    variation: tsvCell(expected.variation),
    serialNumber: tsvCell(expected.serialNumber),
    serialRun: tsvCell(expected.serialRun),
    team: tsvCell(expected.team),
    sport: tsvCell(expected.sport),
    isRookie: typeof expected.isRookie === "boolean" ? String(expected.isRookie) : tsvCell(expected.isRookie),
    isAuto: typeof expected.isAuto === "boolean" ? String(expected.isAuto) : tsvCell(expected.isAuto),
    isRelic: typeof expected.isRelic === "boolean" ? String(expected.isRelic) : tsvCell(expected.isRelic),
    notes: tsvCell(card?.notes),
  };
}

function comparePathish(a, b) {
  const left = tsvCell(a).replace(/\\/g, "/").replace(/^\.\//, "");
  const right = tsvCell(b).replace(/\\/g, "/").replace(/^\.\//, "");
  return left === right;
}

function groupWorksheetRows(rows) {
  const rowsById = new Map();
  const duplicateTrialCardIds = [];
  const missingTrialCardIdRows = [];

  for (const row of rows) {
    const trialCardId = tsvCell(row.trialCardId);
    if (!trialCardId) {
      missingTrialCardIdRows.push({ row: row.rowNumber });
      continue;
    }
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

  return { rowsById, duplicateTrialCardIds, missingTrialCardIdRows };
}

function buildValidation({ manifest, manifestPath, worksheetPath, worksheetText, expectedCards }) {
  const cards = Array.isArray(manifest.cards) ? manifest.cards : [];
  const manifestRows = cards.map(manifestRow);
  const manifestIds = manifestRows.map((row) => row.trialCardId);
  const parsedWorksheet = parseTsv(worksheetText);
  const worksheetRows = parsedWorksheet.rows;
  const worksheet = groupWorksheetRows(worksheetRows);
  const missingColumns = requiredColumns.filter((column) => !parsedWorksheet.headers.includes(column));
  const unknownColumns = parsedWorksheet.headers.filter((column) => !defaultColumns.includes(column));
  const missingWorksheetTrialCardIds = [];
  const extraWorksheetTrialCardIds = [];
  const missingCoreRows = [];
  const imagePathDriftRows = [];
  const booleanWarnings = [];
  const rowOrderDrift = [];

  for (const [index, manifestRowValue] of manifestRows.entries()) {
    const worksheetRow = worksheet.rowsById.get(manifestRowValue.trialCardId);
    if (!worksheetRow) {
      missingWorksheetTrialCardIds.push(manifestRowValue.trialCardId);
      continue;
    }

    const expectedRowId = manifestIds[index];
    if (tsvCell(worksheetRows[index]?.trialCardId) !== expectedRowId) {
      rowOrderDrift.push({
        expectedRow: index + 2,
        expectedTrialCardId: expectedRowId,
        actualTrialCardId: tsvCell(worksheetRows[index]?.trialCardId) || "(missing)",
      });
    }

    const missingCoreFields = coreFields.filter((field) => !tsvCell(worksheetRow[field]));
    if (missingCoreFields.length > 0) {
      missingCoreRows.push({
        trialCardId: manifestRowValue.trialCardId,
        row: worksheetRow.rowNumber,
        missing: missingCoreFields,
      });
    }

    for (const field of ["frontImage", "backImage"]) {
      const worksheetValue = tsvCell(worksheetRow[field]);
      const manifestValue = tsvCell(manifestRowValue[field]);
      if (worksheetValue && manifestValue && !comparePathish(worksheetValue, manifestValue)) {
        imagePathDriftRows.push({
          trialCardId: manifestRowValue.trialCardId,
          row: worksheetRow.rowNumber,
          field,
          manifestValue,
          worksheetValue,
        });
      }
    }

    for (const field of booleanFields) {
      const value = tsvCell(worksheetRow[field]).toLowerCase();
      if (!allowedBooleanValues.has(value)) {
        booleanWarnings.push({
          trialCardId: manifestRowValue.trialCardId,
          row: worksheetRow.rowNumber,
          field,
          value: worksheetRow[field],
        });
      }
    }
  }

  for (const row of worksheetRows) {
    const trialCardId = tsvCell(row.trialCardId);
    if (trialCardId && !manifestIds.includes(trialCardId)) {
      extraWorksheetTrialCardIds.push({ trialCardId, row: row.rowNumber });
    }
  }

  const manifestRowCountMatchesExpected = cards.length === expectedCards;
  const worksheetRowCountMatchesManifest = worksheetRows.length === cards.length;
  const requiredColumnsPresent = missingColumns.length === 0;
  const idIntegrityOk =
    worksheet.duplicateTrialCardIds.length === 0 &&
    worksheet.missingTrialCardIdRows.length === 0 &&
    missingWorksheetTrialCardIds.length === 0 &&
    extraWorksheetTrialCardIds.length === 0;
  const rowCountsOk = manifestRowCountMatchesExpected && worksheetRowCountMatchesManifest;
  const coreFieldsReady = missingCoreRows.length === 0;
  const ok = Boolean(
    manifest?.schema === "tcos.instacompTrialManifest.v1" &&
      requiredColumnsPresent &&
      idIntegrityOk &&
      rowCountsOk &&
      coreFieldsReady,
  );

  return {
    schema,
    generatedAt: new Date().toISOString(),
    ok,
    readyToApply: ok,
    manifest: {
      path: relativeToRepo(manifestPath),
      schema: manifest?.schema || null,
      schemaOk: manifest?.schema === "tcos.instacompTrialManifest.v1",
      rowCount: cards.length,
      targetCards: manifest?.targetCards ?? null,
      expectedCards,
      manifestRowCountMatchesExpected,
    },
    worksheet: {
      path: relativeToRepo(worksheetPath),
      exists: true,
      headers: parsedWorksheet.headers,
      rowCount: worksheetRows.length,
      worksheetRowCountMatchesManifest,
      requiredColumns,
      requiredColumnsPresent,
      missingColumns,
      unknownColumns,
    },
    counts: {
      readyCoreRows: cards.length - missingCoreRows.length - missingWorksheetTrialCardIds.length,
      missingCoreRows: missingCoreRows.length,
      duplicateTrialCardIds: worksheet.duplicateTrialCardIds.length,
      missingTrialCardIdRows: worksheet.missingTrialCardIdRows.length,
      missingWorksheetTrialCardIds: missingWorksheetTrialCardIds.length,
      extraWorksheetTrialCardIds: extraWorksheetTrialCardIds.length,
      imagePathDriftRows: imagePathDriftRows.length,
      rowOrderDriftRows: rowOrderDrift.length,
      booleanWarnings: booleanWarnings.length,
    },
    duplicateTrialCardIds: worksheet.duplicateTrialCardIds,
    missingTrialCardIdRows: worksheet.missingTrialCardIdRows,
    missingWorksheetTrialCardIds,
    extraWorksheetTrialCardIds,
    missingCoreRows,
    imagePathDriftRows,
    rowOrderDrift,
    booleanWarnings,
    next: ok
      ? "Answer-key TSV is validated. Run npm run instacomp:trial:groundtruth:apply, then npm run instacomp:trial:groundtruth."
      : missingColumns.length > 0
        ? "Regenerate the worksheet with npm run instacomp:trial:groundtruth:sheet so required columns are present."
        : missingCoreRows.length > 0
          ? "Fill the missing player/year/setName/cardNumber fields, save the TSV, then rerun npm run instacomp:trial:answer-key:validate."
          : "Fix the worksheet ID/row-count issues, save the TSV, then rerun npm run instacomp:trial:answer-key:validate.",
    safeBuildBoundary:
      "Local InstaComp trial answer-key validation only. Reads local manifest/worksheet and writes local receipts; does not apply worksheet values, mutate images, scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
}

function buildMissingWorksheetReport({ manifest, manifestPath, worksheetPath, expectedCards }) {
  const cards = Array.isArray(manifest.cards) ? manifest.cards : [];
  return {
    schema,
    generatedAt: new Date().toISOString(),
    ok: false,
    readyToApply: false,
    manifest: {
      path: relativeToRepo(manifestPath),
      schema: manifest?.schema || null,
      schemaOk: manifest?.schema === "tcos.instacompTrialManifest.v1",
      rowCount: cards.length,
      targetCards: manifest?.targetCards ?? null,
      expectedCards,
      manifestRowCountMatchesExpected: cards.length === expectedCards,
    },
    worksheet: {
      path: relativeToRepo(worksheetPath),
      exists: false,
      headers: [],
      rowCount: 0,
      worksheetRowCountMatchesManifest: false,
      requiredColumns,
      requiredColumnsPresent: false,
      missingColumns: requiredColumns,
      unknownColumns: [],
    },
    counts: {
      readyCoreRows: 0,
      missingCoreRows: cards.length,
      duplicateTrialCardIds: 0,
      missingTrialCardIdRows: 0,
      missingWorksheetTrialCardIds: cards.length,
      extraWorksheetTrialCardIds: 0,
      imagePathDriftRows: 0,
      rowOrderDriftRows: 0,
      booleanWarnings: 0,
    },
    duplicateTrialCardIds: [],
    missingTrialCardIdRows: [],
    missingWorksheetTrialCardIds: cards.map((card, index) => manifestRow(card, index).trialCardId),
    extraWorksheetTrialCardIds: [],
    missingCoreRows: [],
    imagePathDriftRows: [],
    rowOrderDrift: [],
    booleanWarnings: [],
    next:
      "Run npm run instacomp:trial:groundtruth:sheet to create the TSV, fill it, then rerun npm run instacomp:trial:answer-key:validate.",
    safeBuildBoundary:
      "Local InstaComp trial answer-key validation only. Reads local manifest/worksheet and writes local receipts; does not apply worksheet values, mutate images, scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
}

function issueList(items, formatter, empty = "none") {
  if (!items.length) return empty;
  return items.slice(0, 10).map(formatter).join("; ");
}

function buildMarkdown(report) {
  const lines = [
    "# TCOS InstaComp Trial Answer-Key Validation",
    "",
    `- Schema: \`${report.schema}\``,
    `- Generated: ${report.generatedAt}`,
    `- OK / ready to apply: ${report.ok ? "yes" : "no"}`,
    `- Manifest: \`${report.manifest.path}\` (${report.manifest.rowCount}/${report.manifest.expectedCards} rows)`,
    `- Worksheet: \`${report.worksheet.path}\` (${report.worksheet.exists ? `${report.worksheet.rowCount} rows` : "missing"})`,
    `- Ready core rows: ${report.counts.readyCoreRows}/${report.manifest.expectedCards}`,
    `- Next: ${report.next}`,
    "",
    "## Checks",
    "",
    "| Check | Result |",
    "| --- | --- |",
    `| Manifest schema | ${report.manifest.schemaOk ? "ok" : `bad: ${markdownCell(report.manifest.schema || "missing")}`} |`,
    `| Manifest row count | ${report.manifest.manifestRowCountMatchesExpected ? "ok" : `expected ${report.manifest.expectedCards}, found ${report.manifest.rowCount}`} |`,
    `| Worksheet exists | ${report.worksheet.exists ? "ok" : "missing"} |`,
    `| Worksheet columns | ${
      report.worksheet.requiredColumnsPresent
        ? "ok"
        : `missing ${markdownCell(report.worksheet.missingColumns.join(", "))}`
    } |`,
    `| Worksheet row count | ${report.worksheet.worksheetRowCountMatchesManifest ? "ok" : `manifest ${report.manifest.rowCount}, worksheet ${report.worksheet.rowCount}`} |`,
    `| Duplicate trialCardId rows | ${report.counts.duplicateTrialCardIds} |`,
    `| Missing trialCardId rows | ${report.counts.missingTrialCardIdRows} |`,
    `| Missing manifest IDs in worksheet | ${report.counts.missingWorksheetTrialCardIds} |`,
    `| Extra worksheet IDs | ${report.counts.extraWorksheetTrialCardIds} |`,
    `| Missing core answer fields | ${report.counts.missingCoreRows} |`,
    `| Image path drift warnings | ${report.counts.imagePathDriftRows} |`,
    `| Row-order drift warnings | ${report.counts.rowOrderDriftRows} |`,
    `| Boolean value warnings | ${report.counts.booleanWarnings} |`,
    "",
    "## First issues",
    "",
    `- Duplicate IDs: ${issueList(
      report.duplicateTrialCardIds,
      (item) => `${item.trialCardId} rows ${item.firstRow}/${item.duplicateRow}`,
    )}`,
    `- Missing ID rows: ${issueList(report.missingTrialCardIdRows, (item) => `row ${item.row}`)}`,
    `- Missing worksheet IDs: ${issueList(report.missingWorksheetTrialCardIds, (item) => item)}`,
    `- Extra worksheet IDs: ${issueList(
      report.extraWorksheetTrialCardIds,
      (item) => `${item.trialCardId} row ${item.row}`,
    )}`,
    `- Missing core fields: ${issueList(
      report.missingCoreRows,
      (item) => `${item.trialCardId} row ${item.row} missing ${item.missing.join("/")}`,
    )}`,
    `- Image path drift: ${issueList(
      report.imagePathDriftRows,
      (item) => `${item.trialCardId} ${item.field} row ${item.row}`,
    )}`,
    `- Row-order drift: ${issueList(
      report.rowOrderDrift,
      (item) => `row ${item.expectedRow} expected ${item.expectedTrialCardId}, saw ${item.actualTrialCardId}`,
    )}`,
    `- Boolean warnings: ${issueList(
      report.booleanWarnings,
      (item) => `${item.trialCardId} ${item.field}=${item.value}`,
    )}`,
    "",
    `Safe boundary: ${report.safeBuildBoundary}`,
    "",
  ];

  return `${lines.join("\n")}\n`;
}

async function writeReceipt(filePath, content) {
  const resolved = resolveFromRepo(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content);
  return resolved;
}

async function main() {
  const manifestFlag = getFlagValue("--manifest", "instacomp-trial-manifest.local.json");
  const worksheetFlag = getFlagValue("--worksheet", "instacomp-trial-groundtruth.local.tsv");
  const receiptJsonFlag = getFlagValue(
    "--receipt-json",
    "instacomp-trial-answer-key-validation.local.json",
  );
  const receiptMdFlag = getFlagValue(
    "--receipt-md",
    "instacomp-trial-answer-key-validation.local.md",
  );
  const expectedCards = Number.parseInt(getFlagValue("--expected-cards", "100"), 10);
  const manifestPath = resolveFromRepo(manifestFlag);
  const worksheetPath = resolveFromRepo(worksheetFlag);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const report = existsSync(worksheetPath)
    ? buildValidation({
        manifest,
        manifestPath,
        worksheetPath,
        worksheetText: await readFile(worksheetPath, "utf8"),
        expectedCards,
      })
    : buildMissingWorksheetReport({ manifest, manifestPath, worksheetPath, expectedCards });

  const jsonReceipt = JSON.stringify(report, null, 2);
  const markdownReceipt = buildMarkdown(report);
  const jsonReceiptPath = await writeReceipt(receiptJsonFlag, jsonReceipt);
  const markdownReceiptPath = await writeReceipt(receiptMdFlag, markdownReceipt);

  if (jsonOutput) {
    console.log(jsonReceipt);
    return;
  }

  console.log("TCOS InstaComp trial answer-key validation:");
  console.log(`- schema: ${report.schema}`);
  console.log(`- ok / ready to apply: ${report.ok ? "yes" : "no"}`);
  console.log(
    `- manifest rows: ${report.manifest.rowCount}/${report.manifest.expectedCards} (${report.manifest.manifestRowCountMatchesExpected ? "ok" : "count mismatch"})`,
  );
  console.log(
    `- worksheet rows: ${report.worksheet.rowCount}/${report.manifest.rowCount} (${report.worksheet.exists ? "present" : "missing"})`,
  );
  console.log(
    `- required columns: ${report.worksheet.requiredColumnsPresent ? "ok" : `missing ${report.worksheet.missingColumns.join(", ")}`}`,
  );
  console.log(`- ready core rows: ${report.counts.readyCoreRows}/${report.manifest.expectedCards}`);
  console.log(`- duplicate trialCardId rows: ${report.counts.duplicateTrialCardIds}`);
  console.log(`- missing trialCardId rows: ${report.counts.missingTrialCardIdRows}`);
  console.log(`- missing manifest IDs in worksheet: ${report.counts.missingWorksheetTrialCardIds}`);
  console.log(`- extra worksheet IDs: ${report.counts.extraWorksheetTrialCardIds}`);
  console.log(`- missing core rows: ${report.counts.missingCoreRows}`);
  console.log(`- image path drift warnings: ${report.counts.imagePathDriftRows}`);
  console.log(`- row-order drift warnings: ${report.counts.rowOrderDriftRows}`);
  console.log(`- boolean value warnings: ${report.counts.booleanWarnings}`);
  console.log(`- receipt JSON: ${relativeToRepo(jsonReceiptPath)}`);
  console.log(`- receipt Markdown: ${relativeToRepo(markdownReceiptPath)}`);
  console.log(`- next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
