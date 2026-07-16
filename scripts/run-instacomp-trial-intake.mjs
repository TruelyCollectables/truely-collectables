import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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

function runJsonStep(label, script, scriptArgs, { allowFailure = false } = {}) {
  const result = spawnSync("node", [script, ...scriptArgs, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  try {
    return {
      label,
      ok: result.status === 0,
      exitStatus: result.status,
      payload: JSON.parse(stdout),
      stderr,
    };
  } catch (error) {
    if (!allowFailure) {
      throw new Error(
        `${label} did not return parseable JSON: ${
          error instanceof Error ? error.message : String(error)
        }\n${stdout}\n${stderr}`.trim(),
      );
    }

    return {
      label,
      ok: false,
      exitStatus: result.status,
      payload: null,
      stderr:
        stderr ||
        `Could not parse JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function firstBlockerFrom(stage, prep, sync) {
  const stageBlockers = Array.isArray(stage?.payload?.blockers) ? stage.payload.blockers : [];
  if (stageBlockers.length > 0) return stageBlockers[0];

  const prepBlockers = Array.isArray(prep?.payload?.preflight?.blockers)
    ? prep.payload.preflight.blockers
    : [];
  if (prepBlockers.length > 0) return prepBlockers[0];

  const syncProblems = sync?.payload?.problems || {};
  if (Array.isArray(syncProblems.missingFronts) && syncProblems.missingFronts.length > 0) {
    return { key: "sync_missing_fronts", label: `${syncProblems.missingFronts.length} front images missing` };
  }
  if (Array.isArray(syncProblems.missingBacks) && syncProblems.missingBacks.length > 0) {
    return { key: "sync_missing_backs", label: `${syncProblems.missingBacks.length} back images missing` };
  }
  return null;
}

function buildNext(report) {
  const stage = report.steps.stageImages?.payload;
  const prep = report.steps.prepTrial?.payload;
  const sync = report.steps.syncImages?.payload;

  if (stage?.readyToApply && !stage?.applied) {
    return "Image staging dry-run is clean. Run npm run instacomp:trial:stage-images -- --apply, then rerun npm run instacomp:trial:intake.";
  }
  if (stage?.observed?.sourceImageFiles === 0) {
    return `Copy scanner files into ${report.paths.source}, then rerun npm run instacomp:trial:intake.`;
  }
  if (stage && !stage.readyToApply) {
    return stage.next || "Fix image staging blockers, then rerun npm run instacomp:trial:intake.";
  }
  if (prep && prep.readyToScan === false) {
    return prep.next || "Fix prep/preflight blockers, then rerun npm run instacomp:trial:intake.";
  }
  if (sync && sync.ok === false) {
    return sync.next || "Fix image-path sync blockers, then rerun npm run instacomp:trial:intake.";
  }
  return "Trial intake is ready. Run npm run instacomp:trial:monitor, then scan at http://localhost:3000/admin/instacomp when the monitor is green.";
}

function buildMarkdown(report) {
  const stage = report.steps.stageImages?.payload || {};
  const prep = report.steps.prepTrial?.payload || {};
  const sync = report.steps.syncImages?.payload || {};
  const blockers = report.blockers || [];

  return [
    "# TCOS InstaComp Trial Intake Cockpit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.safeBuildBoundary,
    "",
    "## Status",
    "",
    `- Ready to apply staged images: ${stage.readyToApply ? "YES" : "NO"}`,
    `- Images applied by cockpit: ${stage.applied ? "YES" : "NO"}`,
    `- Prep ready to scan: ${prep.readyToScan ? "YES" : "NO"}`,
    `- Image paths synced OK: ${sync.ok ? "YES" : "NO"}`,
    `- Stageable cards: ${stage.observed?.stageableCards ?? 0}/${stage.expected?.cards ?? report.expectedCards}`,
    `- Planned copies: ${stage.observed?.plannedCopies ?? 0}/${stage.expected?.images ?? report.expectedCards * 2}`,
    `- Synced image pairs: ${sync.observed?.completeImagePairs ?? 0}/${sync.observed?.imageMapRows ?? report.expectedCards}`,
    `- Folders ensured: ${report.folderPrep.ensured ? "YES" : "NO"}`,
    `- Inbox guide: ${report.folderPrep.guides?.sourceGuide || "not written"}`,
    `- Target guide: ${report.folderPrep.guides?.targetGuide || "not written"}`,
    "",
    "## Paths",
    "",
    `- Source inbox: ${report.paths.source}`,
    `- Target images: ${report.paths.target}`,
    `- Manifest: ${report.paths.manifest}`,
    `- Worksheet: ${report.paths.worksheet}`,
    `- Intake JSON: ${report.paths.intakeJson}`,
    `- Intake Markdown: ${report.paths.intakeMarkdown}`,
    "",
    "## First blockers",
    "",
    ...(blockers.length
      ? [
          "| Step | Blocker | Detail |",
          "| --- | --- | --- |",
          ...blockers
            .slice(0, 10)
            .map(
              (blocker) =>
                `| ${markdownCell(blocker.step)} | ${markdownCell(blocker.key)} | ${markdownCell(blocker.label || blocker.trialCardId || blocker.file || blocker.next || "")} |`,
            ),
        ]
      : ["No blockers found by the intake cockpit."]),
    "",
    "## Next",
    "",
    report.next,
    "",
  ].join("\n");
}

function buildSourceGuide({ expectedCards, sourcePath, targetPath }) {
  return [
    "TCOS InstaComp Trial Inbox",
    "",
    "Drop raw scanner exports for the 100-card trial in this folder.",
    "",
    `Expected lot: ${expectedCards} cards / ${Number(expectedCards) * 2} images`,
    "",
    "Accepted patterns:",
    "- Plain ordered scanner files: scan_0001.jpg, scan_0002.jpg, scan_0003.jpg...",
    "  TCOS pairs them as 1+2, 3+4, 5+6, etc.",
    "- Explicit pairs: 001-front.jpg + 001-back.jpg through 100-front.jpg + 100-back.jpg",
    "- Side words accepted: front, fr, f, obverse, back, bk, b, reverse, rear",
    "- Image extensions accepted: jpg, jpeg, png, webp, heic, heif, gif, bmp, tif, tiff",
    "",
    "Next command from the repo root:",
    "npm run instacomp:trial:intake",
    "",
    "When the dry-run is clean, the cockpit will tell you to run:",
    "npm run instacomp:trial:stage-images -- --apply",
    "",
    `Source inbox: ${sourcePath}`,
    `Normalized target folder: ${targetPath}`,
    "",
    "Safe boundary: local trial intake only. This folder guide does not scan cards, deploy, publish listings, buy postage, create Checkout, approve live money, or release payouts.",
    "",
  ].join("\n");
}

function buildTargetGuide({ expectedCards, sourcePath, targetPath }) {
  return [
    "TCOS InstaComp Trial Images",
    "",
    "This folder is for normalized trial image pairs used by the 100-card InstaComp final tester.",
    "",
    `Expected lot: ${expectedCards} cards / ${Number(expectedCards) * 2} images`,
    "",
    "Preferred normalized shape:",
    "- 001-front.jpg",
    "- 001-back.jpg",
    "- 002-front.jpg",
    "- 002-back.jpg",
    "- ... through 100-front / 100-back",
    "",
    "If your scanner files are raw/unrenamed, put them in the inbox first:",
    sourcePath,
    "",
    "Then run from the repo root:",
    "npm run instacomp:trial:intake",
    "",
    "After apply/prep/sync, monitor readiness with:",
    "npm run instacomp:trial:monitor",
    "",
    `Normalized target folder: ${targetPath}`,
    "",
    "Safe boundary: local trial intake only. This folder guide does not scan cards, deploy, publish listings, buy postage, create Checkout, approve live money, or release payouts.",
    "",
  ].join("\n");
}

function buildGroundTruthGuide(report) {
  const manifestAudit = report.steps.prepTrial?.payload?.preflight?.manifestAudit || {};
  const problems = manifestAudit.problems || {};
  const firstMissingRows = Array.isArray(problems.firstMissingCoreRows)
    ? problems.firstMissingCoreRows
    : [];
  const expectedCards = manifestAudit.expectedCards || report.expectedCards;
  const readyRows = manifestAudit.readyRows || 0;

  return [
    "# TCOS InstaComp Trial Answer-Key Guide",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Fill this before trusting the 94% final tester score.",
    "",
    "## Progress",
    "",
    `- Ready answer-key rows: ${readyRows}/${expectedCards}`,
    `- Missing core rows: ${problems.missingCoreRows ?? "unknown"}`,
    `- Duplicate trialCardId rows: ${problems.duplicateTrialCardIds ?? "unknown"}`,
    `- Missing trialCardId rows: ${problems.missingTrialCardIds ?? "unknown"}`,
    "",
    "## Required columns",
    "",
    "These four fields are required for every row:",
    "",
    "- player",
    "- year",
    "- setName",
    "- cardNumber",
    "",
    "Strongly recommended fields:",
    "",
    "- brand",
    "- parallel",
    "- variation",
    "- serialNumber",
    "- serialRun",
    "- team",
    "- sport",
    "- isRookie",
    "- isAuto",
    "- isRelic",
    "",
    "## Examples",
    "",
    "| player | year | setName | cardNumber | brand | parallel | serialNumber | serialRun |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| Connor McDavid | 2025-26 | SP Authentic Hockey Outliers | O-8 | Upper Deck | Outliers |  |  |",
    "| Seth Jarvis | 2025-26 | Upper Deck Extended Series Clear Cut | UD3-28 | Upper Deck | Clear Cut |  |  |",
    "| Matthew Robertson | 2025-26 | SP Authentic Future Watch Spectrum FX Level 1 | S-50 | Upper Deck | Spectrum FX Level 1 |  |  |",
    "",
    "## First missing rows",
    "",
    ...(firstMissingRows.length
      ? [
          "| Trial card | Spreadsheet row | Missing fields |",
          "| --- | ---: | --- |",
          ...firstMissingRows.map(
            (row) =>
              `| ${markdownCell(row.trialCardId)} | ${markdownCell(row.row)} | ${markdownCell((row.missing || []).join(", "))} |`,
          ),
        ]
      : ["No missing core rows reported by the latest intake preflight."]),
    "",
    "## Commands",
    "",
    "Optional visual review sheet for faster filling:",
    "",
    "```bash",
    "npm run instacomp:trial:answer-key-html",
    "```",
    "",
    "After editing the TSV:",
    "",
    "```bash",
    "npm run instacomp:trial:groundtruth:apply",
    "npm run instacomp:trial:intake",
    "npm run instacomp:trial:monitor",
    "```",
    "",
    "Safe boundary: local answer-key guide only. Does not scan cards, deploy, publish listings, buy postage, create Checkout, approve live money, or release payouts.",
    "",
  ].join("\n");
}

async function main() {
  const expectedCards = getFlagValue("--expected-cards", "100");
  const source = getFlagValue("--source", "instacomp-trial-inbox");
  const target = getFlagValue("--target", "instacomp-trial-images");
  const manifest = getFlagValue("--manifest", "instacomp-trial-manifest.local.json");
  const worksheet = getFlagValue("--worksheet", "instacomp-trial-groundtruth.local.tsv");
  const imageMap = getFlagValue("--image-map", "instacomp-trial-image-map.local.json");
  const intakePacket = getFlagValue("--intake-packet", "instacomp-trial-intake-packet.local.md");
  const preflightJson = getFlagValue("--preflight-json", "instacomp-trial-preflight.local.json");
  const preflightMd = getFlagValue("--preflight-md", "instacomp-trial-preflight.local.md");
  const stageReceiptJson = getFlagValue("--stage-receipt-json", "instacomp-trial-stage.local.json");
  const stageReceiptMd = getFlagValue("--stage-receipt-md", "instacomp-trial-stage.local.md");
  const syncReceiptJson = getFlagValue(
    "--sync-receipt-json",
    "instacomp-trial-image-path-sync.local.json",
  );
  const syncReceiptMd = getFlagValue(
    "--sync-receipt-md",
    "instacomp-trial-image-path-sync.local.md",
  );
  const syncWriteManifest = getFlagValue("--sync-write-manifest", manifest);
  const intakeJson = getFlagValue("--intake-json", "instacomp-trial-intake.local.json");
  const intakeMarkdown = getFlagValue("--intake-md", "instacomp-trial-intake.local.md");
  const answerKeyGuide = getFlagValue(
    "--answer-key-guide",
    "instacomp-trial-groundtruth-guide.local.md",
  );
  const imagePrefix = getFlagValue("--image-prefix", `./${target}`);
  const jsonOutput = hasFlag("--json");
  const ensureFolders = !hasFlag("--no-ensure-folders");
  const sourcePath = resolveFromRepo(source);
  const targetPath = resolveFromRepo(target);
  const folderPrep = {
    ensured: ensureFolders,
    source: sourcePath,
    target: targetPath,
    guides: {
      sourceGuide: resolve(sourcePath, "README_TCOS_INSTACOMP_TRIAL.txt"),
      targetGuide: resolve(targetPath, "README_TCOS_INSTACOMP_TRIAL.txt"),
    },
    safeLocalOnly: true,
  };

  if (ensureFolders) {
    await mkdir(sourcePath, { recursive: true });
    await mkdir(targetPath, { recursive: true });
    await writeFile(
      folderPrep.guides.sourceGuide,
      buildSourceGuide({ expectedCards, sourcePath, targetPath }),
    );
    await writeFile(
      folderPrep.guides.targetGuide,
      buildTargetGuide({ expectedCards, sourcePath, targetPath }),
    );
  }

  const stageImages = runJsonStep(
    "stage images dry-run",
    "scripts/stage-instacomp-trial-images.mjs",
    [
      "--source",
      source,
      "--target",
      target,
      "--receipt-json",
      stageReceiptJson,
      "--receipt-md",
      stageReceiptMd,
      "--expected-cards",
      expectedCards,
    ],
    { allowFailure: true },
  );

  const prepTrial = runJsonStep(
    "prep trial bundle",
    "scripts/prepare-instacomp-trial.mjs",
    [
      "--manifest",
      manifest,
      "--images",
      target,
      "--worksheet",
      worksheet,
      "--image-map",
      imageMap,
      "--intake-packet",
      intakePacket,
      "--preflight-json",
      preflightJson,
      "--preflight-md",
      preflightMd,
      "--expected-cards",
      expectedCards,
    ],
    { allowFailure: true },
  );

  const syncImages = runJsonStep(
    "sync image paths",
    "scripts/sync-instacomp-trial-image-paths.mjs",
    [
      "--manifest",
      manifest,
      "--image-map",
      imageMap,
      "--worksheet",
      worksheet,
      "--receipt-json",
      syncReceiptJson,
      "--receipt-md",
      syncReceiptMd,
      "--write-manifest",
      syncWriteManifest,
      "--image-prefix",
      imagePrefix,
    ],
    { allowFailure: true },
  );

  const report = {
    schema: "tcos.instacompTrialIntakeCockpit.v1",
    generatedAt: new Date().toISOString(),
    expectedCards: Number(expectedCards),
    folderPrep,
    paths: {
      source: sourcePath,
      target: targetPath,
      manifest,
      worksheet,
      imageMap,
      intakePacket,
      intakeJson,
      intakeMarkdown,
      answerKeyGuide,
    },
    steps: {
      stageImages,
      prepTrial,
      syncImages,
    },
    blockers: [firstBlockerFrom(stageImages, prepTrial, syncImages)]
      .filter(Boolean)
      .map((blocker) => ({
        step:
          blocker.key?.startsWith("sync_")
            ? "sync_images"
            : stageImages.payload?.blockers?.includes(blocker)
              ? "stage_images"
              : "prep_or_preflight",
        ...blocker,
      })),
    safeBuildBoundary:
      "Local InstaComp trial intake cockpit only. Ensures local trial folders, runs dry-run staging, local prep, and local image-path sync; does not apply staging, delete source files, scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
  report.next = buildNext(report);

  const intakeJsonPath = resolveFromRepo(intakeJson);
  const intakeMarkdownPath = resolveFromRepo(intakeMarkdown);
  const answerKeyGuidePath = resolveFromRepo(answerKeyGuide);
  await mkdir(dirname(intakeJsonPath), { recursive: true });
  await mkdir(dirname(intakeMarkdownPath), { recursive: true });
  await mkdir(dirname(answerKeyGuidePath), { recursive: true });
  await writeFile(intakeJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(intakeMarkdownPath, buildMarkdown(report));
  await writeFile(answerKeyGuidePath, buildGroundTruthGuide(report));

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const stage = report.steps.stageImages.payload || {};
  const prep = report.steps.prepTrial.payload || {};
  const sync = report.steps.syncImages.payload || {};
  console.log("TCOS InstaComp trial intake cockpit:");
  console.log(`- source inbox: ${report.paths.source}`);
  console.log(`- target images: ${report.paths.target}`);
  console.log(`- folders ensured: ${report.folderPrep.ensured ? "yes" : "no"}`);
  console.log(`- stage ready to apply: ${stage.readyToApply ? "yes" : "no"}`);
  console.log(`- stageable cards: ${stage.observed?.stageableCards ?? 0}/${stage.expected?.cards ?? expectedCards}`);
  console.log(`- prep ready to scan: ${prep.readyToScan ? "yes" : "no"}`);
  console.log(`- image paths synced OK: ${sync.ok ? "yes" : "no"}`);
  console.log(`- intake JSON: ${intakeJson}`);
  console.log(`- intake Markdown: ${intakeMarkdown}`);
  console.log(`- answer-key guide: ${answerKeyGuide}`);
  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
