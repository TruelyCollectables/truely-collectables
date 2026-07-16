import { existsSync } from "node:fs";
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

function runNode(script, scriptArgs, options = {}) {
  const result = spawnSync("node", [script, ...scriptArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(
      [
        `${script} ${scriptArgs.join(" ")} failed with exit ${result.status}.`,
        stdout,
        stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return { status: result.status, stdout, stderr };
}

function parseJsonOutput(label, output) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Could not parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function buildPrepMarkdown(report) {
  const preflight = report.preflight || {};
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  const scanPermit = preflight.scanPermit || {};
  const operatorNextActions = Array.isArray(preflight.operatorNextActions)
    ? preflight.operatorNextActions
    : [];

  return [
    "# TCOS InstaComp Trial Prep Bundle",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.safeBuildBoundary,
    "",
    "## Status",
    "",
    `- Ready to scan: ${preflight.readyToScan ? "YES" : "NO"}`,
    `- Scan permit: ${scanPermit.status || "unknown"}`,
    `- Scan permit summary: ${scanPermit.summary || "unknown"}`,
    `- Scan warning: ${scanPermit.operatorWarning || "unknown"}`,
    `- Manifest: ${report.paths.manifest}`,
    `- Worksheet: ${report.paths.worksheet}`,
    `- Image folder: ${report.paths.images}`,
    `- Image map: ${report.paths.imageMap}`,
    `- Intake packet: ${report.paths.intakePacket}`,
    `- Preflight JSON: ${report.paths.preflightJson}`,
    "",
    "## Actions taken",
    "",
    ...report.actions.map((action) => {
      const status = action.ok ? "ok" : "not ok";
      return `- ${action.key}: ${status} - ${action.message}`;
    }),
    "",
    "## Preflight blockers",
    "",
    ...(blockers.length
      ? [
          "| Blocker | What it means | Next |",
          "| --- | --- | --- |",
          ...blockers.map(
            (blocker) =>
              `| ${markdownCell(blocker.key)} | ${markdownCell(blocker.label)} | ${markdownCell(blocker.next)} |`,
          ),
          "",
        ]
      : ["No preflight blockers detected.", ""]),
    "## Ordered operator next actions",
    "",
    ...(operatorNextActions.length
      ? [
          "| # | Action | Why |",
          "| --- | --- | --- |",
          ...operatorNextActions.map(
            (action, index) =>
              `| ${index + 1} | ${markdownCell(action.command)} | ${markdownCell(action.why)} |`,
          ),
          "",
        ]
      : ["No operator actions reported by preflight.", ""]),
    "## Next commands",
    "",
    "```bash",
    "npm run instacomp:trial:groundtruth:sheet",
    "# Fill instacomp-trial-groundtruth.local.tsv in a spreadsheet",
    "npm run instacomp:trial:answer-key:validate",
    "npm run instacomp:trial:groundtruth:apply",
    "npm run instacomp:trial:packet",
    "npm run instacomp:trial:preflight",
    "# Then scan at http://localhost:3000/admin/instacomp",
    "npm run instacomp:trial:score",
    "npm run instacomp:trial:failures",
    "```",
    "",
    `Next: ${report.next}`,
    "",
  ].join("\n");
}

async function main() {
  const expectedCards = getFlagValue("--expected-cards", "100");
  const manifest = getFlagValue("--manifest", "instacomp-trial-manifest.local.json");
  const images = getFlagValue("--images", "instacomp-trial-images");
  const worksheet = getFlagValue("--worksheet", "instacomp-trial-groundtruth.local.tsv");
  const imageMap = getFlagValue("--image-map", "instacomp-trial-image-map.local.json");
  const intakePacket = getFlagValue("--intake-packet", "instacomp-trial-intake-packet.local.md");
  const preflightJson = getFlagValue("--preflight-json", "instacomp-trial-preflight.local.json");
  const preflightMd = getFlagValue("--preflight-md", "instacomp-trial-preflight.local.md");
  const forceWorksheet = hasFlag("--force-worksheet");
  const noInit = hasFlag("--no-init");
  const actions = [];

  const manifestPath = resolveFromRepo(manifest);
  if (!existsSync(manifestPath)) {
    if (noInit) {
      actions.push({
        key: "manifest",
        ok: false,
        message: `Manifest is missing and --no-init was supplied: ${manifest}`,
      });
    } else {
      runNode("scripts/run-instacomp-trial-report.mjs", [
        "--init-manifest",
        manifest,
        "--cards",
        expectedCards,
      ]);
      actions.push({
        key: "manifest",
        ok: true,
        message: `Created missing manifest with ${expectedCards} card rows.`,
      });
    }
  } else {
    actions.push({
      key: "manifest",
      ok: true,
      message: "Existing manifest preserved.",
    });
  }

  const worksheetPath = resolveFromRepo(worksheet);
  if (!existsSync(worksheetPath) || forceWorksheet) {
    runNode("scripts/run-instacomp-trial-report.mjs", [
      "--manifest",
      manifest,
      "--write-groundtruth-sheet",
      worksheet,
    ]);
    actions.push({
      key: "worksheet",
      ok: true,
      message: `${existsSync(worksheetPath) && forceWorksheet ? "Refreshed" : "Wrote"} answer-key worksheet.`,
    });
  } else {
    actions.push({
      key: "worksheet",
      ok: true,
      message: "Existing answer-key worksheet preserved; use --force-worksheet only for fixture/test refreshes.",
    });
  }

  runNode(
    "scripts/run-instacomp-trial-report.mjs",
    [
      "--manifest",
      manifest,
      "--audit-images",
      images,
      "--expected-cards",
      expectedCards,
      "--write-image-map",
      imageMap,
      "--write-intake-packet",
      intakePacket,
      "--allow-not-ready",
    ],
    { allowFailure: true },
  );
  actions.push({
    key: "intake_packet",
    ok: true,
    message: "Refreshed image-map receipt and readable intake packet from the current image folder.",
  });

  const preflightRun = runNode(
    "scripts/run-instacomp-trial-preflight.mjs",
    [
      "--manifest",
      manifest,
      "--images",
      images,
      "--image-map",
      imageMap,
      "--intake-packet",
      intakePacket,
      "--expected-cards",
      expectedCards,
      "--allow-not-ready",
      "--json",
    ],
    { allowFailure: true },
  );
  const preflight = parseJsonOutput("InstaComp trial preflight", preflightRun.stdout);

  const report = {
    schema: "tcos.instacompTrialPrepBundle.v1",
    generatedAt: new Date().toISOString(),
    readyToScan: Boolean(preflight.readyToScan),
    paths: {
      manifest,
      worksheet,
      images,
      imageMap,
      intakePacket,
      preflightJson,
      preflightMd,
    },
    actions,
    preflight,
    next: preflight.readyToScan
      ? "Preflight is green. Scan the lot at http://localhost:3000/admin/instacomp, export trial results, then run npm run instacomp:trial:score."
      : preflight.next || "Fix the listed preflight blockers, then rerun npm run instacomp:trial:prep.",
    safeBuildBoundary:
      "Local InstaComp trial prep only. Does not scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };

  const preflightJsonPath = resolveFromRepo(preflightJson);
  const preflightMdPath = resolveFromRepo(preflightMd);
  await mkdir(dirname(preflightJsonPath), { recursive: true });
  await mkdir(dirname(preflightMdPath), { recursive: true });
  await writeFile(preflightJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(preflightMdPath, buildPrepMarkdown(report));

  if (hasFlag("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("TCOS InstaComp trial prep bundle:");
  console.log(`- ready to scan: ${report.readyToScan ? "YES" : "NO"}`);
  console.log(`- worksheet: ${worksheet}`);
  console.log(`- intake packet: ${intakePacket}`);
  console.log(`- preflight JSON: ${preflightJson}`);
  console.log(`- preflight Markdown: ${preflightMd}`);
  console.log(`- blockers: ${Array.isArray(preflight.blockers) ? preflight.blockers.length : "unknown"}`);
  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
