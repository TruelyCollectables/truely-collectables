import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");

const requiredCoreFields = ["player", "year", "setName", "cardNumber"];
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tsvCell(value) {
  return String(value ?? "")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function readExpectedFields(card) {
  return card?.expected || {};
}

function manifestRow(card, index) {
  const expected = readExpectedFields(card);

  return {
    trialCardId: card.trialCardId || `trial-card-${String(index + 1).padStart(3, "0")}`,
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
    isRookie: typeof expected.isRookie === "boolean" ? String(expected.isRookie).toUpperCase() : "",
    isAuto: typeof expected.isAuto === "boolean" ? String(expected.isAuto).toUpperCase() : "",
    isRelic: typeof expected.isRelic === "boolean" ? String(expected.isRelic).toUpperCase() : "",
    notes: card.notes || "",
  };
}

function parseTsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

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

async function readJson(filePath) {
  const resolved = resolveFromRepo(filePath);
  const text = await readFile(resolved, "utf8");
  return { resolved, data: JSON.parse(text) };
}

async function readWorksheetRows(worksheetPath) {
  if (!worksheetPath) return { path: null, exists: false, headers: [], rowsById: new Map() };

  const resolved = resolveFromRepo(worksheetPath);
  if (!existsSync(resolved)) {
    return { path: resolved, exists: false, headers: [], rowsById: new Map() };
  }

  const parsed = parseTsv(await readFile(resolved, "utf8"));
  const rowsById = new Map();
  const duplicateTrialCardIds = [];

  for (const row of parsed.rows) {
    const trialCardId = tsvCell(row.trialCardId);
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

  return {
    path: resolved,
    exists: true,
    headers: parsed.headers,
    rowsById,
    duplicateTrialCardIds,
  };
}

function imageSource(value, manifestDir) {
  const clean = tsvCell(value);
  if (!clean) return { label: "", exists: false, src: "" };
  if (/^https?:\/\//i.test(clean) || clean.startsWith("data:")) {
    return { label: clean, exists: true, src: clean };
  }

  const resolved = path.resolve(manifestDir, clean);
  return {
    label: clean,
    exists: existsSync(resolved),
    src: pathToFileURL(resolved).href,
  };
}

function buildRows(manifest, manifestPath, worksheet) {
  const manifestDir = path.dirname(manifestPath);
  return manifest.cards.map((card, index) => {
    const fallback = manifestRow(card, index);
    const worksheetRow = worksheet.rowsById.get(fallback.trialCardId) || {};
    const row = {
      ...fallback,
      ...Object.fromEntries(
        defaultColumns.map((column) => [
          column,
          tsvCell(worksheetRow[column]) || tsvCell(fallback[column]),
        ]),
      ),
      rowNumber: worksheetRow.rowNumber || index + 2,
    };
    const missingCoreFields = requiredCoreFields.filter((field) => !tsvCell(row[field]));
    const front = imageSource(row.frontImage || fallback.frontImage, manifestDir);
    const back = imageSource(row.backImage || fallback.backImage, manifestDir);

    return {
      ...row,
      ready: missingCoreFields.length === 0,
      missingCoreFields,
      front,
      back,
    };
  });
}

function statusClass(row) {
  if (row.ready && row.front.exists && row.back.exists) return "ready";
  if (row.ready) return "answer-ready";
  return "missing";
}

function buildHtml(report) {
  const rows = report.rows;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TCOS InstaComp Trial Answer-Key Review</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; background: #f7f2ee; color: #171717; }
    header { position: sticky; top: 0; z-index: 5; background: #fffaf5; border-bottom: 2px solid #e6d5c3; padding: 18px 22px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .pill { border: 1px solid #c9b8a6; border-radius: 999px; background: white; padding: 8px 12px; font-weight: 800; }
    .ok { color: #14532d; border-color: #86c59b; }
    .warn { color: #854d0e; border-color: #e6b64c; }
    .bad { color: #991b1b; border-color: #e9a0a0; }
    main { padding: 18px 22px 60px; }
    .commands { background: #111827; color: #f9fafb; border-radius: 12px; padding: 14px 16px; margin: 16px 0; font-weight: 800; }
    code { background: rgba(255,255,255,0.12); padding: 2px 5px; border-radius: 5px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; background: #fff; border: 1px solid #ddd0c4; border-radius: 12px; padding: 12px; margin: 0 0 16px; }
    button { border: 2px solid #174c2a; background: #166534; color: #fff; border-radius: 10px; padding: 10px 14px; font-size: 14px; font-weight: 900; cursor: pointer; }
    button.secondary { border-color: #1d4ed8; background: #2563eb; }
    button:focus, input:focus { outline: 3px solid #f59e0b; outline-offset: 2px; }
    #tsvOutput { position: absolute; left: -9999px; width: 1px; height: 1px; }
    #copyStatus { font-size: 13px; font-weight: 900; color: #166534; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #ddd0c4; }
    th, td { border-bottom: 1px solid #eadfd5; padding: 9px; vertical-align: top; text-align: left; }
    th { position: sticky; top: 98px; background: #fff7ed; z-index: 4; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr.ready { background: #f0fff4; }
    tr.answer-ready { background: #fffdf0; }
    tr.missing { background: #fff5f5; }
    .thumbs { display: flex; gap: 8px; min-width: 180px; }
    figure { margin: 0; width: 82px; }
    img { width: 82px; height: 112px; object-fit: contain; border: 1px solid #cfc7bf; border-radius: 8px; background: #fff; }
    figcaption { margin-top: 4px; font-size: 11px; font-weight: 800; color: #666; text-align: center; }
    .missing-img { width: 82px; height: 112px; display: grid; place-items: center; border: 1px dashed #d18c8c; border-radius: 8px; color: #991b1b; background: #fffafa; font-size: 11px; font-weight: 900; text-align: center; }
    .id { font-weight: 900; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(130px, 1fr)); gap: 6px 12px; min-width: 320px; }
    .field label { display: block; color: #6b7280; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .field input { width: 100%; box-sizing: border-box; border: 1px solid #d6ccc2; border-radius: 8px; padding: 7px; font-size: 13px; font-weight: 800; background: #fff; }
    .field input.required-missing { border-color: #dc2626; background: #fff1f2; }
    .status { font-weight: 900; }
    .small { font-size: 12px; color: #666; line-height: 1.4; }
    @media print {
      header, th { position: static; }
      body { background: white; }
      .commands { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>TCOS InstaComp Trial Answer-Key Review</h1>
    <div class="small">Generated ${escapeHtml(report.generatedAt)}. Local-only front/back thumbnails guide for filling the TSV answer key; does not scan cards, deploy, publish listings, create Checkout, buy postage, approve live money, or release payouts.</div>
    <div class="summary">
      <span class="pill ${report.readyRows === report.expectedCards ? "ok" : "bad"}">Answer key ${report.readyRows}/${report.expectedCards}</span>
      <span class="pill ${report.frontImagesExisting === report.expectedCards ? "ok" : "warn"}">Front images ${report.frontImagesExisting}/${report.expectedCards}</span>
      <span class="pill ${report.backImagesExisting === report.expectedCards ? "ok" : "warn"}">Back images ${report.backImagesExisting}/${report.expectedCards}</span>
      <span class="pill ${report.worksheet.exists ? "ok" : "warn"}">Worksheet ${report.worksheet.exists ? "present" : "missing"}</span>
    </div>
  </header>
  <main>
    <div class="commands">
      Fill: <code>${escapeHtml(report.worksheet.relativePath || "instacomp-trial-groundtruth.local.tsv")}</code>
      &nbsp;→ Apply: <code>npm run instacomp:trial:groundtruth:apply</code>
      &nbsp;→ Recheck: <code>npm run instacomp:trial:intake</code>
      &nbsp;→ Scan: <code>http://localhost:3000/admin/instacomp</code>
    </div>
    <div class="toolbar">
      <button type="button" id="copyTsv">Copy updated TSV</button>
      <button type="button" id="downloadTsv" class="secondary">Download updated TSV</button>
      <span id="copyStatus">Edit fields below, then copy/download and save as ${escapeHtml(report.worksheet.relativePath || "instacomp-trial-groundtruth.local.tsv")}.</span>
      <textarea id="tsvOutput" aria-hidden="true"></textarea>
    </div>
    <table>
      <thead>
        <tr>
          <th>Card</th>
          <th>Photos</th>
          <th>Answer-key fields</th>
          <th>Status</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row, index) => `<tr class="${statusClass(row)}" data-front-exists="${row.front.exists ? "true" : "false"}" data-back-exists="${row.back.exists ? "true" : "false"}">
          <td><div class="id">#${index + 1}<br>${escapeHtml(row.trialCardId)}</div><div class="small">TSV row ${escapeHtml(row.rowNumber)}</div>
            <input type="hidden" data-column="trialCardId" value="${escapeHtml(row.trialCardId)}" />
            <input type="hidden" data-column="frontImage" value="${escapeHtml(row.frontImage)}" />
            <input type="hidden" data-column="backImage" value="${escapeHtml(row.backImage)}" />
          </td>
          <td><div class="thumbs">
            <figure>${row.front.exists ? `<img src="${escapeHtml(row.front.src)}" alt="${escapeHtml(row.trialCardId)} front" />` : `<div class="missing-img">Missing<br>front</div>`}<figcaption>Front</figcaption></figure>
            <figure>${row.back.exists ? `<img src="${escapeHtml(row.back.src)}" alt="${escapeHtml(row.trialCardId)} back" />` : `<div class="missing-img">Missing<br>back</div>`}<figcaption>Back</figcaption></figure>
          </div><div class="small">${escapeHtml(row.frontImage)}<br>${escapeHtml(row.backImage)}</div></td>
          <td><div class="fields">
            ${["player", "year", "setName", "cardNumber", "brand", "parallel", "variation", "serialNumber", "serialRun", "team", "sport", "isRookie", "isAuto", "isRelic", "notes"]
              .map(
                (field) =>
                  `<div class="field"><label>${escapeHtml(field)}</label><input data-column="${escapeHtml(field)}" value="${escapeHtml(row[field] || "")}" placeholder="${escapeHtml(requiredCoreFields.includes(field) ? "required" : "optional")}" /></div>`,
              )
              .join("")}
          </div></td>
          <td class="status" data-status-cell>${
            row.ready
              ? row.front.exists && row.back.exists
                ? "Ready"
                : "Answer ready; photos missing"
              : `Missing ${escapeHtml(row.missingCoreFields.join(", "))}`
          }</td>
          <td class="small">${escapeHtml(row.notes || "")}</td>
        </tr>`,
          )
          .join("\n")}
      </tbody>
    </table>
  </main>
  <script>
    const tcosColumns = ${JSON.stringify(defaultColumns)};
    const tcosRequiredColumns = ${JSON.stringify(requiredCoreFields)};
    const outputFilename = ${JSON.stringify(path.basename(report.worksheet.relativePath || "instacomp-trial-groundtruth.local.tsv"))};

    function cleanTsvCell(value) {
      return String(value || "").replace(/\\t/g, " ").replace(/\\r?\\n/g, " ").trim();
    }

    function rowValue(row, column) {
      const input = row.querySelector('[data-column="' + column + '"]');
      return cleanTsvCell(input ? input.value : "");
    }

    function buildUpdatedTsv() {
      const lines = [tcosColumns.join("\\t")];
      for (const row of document.querySelectorAll("tbody tr")) {
        lines.push(tcosColumns.map((column) => rowValue(row, column)).join("\\t"));
      }
      return lines.join("\\n") + "\\n";
    }

    function updateRowStatus(row) {
      const missing = tcosRequiredColumns.filter((column) => !rowValue(row, column));
      for (const column of tcosRequiredColumns) {
        const input = row.querySelector('[data-column="' + column + '"]');
        if (input) input.classList.toggle("required-missing", !rowValue(row, column));
      }
      const statusCell = row.querySelector("[data-status-cell]");
      const hasFront = row.dataset.frontExists === "true";
      const hasBack = row.dataset.backExists === "true";
      row.classList.remove("ready", "answer-ready", "missing");
      if (missing.length === 0 && hasFront && hasBack) {
        row.classList.add("ready");
        if (statusCell) statusCell.textContent = "Ready";
      } else if (missing.length === 0) {
        row.classList.add("answer-ready");
        if (statusCell) statusCell.textContent = "Answer ready; photos missing";
      } else {
        row.classList.add("missing");
        if (statusCell) statusCell.textContent = "Missing " + missing.join(", ");
      }
    }

    function updateSummary() {
      const rows = [...document.querySelectorAll("tbody tr")];
      const readyRows = rows.filter((row) =>
        tcosRequiredColumns.every((column) => Boolean(rowValue(row, column))),
      ).length;
      const pill = document.querySelector(".summary .pill");
      if (pill) {
        pill.textContent = "Answer key " + readyRows + "/" + rows.length;
        pill.classList.toggle("ok", readyRows === rows.length);
        pill.classList.toggle("bad", readyRows !== rows.length);
      }
    }

    async function copyUpdatedTsv() {
      const tsv = buildUpdatedTsv();
      const textarea = document.getElementById("tsvOutput");
      const status = document.getElementById("copyStatus");
      textarea.value = tsv;
      textarea.focus();
      textarea.select();
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(tsv);
          copied = true;
        }
      } catch {
        copied = false;
      }
      if (!copied) copied = document.execCommand("copy");
      if (status) {
        status.textContent = copied
          ? "Updated TSV copied. Paste/save it over " + outputFilename + ", then run npm run instacomp:trial:groundtruth:apply."
          : "Copy fallback selected the hidden TSV text. Press Command+C, save it over " + outputFilename + ", then apply.";
      }
    }

    function downloadUpdatedTsv() {
      const tsv = buildUpdatedTsv();
      const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outputFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const status = document.getElementById("copyStatus");
      if (status) status.textContent = "Downloaded " + outputFilename + ". Replace the repo TSV with it, then run npm run instacomp:trial:groundtruth:apply.";
    }

    for (const input of document.querySelectorAll("input[data-column]")) {
      input.addEventListener("input", () => {
        const row = input.closest("tr");
        if (row) updateRowStatus(row);
        updateSummary();
      });
    }
    for (const row of document.querySelectorAll("tbody tr")) updateRowStatus(row);
    updateSummary();
    document.getElementById("copyTsv")?.addEventListener("click", copyUpdatedTsv);
    document.getElementById("downloadTsv")?.addEventListener("click", downloadUpdatedTsv);
  </script>
</body>
</html>
`;
}

async function main() {
  const manifestInput = getFlagValue("--manifest", "instacomp-trial-manifest.local.json");
  const worksheetInput = getFlagValue("--worksheet", "instacomp-trial-groundtruth.local.tsv");
  const outputInput = getFlagValue("--output", "instacomp-trial-answer-key.local.html");

  const { resolved: manifestPath, data: manifest } = await readJson(manifestInput);
  if (manifest?.schema !== "tcos.instacompTrialManifest.v1" || !Array.isArray(manifest.cards)) {
    throw new Error("Manifest must use schema tcos.instacompTrialManifest.v1 and include cards.");
  }

  const worksheet = await readWorksheetRows(worksheetInput);
  const rows = buildRows(manifest, manifestPath, worksheet);
  const outputPath = resolveFromRepo(outputInput);
  const readyRows = rows.filter((row) => row.ready).length;
  const report = {
    schema: "tcos.instacompTrialAnswerKeyHtml.v1",
    generatedAt: new Date().toISOString(),
    sideEffectBoundary:
      "Local answer-key HTML guide only. Does not scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, mutate images, or apply worksheet values.",
    manifestPath,
    outputPath,
    worksheet: {
      path: worksheet.path,
      relativePath: worksheetInput,
      exists: worksheet.exists,
      headerCount: worksheet.headers.length,
      duplicateTrialCardIds: worksheet.duplicateTrialCardIds || [],
    },
    expectedCards: rows.length,
    readyRows,
    missingCoreRows: rows.length - readyRows,
    frontImagesExisting: rows.filter((row) => row.front.exists).length,
    backImagesExisting: rows.filter((row) => row.back.exists).length,
    firstMissingRows: rows
      .filter((row) => !row.ready)
      .slice(0, 10)
      .map((row) => ({
        trialCardId: row.trialCardId,
        rowNumber: row.rowNumber,
        missing: row.missingCoreFields,
      })),
    rows,
    next:
      readyRows === rows.length
        ? "Run npm run instacomp:trial:groundtruth:apply, then npm run instacomp:trial:intake."
        : "Fill the missing TSV answer-key fields, save the worksheet, then rerun npm run instacomp:trial:answer-key-html.",
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildHtml(report));

  if (jsonOutput) {
    console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
    return;
  }

  console.log("TCOS InstaComp trial answer-key HTML written:");
  console.log(`- output: ${outputPath}`);
  console.log(`- manifest: ${manifestPath}`);
  console.log(`- worksheet: ${worksheet.exists ? worksheet.path : "missing"}`);
  console.log(`- answer-key rows: ${readyRows}/${rows.length} core-ready`);
  console.log(`- front images: ${report.frontImagesExisting}/${rows.length}`);
  console.log(`- back images: ${report.backImagesExisting}/${rows.length}`);
  if (report.firstMissingRows.length) {
    console.log(
      `- first missing rows: ${report.firstMissingRows
        .slice(0, 5)
        .map((row) => `${row.trialCardId} missing ${row.missing.join("/")}`)
        .join(", ")}`,
    );
  }
  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.sideEffectBoundary}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
