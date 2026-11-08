import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
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

function resolveFromRepo(input) {
  return resolve(repoRoot, input);
}

async function readJsonFile(filePath) {
  const resolved = resolveFromRepo(filePath);
  const raw = await readFile(resolved, "utf8");
  return { resolved, data: JSON.parse(raw) };
}

function validateManifest(manifest) {
  if (manifest?.schema !== "tcos.instacompTrialManifest.v1") {
    throw new Error("Manifest schema must be tcos.instacompTrialManifest.v1");
  }
  if (!Array.isArray(manifest.cards)) {
    throw new Error("Manifest must include a cards array.");
  }
}

function validateImageMap(imageMap) {
  if (imageMap?.schema !== "tcos.instacompTrialImageMap.v1") {
    throw new Error("Image map schema must be tcos.instacompTrialImageMap.v1");
  }
  if (!Array.isArray(imageMap.rows)) {
    throw new Error("Image map must include a rows array.");
  }
}

function normalizePrefix(prefix) {
  const raw = String(prefix || "./instacomp-trial-images").trim() || "./instacomp-trial-images";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function imagePath(prefix, file) {
  if (!file) return "";
  return `${prefix}${file}`;
}

function syncManifestImages(manifest, imageMap, prefix) {
  const rowsById = new Map(
    imageMap.rows.map((row) => [String(row.trialCardId || ""), row]),
  );
  const missingMapRows = [];
  const missingFronts = [];
  const missingBacks = [];
  let updatedRows = 0;
  let changedFields = 0;

  const cards = manifest.cards.map((card, index) => {
    const trialCardId = String(card.trialCardId || `trial-card-${String(index + 1).padStart(3, "0")}`);
    const row = rowsById.get(trialCardId);
    if (!row) {
      missingMapRows.push(trialCardId);
      return card;
    }

    if (!row.frontImage) missingFronts.push(trialCardId);
    if (!row.backImage) missingBacks.push(trialCardId);

    const nextFront = imagePath(prefix, row.frontImage);
    const nextBack = imagePath(prefix, row.backImage);
    const nextCard = { ...card };
    let changed = false;

    if (nextFront && nextCard.frontImage !== nextFront) {
      nextCard.frontImage = nextFront;
      changed = true;
      changedFields += 1;
    }
    if (nextBack && nextCard.backImage !== nextBack) {
      nextCard.backImage = nextBack;
      changed = true;
      changedFields += 1;
    }
    if (changed) updatedRows += 1;

    return nextCard;
  });

  return {
    manifest: {
      ...manifest,
      cards,
    },
    observed: {
      manifestRows: manifest.cards.length,
      imageMapRows: imageMap.rows.length,
      updatedRows,
      changedFields,
      completeImagePairs: imageMap.rows.filter((row) => row.frontImage && row.backImage).length,
    },
    problems: {
      missingMapRows,
      missingFronts,
      missingBacks,
    },
  };
}

function parseTsv(text) {
  const lines = String(text || "").split(/\r?\n/);
  const headerLine = lines.shift();
  if (!headerLine) throw new Error("Worksheet is empty.");
  const headers = headerLine.split("\t");
  const rows = lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells = line.split("\t");
      const row = {};
      for (const [index, header] of headers.entries()) {
        row[header] = cells[index] ?? "";
      }
      return row;
    });
  return { headers, rows };
}

