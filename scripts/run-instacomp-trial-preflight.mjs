import { existsSync, readFileSync } from "node:fs";
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

function readJsonIfPresent(filePath) {
  const resolved = resolveFromRepo(filePath);
  if (!existsSync(resolved)) return { exists: false, data: null, error: null };

  try {
    return {
      exists: true,
      data: JSON.parse(readFileSync(resolved, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runTrialReportJson(label, reportArgs) {
  const result = spawnSync(
    "node",
    ["scripts/run-instacomp-trial-report.mjs", ...reportArgs, "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const stdout = (result.stdout || "").trim();
  try {
    return {
      label,
      ok: true,
      exitStatus: result.status,
      report: JSON.parse(stdout),
      stderr: (result.stderr || "").trim(),
    };
  } catch (error) {
    return {
      label,
      ok: false,
      exitStatus: result.status,
      report: null,
      stderr:
        (result.stderr || "").trim() ||
        `Could not parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readImageMapStatus(imageAudit, imageMapPath) {
  const loaded = readJsonIfPresent(imageMapPath);
  if (!loaded.exists) {
    return {
      path: imageMapPath,
      exists: false,
      schemaOk: false,
      rowCount: 0,
      matchesCurrentAudit: false,
      readyToScan: false,
      error: null,
      next: "Run npm run instacomp:trial:packet to write the local image-map receipt.",
    };
  }

  if (loaded.error || !loaded.data) {
    return {
      path: imageMapPath,
      exists: true,
      schemaOk: false,
      rowCount: 0,
      matchesCurrentAudit: false,
      readyToScan: false,
      error: loaded.error,
      next: "Rerun npm run instacomp:trial:packet to replace the unreadable image-map receipt.",
    };
  }

  const rows = Array.isArray(loaded.data.rows) ? loaded.data.rows : [];
  const expected = loaded.data.expected || {};
  const observed = loaded.data.observed || {};
  const auditExpected = imageAudit?.expected || {};
  const auditObserved = imageAudit?.observed || {};
  const schemaOk = loaded.data.schema === "tcos.instacompTrialImageMap.v1";
  const matchesCurrentAudit =
    schemaOk &&
    rows.length === auditExpected.cards &&
    loaded.data.readyToScan === imageAudit?.readyToScan &&
    expected.cards === auditExpected.cards &&
    expected.images === auditExpected.images &&
    observed.parsedImageFiles === auditObserved.parsedImageFiles &&
    observed.completePairs === auditObserved.completePairs &&
    observed.orderedPairCandidateFiles === auditObserved.orderedPairCandidateFiles &&
    observed.orderedPairCompletePairs === auditObserved.orderedPairCompletePairs;

  return {
    path: imageMapPath,
    exists: true,
    schemaOk,
    rowCount: rows.length,
    matchesCurrentAudit,
    readyToScan: Boolean(loaded.data.readyToScan),
    generatedAt: loaded.data.generatedAt || null,
    error: null,
    next: matchesCurrentAudit
      ? imageAudit?.readyToScan
        ? "Image-map receipt matches the ready image audit."
        : "Image-map receipt matches the current incomplete audit; fix image files, then rerun npm run instacomp:trial:packet."
      : "Rerun npm run instacomp:trial:packet so the image-map receipt matches the current image folder.",
  };
}

function readIntakePacketStatus(imageAudit, imageMapStatus, intakePacketPath) {
  const resolved = resolveFromRepo(intakePacketPath);
  if (!existsSync(resolved)) {
    return {
      path: intakePacketPath,
      exists: false,
      matchesCurrentAudit: false,
      error: null,
      next: "Run npm run instacomp:trial:packet to write the local intake packet before scanning.",
    };
  }

  try {
    const text = readFileSync(resolved, "utf8");
    const matchesCurrentAudit =
      text.includes("# TCOS InstaComp™ Trial Intake Packet") &&
      text.includes(`Expected cards: ${imageAudit?.expected?.cards}`) &&
      text.includes(`Parsed image files: ${imageAudit?.observed?.parsedImageFiles}`) &&
      text.includes(`Complete front/back pairs: ${imageAudit?.observed?.completePairs}`) &&
      (!imageMapStatus.exists || text.includes("Image map receipt:"));

    return {
      path: intakePacketPath,
      exists: true,
      matchesCurrentAudit,
      error: null,
      next: matchesCurrentAudit
        ? imageAudit?.readyToScan
          ? "Intake packet matches the ready image audit."
          : "Intake packet matches the current incomplete audit; fix image files, then rerun npm run instacomp:trial:packet."
        : "Rerun npm run instacomp:trial:packet so the intake packet matches the current image folder.",
    };
  } catch (error) {
    return {
      path: intakePacketPath,
      exists: true,
      matchesCurrentAudit: false,
      error: error instanceof Error ? error.message : String(error),
      next: "Rerun npm run instacomp:trial:packet to replace the unreadable intake packet.",
    };
  }
}

function compactManifestProblems(manifestAudit) {
  const problems = manifestAudit?.problems || {};
  const missingCore = Array.isArray(problems.missingCoreFields)
    ? problems.missingCoreFields
    : [];
  return {
    missingCoreRows: manifestAudit?.observed?.missingCoreRows ?? null,
    duplicateTrialCardIds: manifestAudit?.observed?.duplicateTrialCardIds ?? null,
    missingTrialCardIds: manifestAudit?.observed?.missingTrialCardIds ?? null,
    shortManifestRows: manifestAudit?.observed?.shortManifestRows ?? null,
    firstMissingCoreRows: missingCore.slice(0, 5),
  };
}

function compactImageProblems(imageAudit) {
  const problems = imageAudit?.problems || {};
  return {
    missingFronts: Array.isArray(problems.missingFronts) ? problems.missingFronts.length : null,
    missingBacks: Array.isArray(problems.missingBacks) ? problems.missingBacks.length : null,
    duplicateFronts: Array.isArray(problems.duplicateFronts) ? problems.duplicateFronts.length : null,
    duplicateBacks: Array.isArray(problems.duplicateBacks) ? problems.duplicateBacks.length : null,
    unknownFiles: Array.isArray(problems.unknownFiles) ? problems.unknownFiles.length : null,
    extraFiles: Array.isArray(problems.extraFiles) ? problems.extraFiles.length : null,
    unpairedOrderedFiles: Array.isArray(problems.unpairedOrderedFiles)
      ? problems.unpairedOrderedFiles.length
      : null,
    firstMissingFronts: Array.isArray(problems.missingFronts)
      ? problems.missingFronts.slice(0, 5)
      : [],
    firstMissingBacks: Array.isArray(problems.missingBacks)
      ? problems.missingBacks.slice(0, 5)
      : [],
  };
}

function buildScanPermit({ readyToScan, blockers, manifestAudit, imageAudit, imageMap, intakePacket }) {
  const groundTruthRows = manifestAudit?.observed?.readyRows ?? 0;
  const expectedCards = manifestAudit?.expected?.cards ?? null;
  const imagePairs = imageAudit?.observed?.completePairs ?? 0;
  const expectedImagePairs = imageAudit?.expected?.cards ?? expectedCards;
  const imageFiles = imageAudit?.observed?.parsedImageFiles ?? 0;
  const expectedImages = imageAudit?.expected?.images ?? null;
  const requiredBeforeScan = blockers.map((blocker) => ({
    key: blocker.key,
    action: blocker.next,
  }));

  return {
    status: readyToScan ? "SCAN_PERMIT_GRANTED" : "SCAN_PERMIT_BLOCKED",
    label: readyToScan ? "Scan permit granted" : "Scan permit blocked",
    canScan: readyToScan,
    summary: readyToScan
      ? "Answer key, front/back image pairs, image-map receipt, and intake packet are current."
      : "Do not scan this final tester lot yet; preflight still has required setup work.",
    progress: {
      answerKeyRows: groundTruthRows,
      expectedCards,
      imagePairs,
      expectedImagePairs,
      imageFiles,
      expectedImages,
      imageMapCurrent: Boolean(imageMap.matchesCurrentAudit),
      intakePacketCurrent: Boolean(intakePacket.matchesCurrentAudit),
    },
    requiredBeforeScan,
    operatorWarning: readyToScan
      ? "Scan only this prepared lot, export the results JSON, then run the scorekeeper before claiming done-done."
      : "Scanning now would waste time and produce untrustworthy score evidence.",
  };
}

function buildOperatorNextActions({ manifestAudit, imageAudit, imageMap, intakePacket, readyToScan }) {
  const actions = [];
  const groundTruthReady = Boolean(manifestAudit?.readyToScore);
  const imagesReady = Boolean(imageAudit?.readyToScan);
  const imageMapCurrent = Boolean(imageMap.matchesCurrentAudit);
  const intakePacketCurrent = Boolean(intakePacket.matchesCurrentAudit);

  if (!groundTruthReady) {
    actions.push({
      key: "fill_answer_key",
      type: "manual",
      command: "fill instacomp-trial-groundtruth.local.tsv using instacomp-trial-answer-key.local.html",
      why: "The 94% scorekeeper is meaningless until all 100 cards have player/year/setName/cardNumber truth.",
    });
    actions.push({
      key: "validate_answer_key",
      type: "command",
      command: "npm run instacomp:trial:answer-key:validate",
      why: "Catch missing rows, duplicate trial IDs, image drift, and required-field gaps before applying the TSV.",
    });
    actions.push({
      key: "apply_answer_key",
      type: "command",
      command: "npm run instacomp:trial:groundtruth:apply",
      why: "Apply the validated answer key back to the local manifest before preflight can grant scan permission.",
    });
  }

  if (!imagesReady) {
    actions.push({
      key: "load_or_fix_images",
      type: "manual",
      command: "copy/fix about 200 front-back scanner images in instacomp-trial-inbox, then run npm run instacomp:trial:intake",
      why: "The final trial needs complete front/back pairs before scanner time is spent.",
    });
  }

  if (imagesReady && (!imageMapCurrent || !intakePacketCurrent)) {
    actions.push({
      key: "refresh_receipts",
      type: "command",
      command: "npm run instacomp:trial:packet",
      why: "Refresh the image-map and readable intake packet so proof matches the current image folder.",
    });
  }

  if (readyToScan) {
    actions.push({
      key: "scan_export_score",
      type: "operator",
      command: "scan at http://localhost:3000/admin/instacomp, export JSON, then run npm run instacomp:trial:score",
      why: "The local preflight is green; the next proof is measured accuracy and FAF speed.",
    });
    actions.push({
      key: "write_failure_queue",
      type: "command",
      command: "npm run instacomp:trial:failures",
      why: "If the score is short of 94% or the FAF timing gate, write the miss queue so fixes are targeted.",
    });
  } else {
    actions.push({
      key: "rerun_preflight",
      type: "command",
      command: "npm run instacomp:trial:preflight",
      why: "Recheck the scan permit after completing the setup actions above.",
    });
  }

  return actions.slice(0, 8);
}

function buildPreflight() {
  const manifestPath = getFlagValue("--manifest", "instacomp-trial-manifest.local.json");
  const imageDir = getFlagValue("--images", "instacomp-trial-images");
  const imageMapPath = getFlagValue("--image-map", "instacomp-trial-image-map.local.json");
  const intakePacketPath = getFlagValue(
    "--intake-packet",
    "instacomp-trial-intake-packet.local.md",
  );
  const expectedCards = getFlagValue("--expected-cards", "100");

  const manifestRun = runTrialReportJson("ground-truth manifest audit", [
    "--manifest",
    manifestPath,
    "--audit-manifest",
    "--expected-cards",
    expectedCards,
  ]);
  const imageRun = runTrialReportJson("image folder audit", [
    "--manifest",
    manifestPath,
    "--audit-images",
    imageDir,
    "--expected-cards",
    expectedCards,
  ]);

  const manifestAudit = manifestRun.report;
  const imageAudit = imageRun.report;
  const imageMap = readImageMapStatus(imageAudit, imageMapPath);
  const intakePacket = readIntakePacketStatus(imageAudit, imageMap, intakePacketPath);

  const blockers = [];
  if (!manifestRun.ok) {
    blockers.push({
      key: "ground_truth_audit_unreadable",
      label: "Ground-truth audit did not return parseable JSON.",
      next: manifestRun.stderr || "Run npm run instacomp:trial:groundtruth directly.",
    });
  } else if (!manifestAudit.readyToScore) {
    blockers.push({
      key: "ground_truth_not_ready",
      label: "Ground-truth answer key is not ready.",
      next:
        "Fill/apply instacomp-trial-groundtruth.local.tsv, then rerun npm run instacomp:trial:groundtruth.",
    });
  }

  if (!imageRun.ok) {
    blockers.push({
      key: "image_audit_unreadable",
      label: "Image audit did not return parseable JSON.",
      next: imageRun.stderr || "Run npm run instacomp:trial:audit directly.",
    });
  } else if (!imageAudit.readyToScan) {
    blockers.push({
      key: "images_not_ready",
      label: "The 100-card / 200-image folder is not ready.",
      next:
        "Copy or fix the trial images in instacomp-trial-images/, then rerun npm run instacomp:trial:packet.",
    });
  }

  if (!imageMap.matchesCurrentAudit) {
    blockers.push({
      key: "image_map_not_current",
      label: "The front/back image-map receipt is missing or stale.",
      next: imageMap.next,
    });
  }

  if (!intakePacket.matchesCurrentAudit) {
    blockers.push({
      key: "intake_packet_not_current",
      label: "The readable intake packet is missing or stale.",
      next: intakePacket.next,
    });
  }

  const readyToScan = blockers.length === 0;
  const scanPermit = buildScanPermit({
    readyToScan,
    blockers,
    manifestAudit,
    imageAudit,
    imageMap,
    intakePacket,
  });
  const operatorNextActions = buildOperatorNextActions({
    manifestAudit,
    imageAudit,
    imageMap,
    intakePacket,
    readyToScan,
  });

  return {
    schema: "tcos.instacompTrialPreflight.v1",
    generatedAt: new Date().toISOString(),
    readyToScan,
    manifestPath,
    imageDir,
    imageMapPath,
    intakePacketPath,
    expectedCards: Number.parseInt(expectedCards, 10),
    testerUrl: "http://localhost:3000/admin/instacomp",
    manifestAudit: {
      ok: manifestRun.ok,
      readyToScore: Boolean(manifestAudit?.readyToScore),
      expectedCards: manifestAudit?.expected?.cards ?? null,
      readyRows: manifestAudit?.observed?.readyRows ?? null,
      problems: compactManifestProblems(manifestAudit),
    },
    imageAudit: {
      ok: imageRun.ok,
      readyToScan: Boolean(imageAudit?.readyToScan),
      expectedCards: imageAudit?.expected?.cards ?? null,
      expectedImages: imageAudit?.expected?.images ?? null,
      parsedImageFiles: imageAudit?.observed?.parsedImageFiles ?? null,
      completePairs: imageAudit?.observed?.completePairs ?? null,
      orderedPairCandidateFiles: imageAudit?.observed?.orderedPairCandidateFiles ?? null,
      orderedPairCompletePairs: imageAudit?.observed?.orderedPairCompletePairs ?? null,
      problems: compactImageProblems(imageAudit),
    },
    imageMap,
    intakePacket,
    blockers,
    scanPermit,
    operatorNextActions,
    commands: {
      writeGroundTruthSheet: "npm run instacomp:trial:groundtruth:sheet",
      validateGroundTruthSheet: "npm run instacomp:trial:answer-key:validate",
      applyGroundTruthSheet: "npm run instacomp:trial:groundtruth:apply",
      writePacket: "npm run instacomp:trial:packet",
      preflight: "npm run instacomp:trial:preflight",
      scan: "http://localhost:3000/admin/instacomp",
      score: "npm run instacomp:trial:score",
      failures: "npm run instacomp:trial:failures",
    },
    next: readyToScan
      ? "Preflight is green. Run the 100-card lot through InstaComp™, export trial results, then score with npm run instacomp:trial:score."
      : blockers[0]?.next || "Fix the listed blocker, then rerun npm run instacomp:trial:preflight.",
    safeBuildBoundary:
      "This preflight is local/read-only. It does not scan cards, deploy, publish listings, buy postage, create Checkout, call production APIs, approve live money, release payouts, or change runtime switches.",
  };
}

function printPreflight(report) {
  console.log("TCOS InstaComp™ final tester preflight:");
  console.log(`- ready to scan: ${report.readyToScan ? "YES" : "NO"}`);
  console.log(`- scan permit: ${report.scanPermit.status} - ${report.scanPermit.summary}`);
  console.log(`- scan warning: ${report.scanPermit.operatorWarning}`);
  console.log(`- tester URL: ${report.testerUrl}`);
  console.log(`- manifest: ${report.manifestPath}`);
  console.log(`- image folder: ${report.imageDir}`);
  console.log(
    `- ground truth: ${report.manifestAudit.readyToScore ? "ready" : "not ready"} (${report.manifestAudit.readyRows ?? "unknown"}/${report.manifestAudit.expectedCards ?? "unknown"} rows)`,
  );
  console.log(
    `- images: ${report.imageAudit.readyToScan ? "ready" : "not ready"} (${report.imageAudit.completePairs ?? "unknown"}/${report.imageAudit.expectedCards ?? "unknown"} pairs, ${report.imageAudit.parsedImageFiles ?? "unknown"}/${report.imageAudit.expectedImages ?? "unknown"} files)`,
  );
  console.log(
    `- image map: ${report.imageMap.exists ? "present" : "missing"} / ${report.imageMap.matchesCurrentAudit ? "current" : "not current"}`,
  );
  console.log(
    `- intake packet: ${report.intakePacket.exists ? "present" : "missing"} / ${report.intakePacket.matchesCurrentAudit ? "current" : "not current"}`,
  );

  if (report.blockers.length > 0) {
    console.log("");
    console.log("Blockers:");
    for (const blocker of report.blockers) {
      console.log(`- ${blocker.key}: ${blocker.label}`);
      console.log(`  Next: ${blocker.next}`);
    }
  }
  if (Array.isArray(report.operatorNextActions) && report.operatorNextActions.length > 0) {
    console.log("");
    console.log("Operator next actions:");
    for (const [index, action] of report.operatorNextActions.entries()) {
      console.log(`${index + 1}. ${action.command}`);
      console.log(`   why: ${action.why}`);
    }
  }

  console.log("");
  console.log("Commands:");
  console.log(`- write answer sheet: ${report.commands.writeGroundTruthSheet}`);
  console.log(`- validate answer sheet: ${report.commands.validateGroundTruthSheet}`);
  console.log(`- apply answer sheet: ${report.commands.applyGroundTruthSheet}`);
  console.log(`- write packet/receipt: ${report.commands.writePacket}`);
  console.log(`- rerun preflight: ${report.commands.preflight}`);
  console.log(`- score after export: ${report.commands.score}`);
  console.log(`- write miss queue: ${report.commands.failures}`);
  console.log("");
  console.log(`Next: ${report.next}`);
  console.log(`Safe build boundary: ${report.safeBuildBoundary}`);
}

const report = buildPreflight();
if (hasFlag("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printPreflight(report);
}

if (!report.readyToScan && !hasFlag("--allow-not-ready")) {
  process.exitCode = 1;
}
