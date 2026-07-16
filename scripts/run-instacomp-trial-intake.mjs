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
  const imagePrefix = getFlagValue("--image-prefix", `./${target}`);
  const jsonOutput = hasFlag("--json");

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
    paths: {
      source: resolveFromRepo(source),
      target: resolveFromRepo(target),
      manifest,
      worksheet,
      imageMap,
      intakePacket,
      intakeJson,
      intakeMarkdown,
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
      "Local InstaComp trial intake cockpit only. Runs dry-run staging, local prep, and local image-path sync; does not apply staging, delete source files, scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
  report.next = buildNext(report);

  const intakeJsonPath = resolveFromRepo(intakeJson);
  const intakeMarkdownPath = resolveFromRepo(intakeMarkdown);
  await mkdir(dirname(intakeJsonPath), { recursive: true });
  await mkdir(dirname(intakeMarkdownPath), { recursive: true });
  await writeFile(intakeJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(intakeMarkdownPath, buildMarkdown(report));

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
  console.log(`- stage ready to apply: ${stage.readyToApply ? "yes" : "no"}`);
  console.log(`- stageable cards: ${stage.observed?.stageableCards ?? 0}/${stage.expected?.cards ?? expectedCards}`);
  console.log(`- prep ready to scan: ${prep.readyToScan ? "yes" : "no"}`);
  console.log(`- image paths synced OK: ${sync.ok ? "yes" : "no"}`);
  console.log(`- intake JSON: ${intakeJson}`);
  console.log(`- intake Markdown: ${intakeMarkdown}`);
  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