function tsvCell(value) {
  return String(value ?? "")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

async function syncWorksheetImages(worksheetPath, imageMap, prefix) {
  const resolved = resolveFromRepo(worksheetPath);
  if (!existsSync(resolved)) {
    return {
      exists: false,
      path: resolved,
      updatedRows: 0,
      changedFields: 0,
      missingColumns: [],
    };
  }

  const { headers, rows } = parseTsv(await readFile(resolved, "utf8"));
  const missingColumns = ["trialCardId", "frontImage", "backImage"].filter(
    (column) => !headers.includes(column),
  );
  if (missingColumns.length > 0) {
    return {
      exists: true,
      path: resolved,
      updatedRows: 0,
      changedFields: 0,
      missingColumns,
    };
  }

  const rowsById = new Map(
    imageMap.rows.map((row) => [String(row.trialCardId || ""), row]),
  );
  let updatedRows = 0;
  let changedFields = 0;
  const nextRows = rows.map((row) => {
    const mapRow = rowsById.get(String(row.trialCardId || ""));
    if (!mapRow) return row;

    const nextFront = imagePath(prefix, mapRow.frontImage);
    const nextBack = imagePath(prefix, mapRow.backImage);
    let changed = false;
    const nextRow = { ...row };

    if (nextFront && nextRow.frontImage !== nextFront) {
      nextRow.frontImage = nextFront;
      changed = true;
      changedFields += 1;
    }
    if (nextBack && nextRow.backImage !== nextBack) {
      nextRow.backImage = nextBack;
      changed = true;
      changedFields += 1;
    }
    if (changed) updatedRows += 1;
    return nextRow;
  });

  const output = [
    headers.join("\t"),
    ...nextRows.map((row) => headers.map((header) => tsvCell(row[header])).join("\t")),
  ].join("\n");
  await writeFile(resolved, `${output}\n`);

  return {
    exists: true,
    path: resolved,
    updatedRows,
    changedFields,
    missingColumns: [],
  };
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function buildMarkdown(report) {
  const rows = report.previewRows || [];
  return [
    "# TCOS InstaComp™ Trial Image Path Sync",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.safeBuildBoundary,
    "",
    "## Status",
    "",
    `- OK: ${report.ok ? "YES" : "NO"}`,
    `- Manifest rows: ${report.observed.manifestRows}`,
    `- Image-map rows: ${report.observed.imageMapRows}`,
    `- Complete image pairs: ${report.observed.completeImagePairs}`,
    `- Manifest rows updated: ${report.observed.updatedRows}`,
    `- Manifest fields changed: ${report.observed.changedFields}`,
    `- Worksheet synced: ${report.worksheet.exists ? "YES" : "NO - worksheet missing"}`,
    `- Worksheet rows updated: ${report.worksheet.updatedRows}`,
    `- Worksheet fields changed: ${report.worksheet.changedFields}`,
    "",
    "## Preview",
    "",
    "| Trial card | Front image | Back image |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${markdownCell(row.trialCardId)} | ${markdownCell(row.frontImage)} | ${markdownCell(row.backImage)} |`,
    ),
    "",
    "## Next",
    "",
    report.next,
    "",
  ].join("\n");
}

async function main() {
  const manifestPath = getFlagValue("--manifest", "instacomp-trial-manifest.local.json");
  const imageMapPath = getFlagValue("--image-map", "instacomp-trial-image-map.local.json");
  const worksheetPath = getFlagValue("--worksheet", "instacomp-trial-groundtruth.local.tsv");
  const receiptJsonPath = getFlagValue("--receipt-json", "instacomp-trial-image-path-sync.local.json");
  const receiptMdPath = getFlagValue("--receipt-md", "instacomp-trial-image-path-sync.local.md");
  const manifestOutputPath = getFlagValue("--write-manifest", manifestPath);
  const prefix = normalizePrefix(getFlagValue("--image-prefix", "./instacomp-trial-images"));
  const noWorksheet = hasFlag("--no-worksheet");
  const jsonOutput = hasFlag("--json");

  const { resolved: resolvedManifestPath, data: manifest } = await readJsonFile(
    manifestPath,
  );
  const { resolved: resolvedImageMapPath, data: imageMap } = await readJsonFile(
    imageMapPath,
  );
  validateManifest(manifest);
  validateImageMap(imageMap);

  const sync = syncManifestImages(manifest, imageMap, prefix);
  const resolvedManifestOutputPath = resolveFromRepo(manifestOutputPath);
  await mkdir(dirname(resolvedManifestOutputPath), { recursive: true });
  await writeFile(resolvedManifestOutputPath, `${JSON.stringify(sync.manifest, null, 2)}\n`);

  const worksheet = noWorksheet
    ? {
        exists: false,
        path: resolveFromRepo(worksheetPath),
        updatedRows: 0,
        changedFields: 0,
        missingColumns: [],
        skipped: true,
      }
    : await syncWorksheetImages(worksheetPath, imageMap, prefix);

  const ok =
    sync.problems.missingMapRows.length === 0 &&
    sync.problems.missingFronts.length === 0 &&
    sync.problems.missingBacks.length === 0 &&
    worksheet.missingColumns.length === 0;

  const report = {
    schema: "tcos.instacompTrialImagePathSync.v1",
    generatedAt: new Date().toISOString(),
    ok,
    paths: {
      manifest: resolvedManifestPath,
      imageMap: resolvedImageMapPath,
      writtenManifest: resolvedManifestOutputPath,
      worksheet: worksheet.path,
      receiptJson: receiptJsonPath,
      receiptMarkdown: receiptMdPath,
    },
    imagePrefix: prefix,
    observed: sync.observed,
    problems: sync.problems,
    worksheet,
    previewRows: sync.manifest.cards.slice(0, 10).map((card) => ({
      trialCardId: card.trialCardId,
      frontImage: card.frontImage,
      backImage: card.backImage,
    })),
    next: ok
      ? "Image paths are synced. Run npm run instacomp:trial:groundtruth:sheet if you need a fresh blank sheet, or keep filling the existing worksheet and run npm run instacomp:trial:monitor."
      : "Fix missing image-map rows/fronts/backs or worksheet columns, then rerun npm run instacomp:trial:sync-images.",
    safeBuildBoundary:
      "Local InstaComp™ trial image-path sync only. Updates local manifest image paths and optional local worksheet image columns; does not change answer-key identity fields, scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };

  const resolvedReceiptJsonPath = resolveFromRepo(receiptJsonPath);
  const resolvedReceiptMdPath = resolveFromRepo(receiptMdPath);
  await mkdir(dirname(resolvedReceiptJsonPath), { recursive: true });
  await mkdir(dirname(resolvedReceiptMdPath), { recursive: true });
  await writeFile(resolvedReceiptJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolvedReceiptMdPath, buildMarkdown(report));

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("TCOS InstaComp™ trial image-path sync:");
  console.log(`- ok: ${report.ok ? "yes" : "no"}`);
  console.log(`- manifest: ${report.paths.writtenManifest}`);
  console.log(`- image map: ${report.paths.imageMap}`);
  console.log(`- manifest rows updated: ${report.observed.updatedRows}/${report.observed.manifestRows}`);
  console.log(`- manifest fields changed: ${report.observed.changedFields}`);
  console.log(`- complete image pairs: ${report.observed.completeImagePairs}/${report.observed.imageMapRows}`);
  console.log(`- worksheet synced: ${report.worksheet.exists ? "yes" : "no"}`);
  console.log(`- worksheet rows updated: ${report.worksheet.updatedRows}`);
  console.log(`- worksheet fields changed: ${report.worksheet.changedFields}`);
  console.log(`- receipt JSON: ${report.paths.receiptJson}`);
  console.log(`- receipt Markdown: ${report.paths.receiptMarkdown}`);
  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
