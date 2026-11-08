import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = process.argv.slice(2);
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

function readPositiveIntegerFlag(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = getFlagValue(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}.`);
  }
  return value;
}

function resolveFromRepo(input) {
  return resolve(repoRoot, input);
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

async function listSourceImages(sourceDir) {
  if (!existsSync(sourceDir)) return { exists: false, files: [], skipped: [] };

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = [];
  const skipped = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!imageExtensions.has(extension)) {
      skipped.push({ file: entry.name, reason: "not an accepted image extension" });
      continue;
    }
    files.push(entry.name);
  }

  return { exists: true, files, skipped };
}

function buildStagePlan({ files, expectedCards, sourceDir, targetDir }) {
  const explicitGroups = new Map();
  const orderedFiles = [];
  const unknownFiles = [];

  for (const file of files) {
    const side = sideFromFilename(file);
    if (!side) {
      orderedFiles.push(file);
      continue;
    }

    const ordinal = trialNumberFromFilename(file);
    if (!ordinal) {
      unknownFiles.push({ file, reason: "side token present but card number missing" });
      continue;
    }

    const group = explicitGroups.get(ordinal) || { ordinal, front: [], back: [] };
    group[side].push(file);
    explicitGroups.set(ordinal, group);
  }

  const sortedOrderedFiles = orderedFiles.sort(naturalFileSort);
  const rows = [];
  const blockers = [];
  const copies = [];

  for (let card = 1; card <= expectedCards; card += 1) {
    const ordinal = padTrialNumber(card);
    const group = explicitGroups.get(ordinal) || { ordinal, front: [], back: [] };
    const orderedFront = sortedOrderedFiles[(card - 1) * 2] || null;
    const orderedBack = sortedOrderedFiles[(card - 1) * 2 + 1] || null;
    const frontCandidates = [...group.front, orderedFront].filter(Boolean);
    const backCandidates = [...group.back, orderedBack].filter(Boolean);
    const rowBlockers = [];

    if (frontCandidates.length === 0) rowBlockers.push("missing front");
    if (backCandidates.length === 0) rowBlockers.push("missing back");
    if (frontCandidates.length > 1) rowBlockers.push("duplicate front candidates");
    if (backCandidates.length > 1) rowBlockers.push("duplicate back candidates");

    const front = frontCandidates.length === 1 ? frontCandidates[0] : null;
    const back = backCandidates.length === 1 ? backCandidates[0] : null;

    const frontTarget = front
      ? `${ordinal}-front${path.extname(front).toLowerCase()}`
      : null;
    const backTarget = back ? `${ordinal}-back${path.extname(back).toLowerCase()}` : null;

    const row = {
      trialCardId: `trial-card-${ordinal}`,
      ordinal,
      frontSource: front,
      backSource: back,
      frontTarget,
      backTarget,
      frontSourceMode: group.front.includes(front) ? "explicit_filename" : front ? "ordered_pair" : null,
      backSourceMode: group.back.includes(back) ? "explicit_filename" : back ? "ordered_pair" : null,
      blockers: rowBlockers,
    };
    rows.push(row);

    if (rowBlockers.length > 0) {
      blockers.push({
        key: "row_not_stageable",
        trialCardId: row.trialCardId,
        blockers: rowBlockers,
        frontCandidates,
        backCandidates,
      });
      continue;
    }

    copies.push({
      trialCardId: row.trialCardId,
      side: "front",
      from: path.join(sourceDir, front),
      to: path.join(targetDir, frontTarget),
      sourceFile: front,
      targetFile: frontTarget,
    });
    copies.push({
      trialCardId: row.trialCardId,
      side: "back",
      from: path.join(sourceDir, back),
      to: path.join(targetDir, backTarget),
      sourceFile: back,
      targetFile: backTarget,
    });
  }

  const expectedOrdinals = new Set(
    Array.from({ length: expectedCards }, (_, index) => padTrialNumber(index + 1)),
  );
  const extraExplicitFiles = [...explicitGroups.values()]
    .filter((group) => !expectedOrdinals.has(group.ordinal))
    .flatMap((group) =>
      [...group.front, ...group.back].map((file) => ({
        file,
        parsedCardNumber: group.ordinal,
      })),
    );
  const unpairedOrderedFiles = sortedOrderedFiles.slice(expectedCards * 2).map((file) => ({
    file,
    reason: "ordered image has no matching trial-card slot",
  }));

  for (const file of unknownFiles) {
    blockers.push({ key: "unknown_source_file", ...file });
  }
  for (const file of extraExplicitFiles) {
    blockers.push({ key: "extra_explicit_source_file", ...file });
  }
  for (const file of unpairedOrderedFiles) {
    blockers.push({ key: "unpaired_ordered_source_file", ...file });
  }

  return {
    rows,
    copies,
    blockers,
    observed: {
      sourceImageFiles: files.length,
      orderedPairCandidateFiles: sortedOrderedFiles.length,
      explicitPairFiles: [...explicitGroups.values()].reduce(
        (sum, group) => sum + group.front.length + group.back.length,
        0,
      ),
      stageableCards: rows.filter((row) => row.blockers.length === 0).length,
      plannedCopies: copies.length,
      unknownFiles: unknownFiles.length,
      extraExplicitFiles: extraExplicitFiles.length,
      unpairedOrderedFiles: unpairedOrderedFiles.length,
    },
  };
}

function buildMarkdown(report) {
  const previewRows = report.rows.slice(0, 25);
  return [
    "# TCOS InstaComp™ Trial Image Stage Receipt",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.safeBuildBoundary,
    "",
    "## Status",
    "",
    `- Apply mode: ${report.apply ? "YES" : "NO - dry run"}`,
    `- Ready to apply: ${report.readyToApply ? "YES" : "NO"}`,
    `- Applied: ${report.applied ? "YES" : "NO"}`,
    `- Source: ${report.paths.source}`,
    `- Target: ${report.paths.target}`,
    `- Source image files: ${report.observed.sourceImageFiles}`,
    `- Stageable cards: ${report.observed.stageableCards}/${report.expected.cards}`,
    `- Planned copies: ${report.observed.plannedCopies}/${report.expected.images}`,
    `- Blockers: ${report.blockers.length}`,
    "",
    "## Pairing preview",
    "",
    "| Trial card | Front source | Front target | Back source | Back target | Blockers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...previewRows.map(
      (row) =>
        `| ${markdownCell(row.trialCardId)} | ${markdownCell(row.frontSource)} | ${markdownCell(row.frontTarget)} | ${markdownCell(row.backSource)} | ${markdownCell(row.backTarget)} | ${markdownCell(row.blockers.join(", "))} |`,
    ),
    "",
    previewRows.length < report.rows.length
      ? `Showing first ${previewRows.length} of ${report.rows.length} rows. Use the JSON receipt for the full plan.`
      : "Showing all rows.",
    "",
    "## Next",
    "",
    report.next,
    "",
  ].join("\n");
}

async function main() {
  const expectedCards = readPositiveIntegerFlag("--expected-cards", 100, { min: 1, max: 10000 });
  const sourceInput = getFlagValue("--source", "instacomp-trial-inbox");
  const targetInput = getFlagValue("--target", "instacomp-trial-images");
  const receiptJsonInput = getFlagValue("--receipt-json", "instacomp-trial-stage.local.json");
  const receiptMdInput = getFlagValue("--receipt-md", "instacomp-trial-stage.local.md");
  const apply = hasFlag("--apply");
  const overwrite = hasFlag("--overwrite");
  const jsonOutput = hasFlag("--json");

  const sourceDir = resolveFromRepo(sourceInput);
  const targetDir = resolveFromRepo(targetInput);
  const source = await listSourceImages(sourceDir);
  const plan = buildStagePlan({
    files: source.files,
    expectedCards,
    sourceDir,
    targetDir,
  });
  const blockers = [...plan.blockers];

  if (!source.exists) {
    blockers.unshift({
      key: "source_folder_missing",
      label: `Source folder does not exist: ${sourceDir}`,
      next: `Create ${sourceInput}, copy scanner files into it, then rerun npm run instacomp:trial:stage-images.`,
    });
  }

  if (apply) {
    for (const copy of plan.copies) {
      if (!overwrite && existsSync(copy.to)) {
        blockers.push({
          key: "target_file_exists",
          file: copy.targetFile,
          next: "Move existing target files, choose a clean target folder, or rerun with --overwrite.",
        });
      }
    }
  }

  const readyToApply =
    source.exists &&
    blockers.length === 0 &&
    plan.observed.stageableCards === expectedCards &&
    plan.observed.plannedCopies === expectedCards * 2;

  let applied = false;
  if (apply && readyToApply) {
    await mkdir(targetDir, { recursive: true });
    for (const copy of plan.copies) {
      await copyFile(copy.from, copy.to);
    }
    applied = true;
  }

  const report = {
    schema: "tcos.instacompTrialImageStage.v1",
    generatedAt: new Date().toISOString(),
    apply,
    overwrite,
    readyToApply,
    applied,
    paths: {
      source: sourceDir,
      target: targetDir,
      receiptJson: receiptJsonInput,
      receiptMarkdown: receiptMdInput,
    },
    expected: {
      cards: expectedCards,
      images: expectedCards * 2,
    },
    acceptedImageExtensions: [...imageExtensions],
    acceptedSideWords: {
      front: [...frontTokens],
      back: [...backTokens],
    },
    observed: {
      ...plan.observed,
      skippedNonImages: source.skipped.length,
    },
    blockers,
    skippedNonImages: source.skipped,
    rows: plan.rows,
    copies: plan.copies.map((copy) => ({
      trialCardId: copy.trialCardId,
      side: copy.side,
      sourceFile: copy.sourceFile,
      targetFile: copy.targetFile,
    })),
    next: applied
      ? "Images staged. Run npm run instacomp:trial:prep, then npm run instacomp:trial:monitor."
      : readyToApply
        ? "Dry run is clean. Rerun with npm run instacomp:trial:stage-images -- --apply to copy normalized images."
        : blockers[0]?.next ||
          "Fix the listed image staging blockers, then rerun npm run instacomp:trial:stage-images.",
    safeBuildBoundary:
      "Local InstaComp™ trial image staging only. Does not delete source files, scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };

  const receiptJsonPath = resolveFromRepo(receiptJsonInput);
  const receiptMdPath = resolveFromRepo(receiptMdInput);
  await mkdir(dirname(receiptJsonPath), { recursive: true });
  await mkdir(dirname(receiptMdPath), { recursive: true });
  await writeFile(receiptJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(receiptMdPath, buildMarkdown(report));

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("TCOS InstaComp™ trial image staging:");
    console.log(`- source: ${report.paths.source}`);
    console.log(`- target: ${report.paths.target}`);
    console.log(`- mode: ${report.apply ? "apply" : "dry run"}`);
    console.log(`- ready to apply: ${report.readyToApply ? "yes" : "no"}`);
    console.log(`- applied: ${report.applied ? "yes" : "no"}`);
    console.log(`- source images: ${report.observed.sourceImageFiles}/${report.expected.images}`);
    console.log(`- stageable cards: ${report.observed.stageableCards}/${report.expected.cards}`);
    console.log(`- planned copies: ${report.observed.plannedCopies}/${report.expected.images}`);
    console.log(`- blockers: ${report.blockers.length}`);
    console.log(`- receipt JSON: ${report.paths.receiptJson}`);
    console.log(`- receipt Markdown: ${report.paths.receiptMarkdown}`);
    if (report.blockers.length > 0) {
      console.log("- first blockers:");
      for (const blocker of report.blockers.slice(0, 10)) {
        console.log(`  - ${blocker.key}: ${blocker.label || blocker.trialCardId || blocker.file}`);
      }
    }
    console.log(`Next: ${report.next}`);
    console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
