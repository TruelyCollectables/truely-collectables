import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const jsonOutput = process.argv.includes("--json");
const statusJsonMaxBuffer = 64 * 1024 * 1024;
const acceptedImageFileExtensions = new Set([
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

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function countAcceptedImageFilesIfPresent(relativeDir) {
  const dir = join(repoRoot, relativeDir);
  if (!existsSync(dir)) return 0;

  return readdirSync(dir).filter(
    (name) =>
      !name.startsWith(".") &&
      acceptedImageFileExtensions.has(extname(name).toLowerCase()),
  ).length;
}

function countNonImageFilesIfPresent(relativeDir) {
  const dir = join(repoRoot, relativeDir);
  if (!existsSync(dir)) return 0;

  return readdirSync(dir).filter(
    (name) =>
      !name.startsWith(".") &&
      !acceptedImageFileExtensions.has(extname(name).toLowerCase()),
  ).length;
}

function runTrialManifestAudit() {
  const command = [
    "node",
    "scripts/run-instacomp-trial-report.mjs",
    "--manifest",
    "instacomp-trial-manifest.local.json",
    "--audit-manifest",
    "--expected-cards",
    "100",
    "--json",
  ];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
  const stdout = (result.stdout || "").trim();

  try {
    const payload = JSON.parse(stdout);
    const problems = payload.problems || {};

    return {
      command: "npm run instacomp:trial:groundtruth",
      available: true,
      readyToScore: Boolean(payload.readyToScore),
      expectedCards: payload.expected?.cards ?? null,
      observedCards: payload.observed?.cards ?? null,
      readyRows: payload.observed?.readyRows ?? null,
      missingCoreRows: payload.observed?.missingCoreRows ?? null,
      duplicateTrialCardIdCount: payload.observed?.duplicateTrialCardIds ?? null,
      missingTrialCardIdCount: payload.observed?.missingTrialCardIds ?? null,
      shortManifestRows: payload.observed?.shortManifestRows ?? null,
      coreFields: Array.isArray(payload.expected?.coreFields)
        ? payload.expected.coreFields
        : [],
      firstMissingCoreRows: Array.isArray(problems.missingCoreFields)
        ? problems.missingCoreFields.slice(0, 5)
        : [],
      next: payload.next || "Run npm run instacomp:trial:groundtruth.",
      exitStatus: result.status,
      error: result.status === 0 ? null : (result.stderr || "").trim() || null,
    };
  } catch (error) {
    return {
      command: "npm run instacomp:trial:groundtruth",
      available: false,
      readyToScore: false,
      expectedCards: null,
      observedCards: null,
      readyRows: null,
      missingCoreRows: null,
      duplicateTrialCardIdCount: null,
      missingTrialCardIdCount: null,
      shortManifestRows: null,
      coreFields: [],
      firstMissingCoreRows: [],
      next:
        "Run npm run instacomp:trial:groundtruth directly to inspect ground-truth manifest readiness.",
      exitStatus: result.status,
      error:
        (result.stderr || "").trim() ||
        `Could not parse trial ground-truth audit JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

function runTrialImageAudit() {
  const command = [
    "node",
    "scripts/run-instacomp-trial-report.mjs",
    "--manifest",
    "instacomp-trial-manifest.local.json",
    "--audit-images",
    "instacomp-trial-images",
    "--expected-cards",
    "100",
    "--json",
  ];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
  const stdout = (result.stdout || "").trim();

  try {
    const payload = JSON.parse(stdout);
    const problems = payload.problems || {};

    return {
      command: "npm run instacomp:trial:audit",
      available: true,
      readyToScan: Boolean(payload.readyToScan),
      expectedCards: payload.expected?.cards ?? null,
      expectedImages: payload.expected?.images ?? null,
      parsedImageFiles: payload.observed?.parsedImageFiles ?? null,
      completePairs: payload.observed?.completePairs ?? null,
      orderedPairCandidateFiles: payload.observed?.orderedPairCandidateFiles ?? null,
      orderedPairCompletePairs: payload.observed?.orderedPairCompletePairs ?? null,
      missingFrontCount: Array.isArray(problems.missingFronts)
        ? problems.missingFronts.length
        : null,
      missingBackCount: Array.isArray(problems.missingBacks)
        ? problems.missingBacks.length
        : null,
      duplicateFrontCount: Array.isArray(problems.duplicateFronts)
        ? problems.duplicateFronts.length
        : null,
      duplicateBackCount: Array.isArray(problems.duplicateBacks)
        ? problems.duplicateBacks.length
        : null,
      unknownFileCount: Array.isArray(problems.unknownFiles)
        ? problems.unknownFiles.length
        : null,
      extraFileCount: Array.isArray(problems.extraFiles)
        ? problems.extraFiles.length
        : null,
      firstMissingFronts: Array.isArray(problems.missingFronts)
        ? problems.missingFronts.slice(0, 5)
        : [],
      firstMissingBacks: Array.isArray(problems.missingBacks)
        ? problems.missingBacks.slice(0, 5)
        : [],
      next: payload.next || "Run npm run instacomp:trial:audit.",
      exitStatus: result.status,
      error: result.status === 0 ? null : (result.stderr || "").trim() || null,
    };
  } catch (error) {
    return {
      command: "npm run instacomp:trial:audit",
      available: false,
      readyToScan: false,
      expectedCards: null,
      expectedImages: null,
      parsedImageFiles: null,
      completePairs: null,
      orderedPairCandidateFiles: null,
      orderedPairCompletePairs: null,
      missingFrontCount: null,
      missingBackCount: null,
      duplicateFrontCount: null,
      duplicateBackCount: null,
      unknownFileCount: null,
      extraFileCount: null,
      firstMissingFronts: [],
      firstMissingBacks: [],
      next: "Run npm run instacomp:trial:audit directly to inspect image-folder readiness.",
      exitStatus: result.status,
      error:
        (result.stderr || "").trim() ||
        `Could not parse trial image audit JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

function readTrialImageMapStatus(audit) {
  const imageMapPath = "instacomp-trial-image-map.local.json";
  const absolutePath = join(repoRoot, imageMapPath);

  if (!existsSync(absolutePath)) {
    return {
      path: imageMapPath,
      exists: false,
      schemaOk: false,
      rowCount: 0,
      readyToScan: false,
      matchesCurrentAudit: false,
      generatedAt: null,
      firstMappedRows: [],
      next: audit.readyToScan
        ? "Run npm run instacomp:trial:map before scanning so the front/back receipt matches this ready image set."
        : "Load or fix the 100-card image folder, then run npm run instacomp:trial:map after the audit is ready.",
      error: null,
    };
  }

  try {
    const payload = JSON.parse(readFileSync(absolutePath, "utf8"));
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const schemaOk = payload.schema === "tcos.instacompTrialImageMap.v1";
    const rowCount = rows.length;
    const expectedCards = audit.expectedCards ?? null;
    const expectedImages = audit.expectedImages ?? null;
    const observed = payload.observed || {};
    const expected = payload.expected || {};
    const matchesCurrentAudit =
      schemaOk &&
      rowCount === expectedCards &&
      payload.readyToScan === audit.readyToScan &&
      expected.cards === expectedCards &&
      expected.images === expectedImages &&
      observed.parsedImageFiles === audit.parsedImageFiles &&
      observed.completePairs === audit.completePairs &&
      observed.orderedPairCandidateFiles === audit.orderedPairCandidateFiles &&
      observed.orderedPairCompletePairs === audit.orderedPairCompletePairs;

    return {
      path: imageMapPath,
      exists: true,
      schemaOk,
      rowCount,
      readyToScan: Boolean(payload.readyToScan),
      matchesCurrentAudit,
      generatedAt: payload.generatedAt || null,
      firstMappedRows: rows.slice(0, 5).map((row) => ({
        trialCardId: row.trialCardId || null,
        frontImage: row.frontImage || null,
        backImage: row.backImage || null,
        frontSource: row.frontSource || null,
        backSource: row.backSource || null,
      })),
      next: matchesCurrentAudit
        ? audit.readyToScan
          ? "Image map receipt matches the current audit; confirm it before uploading the lot."
          : "Image map receipt matches the current incomplete audit; fix the missing image files, then rerun npm run instacomp:trial:packet."
        : "Rerun npm run instacomp:trial:map so the local front/back receipt matches the current image audit.",
      error: null,
    };
  } catch (error) {
    return {
      path: imageMapPath,
      exists: true,
      schemaOk: false,
      rowCount: 0,
      readyToScan: false,
      matchesCurrentAudit: false,
      generatedAt: null,
      firstMappedRows: [],
      next: "Rerun npm run instacomp:trial:map to replace the unreadable image-map receipt.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTrialIntakePacketStatus(audit, imageMap) {
  const packetPath = "instacomp-trial-intake-packet.local.md";
  const absolutePath = join(repoRoot, packetPath);

  if (!existsSync(absolutePath)) {
    return {
      path: packetPath,
      exists: false,
      matchesCurrentAudit: false,
      next:
        "Run npm run instacomp:trial:packet to write the local operator intake packet before scanning.",
    };
  }

  try {
    const text = readFileSync(absolutePath, "utf8");
    const matchesCurrentAudit =
      text.includes("# TCOS InstaComp™ Trial Intake Packet") &&
      text.includes(`Expected cards: ${audit.expectedCards}`) &&
      text.includes(`Parsed image files: ${audit.parsedImageFiles}`) &&
      text.includes(`Complete front/back pairs: ${audit.completePairs}`) &&
      (!imageMap.exists || text.includes("Image map receipt:"));

    return {
      path: packetPath,
      exists: true,
      matchesCurrentAudit,
      next: matchesCurrentAudit
        ? audit.readyToScan
          ? "Intake packet matches the current audit; use it as the pre-scan receipt."
          : "Intake packet matches the current incomplete audit; fix missing image files, then rerun npm run instacomp:trial:packet."
        : "Rerun npm run instacomp:trial:packet so the packet matches the current image folder.",
    };
  } catch (error) {
    return {
      path: packetPath,
      exists: true,
      matchesCurrentAudit: false,
      next: `Rerun npm run instacomp:trial:packet; packet could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readTrialGroundTruthGuideStatus(manifestAudit) {
  const guidePath = "instacomp-trial-groundtruth-guide.local.md";
  const absolutePath = join(repoRoot, guidePath);

  if (!existsSync(absolutePath)) {
    return {
      path: guidePath,
      exists: false,
      matchesCurrentAudit: false,
      next:
        "Run npm run instacomp:trial:intake to write the local answer-key guide before filling the 100-card TSV.",
      error: null,
    };
  }

  try {
    const text = readFileSync(absolutePath, "utf8");
    const expectedCards = manifestAudit.expectedCards ?? "unknown";
    const readyRows = manifestAudit.readyRows ?? "unknown";
    const missingCoreRows = manifestAudit.missingCoreRows ?? "unknown";
    const duplicateTrialCardIdCount =
      manifestAudit.duplicateTrialCardIdCount ?? "unknown";
    const missingTrialCardIdCount = manifestAudit.missingTrialCardIdCount ?? "unknown";
    const firstMissingRow = manifestAudit.firstMissingCoreRows[0];
    const includesFirstMissingRow = firstMissingRow
      ? text.includes(firstMissingRow.trialCardId) &&
        text.includes((firstMissingRow.missing || []).join(", "))
      : true;
    const matchesCurrentAudit =
      text.includes("# TCOS InstaComp™ Trial Answer-Key Guide") &&
      text.includes(`Ready answer-key rows: ${readyRows}/${expectedCards}`) &&
      text.includes(`Missing core rows: ${missingCoreRows}`) &&
      text.includes(`Duplicate trialCardId rows: ${duplicateTrialCardIdCount}`) &&
      text.includes(`Missing trialCardId rows: ${missingTrialCardIdCount}`) &&
      text.includes("player") &&
      text.includes("year") &&
      text.includes("setName") &&
      text.includes("cardNumber") &&
      text.includes("npm run instacomp:trial:groundtruth:apply") &&
      includesFirstMissingRow;

    return {
      path: guidePath,
      exists: true,
      matchesCurrentAudit,
      next: matchesCurrentAudit
        ? manifestAudit.readyToScore
          ? "Answer-key guide matches the current ready audit; keep it with the completed TSV for the final score run."
          : "Answer-key guide matches the current missing-row audit; fill the TSV, validate it, apply it, then rerun npm run instacomp:trial:intake."
        : "Rerun npm run instacomp:trial:intake so the local answer-key guide matches the current ground-truth audit.",
      error: null,
    };
  } catch (error) {
    return {
      path: guidePath,
      exists: true,
      matchesCurrentAudit: false,
      next: `Rerun npm run instacomp:trial:intake; answer-key guide could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTrialGroundTruthWorksheetStatus(manifestAudit) {
  const worksheetPath = "instacomp-trial-groundtruth.local.tsv";
  const absolutePath = join(repoRoot, worksheetPath);
  const requiredColumns = ["trialCardId", "player", "year", "setName", "cardNumber"];

  if (!existsSync(absolutePath)) {
    return {
      path: worksheetPath,
      exists: false,
      rowCount: 0,
      coreReadyRows: 0,
      missingCoreRows: manifestAudit.expectedCards ?? null,
      requiredColumnsPresent: false,
      missingColumns: requiredColumns,
      firstMissingRows: [],
      next:
        "Run npm run instacomp:trial:groundtruth:sheet to create the local TSV worksheet, then fill the answer key.",
      error: null,
    };
  }

  try {
    const text = readFileSync(absolutePath, "utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    const header = lines[0]?.split("\t") || [];
    const missingColumns = requiredColumns.filter((column) => !header.includes(column));
    const columnIndex = new Map(header.map((column, index) => [column, index]));
    const dataRows = lines.slice(1);
    const firstMissingRows = [];
    let coreReadyRows = 0;

    for (const [index, line] of dataRows.entries()) {
      const cells = line.split("\t");
      const missing = ["player", "year", "setName", "cardNumber"].filter((column) => {
        const cellIndex = columnIndex.get(column);
        return cellIndex === undefined || !(cells[cellIndex] || "").trim();
      });
      if (missing.length === 0) {
        coreReadyRows += 1;
      } else if (firstMissingRows.length < 5) {
        const trialCardIdIndex = columnIndex.get("trialCardId");
        firstMissingRows.push({
          trialCardId:
            trialCardIdIndex === undefined || !(cells[trialCardIdIndex] || "").trim()
              ? `row-${index + 2}`
              : cells[trialCardIdIndex].trim(),
          row: index + 2,
          missing,
        });
      }
    }

    const expectedCards = manifestAudit.expectedCards ?? dataRows.length;
    const requiredColumnsPresent = missingColumns.length === 0;
    const missingCoreRows = requiredColumnsPresent
      ? Math.max(0, expectedCards - coreReadyRows)
      : expectedCards;
    const currentWithManifest =
      requiredColumnsPresent &&
      dataRows.length === expectedCards &&
      coreReadyRows === (manifestAudit.readyRows ?? coreReadyRows) &&
      missingCoreRows === (manifestAudit.missingCoreRows ?? missingCoreRows);

    return {
      path: worksheetPath,
      exists: true,
      rowCount: dataRows.length,
      coreReadyRows,
      missingCoreRows,
      requiredColumnsPresent,
      missingColumns,
      currentWithManifest,
      firstMissingRows,
      next: !requiredColumnsPresent
        ? "Regenerate the TSV with npm run instacomp:trial:groundtruth:sheet; required columns are missing."
        : coreReadyRows >= expectedCards
          ? "Worksheet core fields are filled. Run npm run instacomp:trial:answer-key:validate before npm run instacomp:trial:groundtruth:apply, then npm run instacomp:trial:intake."
          : "Fill player/year/setName/cardNumber in the TSV, save it, run npm run instacomp:trial:answer-key:validate, then apply only after validation is clean.",
      error: null,
    };
  } catch (error) {
    return {
      path: worksheetPath,
      exists: true,
      rowCount: 0,
      coreReadyRows: 0,
      missingCoreRows: manifestAudit.expectedCards ?? null,
      requiredColumnsPresent: false,
      missingColumns: requiredColumns,
      currentWithManifest: false,
      firstMissingRows: [],
      next: `Rerun npm run instacomp:trial:groundtruth:sheet; worksheet could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTrialAnswerKeyHtmlStatus(manifestAudit, worksheetStatus) {
  const htmlPath = "instacomp-trial-answer-key.local.html";
  const absolutePath = join(repoRoot, htmlPath);

  if (!existsSync(absolutePath)) {
    return {
      path: htmlPath,
      exists: false,
      matchesCurrentWorksheet: false,
      next:
        "Run npm run instacomp:trial:answer-key-html to write the local visual answer-key review sheet.",
      error: null,
    };
  }

  try {
    const text = readFileSync(absolutePath, "utf8");
    const expectedCards = manifestAudit.expectedCards ?? worksheetStatus.rowCount ?? 100;
    const loadedCards =
      worksheetStatus.rowCount || manifestAudit.observedCards || expectedCards;
    const readyRows =
      worksheetStatus.coreReadyRows ?? manifestAudit.readyRows ?? "unknown";
    const shortLot =
      Number.isFinite(Number(expectedCards)) &&
      Number.isFinite(Number(loadedCards)) &&
      Number(loadedCards) < Number(expectedCards);
    const shortLotCount = shortLot ? Number(expectedCards) - Number(loadedCards) : 0;
    const matchesCurrentWorksheet =
      text.includes("TCOS InstaComp™ Trial Answer-Key Review") &&
      (text.includes(`Answer key ${readyRows}/${loadedCards}`) ||
        text.includes(`Answer key ${readyRows}/${expectedCards}`)) &&
      text.includes("npm run instacomp:trial:groundtruth:apply") &&
      text.includes("http://localhost:3000/admin/instacomp");

    return {
      path: htmlPath,
      exists: true,
      matchesCurrentWorksheet,
      expectedCards,
      loadedCards,
      shortLot,
      shortLotCount,
      next: matchesCurrentWorksheet
        ? shortLot
          ? `Visual answer-key sheet matches the loaded ${loadedCards}/${expectedCards} card worksheet. Add ${shortLotCount} more card pair(s), rerun intake/prep, then regenerate before the final 100-card scan; current loaded rows can still be filled now.`
          : worksheetStatus.coreReadyRows >= expectedCards
          ? "Visual answer-key sheet matches the filled worksheet; validate the TSV, apply it, and rerun intake."
          : "Visual answer-key sheet matches the current worksheet; use it beside the TSV while filling missing fields."
        : "Rerun npm run instacomp:trial:answer-key-html so the visual sheet matches the current TSV/manifest.",
      error: null,
    };
  } catch (error) {
    return {
      path: htmlPath,
      exists: true,
      matchesCurrentWorksheet: false,
      expectedCards: manifestAudit.expectedCards ?? worksheetStatus.rowCount ?? 100,
      loadedCards: worksheetStatus.rowCount || manifestAudit.observedCards || 0,
      shortLot: false,
      shortLotCount: 0,
      next: `Rerun npm run instacomp:trial:answer-key-html; visual sheet could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTrialAnswerKeyValidationStatus(worksheetStatus) {
  const receiptPath = "instacomp-trial-answer-key-validation.local.json";
  const markdownPath = "instacomp-trial-answer-key-validation.local.md";
  const absolutePath = join(repoRoot, receiptPath);

  if (!existsSync(absolutePath)) {
    return {
      path: receiptPath,
      markdownPath,
      exists: false,
      ok: false,
      matchesCurrentWorksheet: false,
      readyCoreRows: 0,
      rowCount: 0,
      next:
        "Run npm run instacomp:trial:answer-key:validate before applying the TSV back to the manifest.",
      error: null,
    };
  }

  try {
    const payload = JSON.parse(readFileSync(absolutePath, "utf8"));
    const matchesCurrentWorksheet =
      payload.schema === "tcos.instacompTrialAnswerKeyValidation.v1" &&
      payload.worksheet?.path === "instacomp-trial-groundtruth.local.tsv" &&
      Number(payload.worksheet?.rowCount || 0) === Number(worksheetStatus.rowCount || 0) &&
      Number(payload.counts?.readyCoreRows || 0) === Number(worksheetStatus.coreReadyRows || 0);

    return {
      path: receiptPath,
      markdownPath,
      exists: true,
      ok: Boolean(payload.ok),
      matchesCurrentWorksheet,
      readyCoreRows: Number(payload.counts?.readyCoreRows || 0),
      rowCount: Number(payload.worksheet?.rowCount || 0),
      missingCoreRows: Number(payload.counts?.missingCoreRows || 0),
      duplicateTrialCardIds: Number(payload.counts?.duplicateTrialCardIds || 0),
      missingTrialCardIdRows: Number(payload.counts?.missingTrialCardIdRows || 0),
      missingWorksheetTrialCardIds: Number(payload.counts?.missingWorksheetTrialCardIds || 0),
      extraWorksheetTrialCardIds: Number(payload.counts?.extraWorksheetTrialCardIds || 0),
      imagePathDriftRows: Number(payload.counts?.imagePathDriftRows || 0),
      rowOrderDriftRows: Number(payload.counts?.rowOrderDriftRows || 0),
      booleanWarnings: Number(payload.counts?.booleanWarnings || 0),
      next: matchesCurrentWorksheet
        ? payload.ok
          ? "Answer-key validation is clean. Run npm run instacomp:trial:groundtruth:apply."
          : payload.next ||
            "Fix the answer-key validation issues, then rerun npm run instacomp:trial:answer-key:validate."
        : "Rerun npm run instacomp:trial:answer-key:validate so the validation receipt matches the current TSV.",
      error: null,
    };
  } catch (error) {
    return {
      path: receiptPath,
      markdownPath,
      exists: true,
      ok: false,
      matchesCurrentWorksheet: false,
      readyCoreRows: 0,
      rowCount: 0,
      next: `Rerun npm run instacomp:trial:answer-key:validate; validation receipt could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runTrialPreflightStatus() {
  const command = [
    "node",
    "scripts/run-instacomp-trial-preflight.mjs",
    "--manifest",
    "instacomp-trial-manifest.local.json",
    "--images",
    "instacomp-trial-images",
    "--image-map",
    "instacomp-trial-image-map.local.json",
    "--intake-packet",
    "instacomp-trial-intake-packet.local.md",
    "--expected-cards",
    "100",
    "--allow-not-ready",
    "--json",
  ];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: statusJsonMaxBuffer,
  });
  const stdout = (result.stdout || "").trim();

  try {
    const payload = JSON.parse(stdout);
    const scanPermit = payload.scanPermit || {};
    const operatorNextActions = Array.isArray(payload.operatorNextActions)
      ? payload.operatorNextActions
      : [];
    const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];

    return {
      command: "npm run instacomp:trial:preflight",
      available: true,
      generatedAt: payload.generatedAt || null,
      readyToScan: Boolean(payload.readyToScan),
      scanPermit: {
        status:
          scanPermit.status ||
          (payload.readyToScan ? "SCAN_PERMIT_GRANTED" : "SCAN_PERMIT_BLOCKED"),
        canScan: Boolean(scanPermit.canScan),
        summary:
          scanPermit.summary ||
          (payload.readyToScan
            ? "Answer key and image receipts are ready."
            : "Do not scan yet; preflight still has blockers."),
        operatorWarning: scanPermit.operatorWarning || null,
        progress: scanPermit.progress || {},
      },
      blockerCount: blockers.length,
      blockers: blockers.slice(0, 5).map((blocker) => ({
        key: blocker.key || "unknown",
        label: blocker.label || "",
        next: blocker.next || "",
      })),
      operatorNextActions: operatorNextActions.slice(0, 6).map((action) => ({
        key: action.key || "unknown",
        type: action.type || "unknown",
        command: action.command || "",
        why: action.why || "",
      })),
      next: payload.next || "Run npm run instacomp:trial:preflight.",
      exitStatus: result.status,
      error: result.status === 0 ? null : (result.stderr || "").trim() || null,
    };
  } catch (error) {
    return {
      command: "npm run instacomp:trial:preflight",
      available: false,
      generatedAt: null,
      readyToScan: false,
      scanPermit: {
        status: "SCAN_PERMIT_UNKNOWN",
        canScan: false,
        summary: "Preflight JSON could not be read; do not scan until preflight is repaired.",
        operatorWarning: "Run preflight directly before spending scanner time.",
        progress: {},
      },
      blockerCount: null,
      blockers: [],
      operatorNextActions: [
        {
          key: "rerun_preflight",
          type: "command",
          command: "npm run instacomp:trial:preflight",
          why: "Inspect the preflight error directly and restore scan-permit proof.",
        },
      ],
      next: "Run npm run instacomp:trial:preflight directly to inspect the scan-permit error.",
      exitStatus: result.status,
      error:
        (result.stderr || "").trim() ||
        `Could not parse trial preflight JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

function getFinalTrialImageShortfall(preflight) {
  const progress = preflight.scanPermit?.progress || {};
  const imagePairs = Number(progress.imagePairs);
  const expectedImagePairs = Number(progress.expectedImagePairs);
  const imageFiles = Number(progress.imageFiles);
  const expectedImages = Number(progress.expectedImages);
  const missingPairs =
    Number.isFinite(imagePairs) && Number.isFinite(expectedImagePairs)
      ? Math.max(0, expectedImagePairs - imagePairs)
      : null;
  const missingFiles =
    Number.isFinite(imageFiles) && Number.isFinite(expectedImages)
      ? Math.max(0, expectedImages - imageFiles)
      : null;

  return {
    missingPairs,
    missingFiles,
    isShort:
      (missingPairs !== null && missingPairs > 0) ||
      (missingFiles !== null && missingFiles > 0),
  };
}

function describeFinalTrialImageShortfall(shortfall) {
  if (!shortfall.isShort) return "The final tester image lot is not short.";

  const fileText =
    shortfall.missingFiles === null
      ? "missing image files"
      : `${shortfall.missingFiles} missing image file(s)`;
  const pairText =
    shortfall.missingPairs === null
      ? "missing card pair(s)"
      : `${shortfall.missingPairs} missing card pair(s)`;

  return `Current receipts match the loaded image audit, but the final 100-card lot is still short: ${fileText} / ${pairText}.`;
}

function getTrialReceiptStatus({ matchesCurrentAudit, needsCurrentReceiptStatus, preflight, shortfall }) {
  if (!matchesCurrentAudit) return needsCurrentReceiptStatus;
  if (preflight.readyToScan) return "ready_to_scan";
  if (shortfall.isShort) return "receipt_current_but_final_lot_short";
  if (preflight.available) return "receipt_current_but_scan_permit_blocked";
  return "receipt_current_but_preflight_unknown";
}

function getTrialReceiptNext({ matchesCurrentAudit, refreshCommand, preflight, shortfall }) {
  if (!matchesCurrentAudit) {
    return `Rerun ${refreshCommand} so the local receipt matches the current image folder before any scan.`;
  }

  if (preflight.readyToScan) {
    return "Final preflight granted the scan permit; use this receipt as the pre-scan proof.";
  }

  if (shortfall.isShort) {
    return `${describeFinalTrialImageShortfall(shortfall)} Copy the missing images into instacomp-trial-inbox, then rerun npm run instacomp:trial:intake and npm run instacomp:trial:preflight.`;
  }

  if (preflight.available) {
    return `Receipt is current, but the scan permit is still blocked: ${preflight.next}`;
  }

  return "Receipt is current, but preflight proof could not be read; rerun npm run instacomp:trial:preflight before scanning.";
}

const manifestPath = "instacomp-trial-manifest.local.json";
const resultsPath = "instacomp-trial-results.local.json";
const trialInboxDir = "instacomp-trial-inbox";
const trialImagesDir = "instacomp-trial-images";
const trialInboxAbsolutePath = join(repoRoot, trialInboxDir);
const trialImagesAbsolutePath = join(repoRoot, trialImagesDir);
const trialImageDropZoneGuide = {
  rawInboxLocalPath: trialInboxAbsolutePath,
  localPath: trialImagesAbsolutePath,
  ignoredByGit: true,
  expectedCards: 100,
  expectedImages: 200,
  acceptedImageExtensions: [
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
  ],
  orderedScannerPattern:
    "Plain ordered image files are paired as 1+2, 3+4, 5+6, etc. Example: scan_0001.jpg is card 001 front and scan_0002.jpg is card 001 back.",
  explicitPairPattern:
    "Explicit side filenames can use front/fr/f/obverse and back/bk/b/reverse/rear. Example: 001-front.jpg + 001-back.jpg.",
  afterCopyCommands: [
    "npm run instacomp:trial:intake",
    "npm run instacomp:trial:stage-images",
    "npm run instacomp:trial:stage-images -- --apply",
    "npm run instacomp:trial:prep",
    "npm run instacomp:trial:sync-images",
    "npm run instacomp:trial:groundtruth:sheet",
    "npm run instacomp:trial:answer-key-html",
    "npm run instacomp:trial:answer-key:validate",
    "npm run instacomp:trial:groundtruth:apply",
    "npm run instacomp:trial:groundtruth",
    "npm run instacomp:trial:preflight",
    "npm run instacomp:trial:monitor",
    "npm run instacomp:trial:ready",
    "npm run status:instacomp-final-tester",
  ],
};
const trialInboxImageCount = countAcceptedImageFilesIfPresent(trialInboxDir);
const trialInboxNonImageFileCount = countNonImageFilesIfPresent(trialInboxDir);
const trialImageCount = countAcceptedImageFilesIfPresent(trialImagesDir);
const trialNonImageFileCount = countNonImageFilesIfPresent(trialImagesDir);
const trialManifestAudit = runTrialManifestAudit();
const trialImageAudit = runTrialImageAudit();
const trialImageMap = readTrialImageMapStatus(trialImageAudit);
const trialIntakePacket = readTrialIntakePacketStatus(
  trialImageAudit,
  trialImageMap,
);
const trialGroundTruthGuide = readTrialGroundTruthGuideStatus(trialManifestAudit);
const trialGroundTruthWorksheet = readTrialGroundTruthWorksheetStatus(trialManifestAudit);
const trialAnswerKeyHtml = readTrialAnswerKeyHtmlStatus(
  trialManifestAudit,
  trialGroundTruthWorksheet,
);
const trialAnswerKeyValidation = readTrialAnswerKeyValidationStatus(trialGroundTruthWorksheet);
const trialPreflight = runTrialPreflightStatus();
const finalTrialImageShortfall = getFinalTrialImageShortfall(trialPreflight);

const checklist = [
  {
    key: "multi_scanner_consensus",
    label:
      "InstaComp™ Multi-Scanner Consensus is wired into scan results: independent AI/OCR readers submit structured findings, TCOS consensus compares them, checklist/catalog truth can referee, fast/full council mode plus risk tier are visible, and the UI shows the reason trail before comps, sell, or trade confidence is trusted.",
    status: "ready_to_test",
  },
  {
    key: "durable_batch_queue",
    label: "Durable batch upload, queue claims, retry, clear batch, and recovery are testable.",
    status: "ready_to_test",
  },
  {
    key: "image_review_controls",
    label:
      "Front/back thumbnails open large, rotate in 45-degree steps, and must not shrink images or mutate filenames.",
    status: "ready_to_test",
  },
  {
    key: "identity_accuracy",
    label:
      "Set/checklist identity must catch variants, inserts, Clear Cut, serial runs, and avoid generic Base unless it is real card text.",
    status: "ready_to_test",
  },
  {
    key: "title_quality",
    label:
      "Draft titles must avoid repeated names, repeated releases, repeated parallels, and wrong Upper Deck/O-Pee-Chee manufacturer wording.",
    status: "ready_to_test",
  },
  {
    key: "pricing_and_comps",
    label:
      "COMC active listing pricing stays out; comps must use approved sources or fall back to manual/listing review without pretending certainty.",
    status: "ready_to_test",
  },
  {
    key: "sell_or_trade_handoff",
    label:
      "Buy Me on TCOS, Trade For Me on TCOS, and Add to Available for Trade are mutually safe; a scan row cannot become both sell and trade.",
    status: "ready_to_test",
  },
  {
    key: "speed_and_pressure",
    label:
      "Fast batch prep, five-row claim mini-packs, and database-pressure governor are ready for a real lot timing test.",
    status: "ready_to_test",
  },
  {
    key: "trial_results_export",
    label:
      "Admin InstaComp™ can export or copy completed visible batch rows as tcos.instacompTrialResults.v1 JSON for the 94% scorekeeper, including consensus/review status, row-stable trialCardId values, and per-row timing evidence.",
    status: "ready_to_test",
  },
  {
    key: "trial_failure_report",
    label:
      "The 94% scorekeeper can enforce timing evidence plus average/p95 speed targets and write tcos.instacompTrialFailureReport.v1 JSON with missing rows, mismatched fields, consensus-review blockers, speed misses, and suggested fix actions.",
    status: "ready_to_test",
  },
  {
    key: "trial_speed_gate_hud",
    label:
      "Admin InstaComp™ shows a Final Tester Gate HUD with visible result count, timing coverage, average speed, p95 speed, and FINAL TESTER PASS/NOT READY status before export.",
    status: "ready_to_test",
  },
  {
    key: "trial_groundtruth_manifest",
    label:
      "The pre-scan ground-truth manifest audit can prove each trial row has expected player, year, set, and card number before scanner time is spent or the 94% scorekeeper is trusted.",
    status: trialManifestAudit.readyToScore ? "ready_to_score" : "needs_groundtruth",
  },
  {
    key: "trial_groundtruth_sheet",
    label:
      "The local ground-truth worksheet can export the 100-card manifest to an ignored TSV, let the operator fill the answer key in a spreadsheet, validate it, and apply it back to the manifest before the audit.",
    status: trialGroundTruthWorksheet.requiredColumnsPresent
      ? trialGroundTruthWorksheet.coreReadyRows >=
        (trialManifestAudit.expectedCards ?? trialGroundTruthWorksheet.rowCount)
        ? "ready_to_apply"
        : "worksheet_current_but_needs_groundtruth"
      : "needs_groundtruth_sheet",
  },
  {
    key: "trial_groundtruth_guide",
    label:
      "The final tester status can prove the local answer-key guide exists, matches the current ground-truth audit, and points the operator at the exact TSV apply/recheck commands.",
    status: trialGroundTruthGuide.matchesCurrentAudit
      ? trialManifestAudit.readyToScore
        ? "ready_to_score"
        : "guide_current_but_needs_groundtruth"
      : "needs_answer_key_guide",
  },
  {
    key: "trial_answer_key_html",
    label:
      "The local visual answer-key HTML sheet can show trial front/back thumbnails next to editable TSV identity fields, then copy or download the updated TSV so the 100-card answer key can be filled faster and with fewer row mistakes.",
    status: trialAnswerKeyHtml.matchesCurrentWorksheet
      ? trialAnswerKeyHtml.shortLot
        ? "html_current_but_lot_short"
        : trialManifestAudit.readyToScore
        ? "ready_to_score"
        : "html_current_but_needs_groundtruth"
      : "needs_answer_key_html",
  },
  {
    key: "trial_answer_key_validation",
    label:
      "The local answer-key validator can check copied/downloaded TSV rows for required columns, duplicate/missing IDs, row-count drift, missing player/year/set/card-number fields, image-path drift, and safe no-apply side effects before the manifest is updated.",
    status: trialAnswerKeyValidation.matchesCurrentWorksheet
      ? trialAnswerKeyValidation.ok
        ? "validated_ready_to_apply"
        : "validation_current_but_needs_groundtruth"
      : "needs_answer_key_validation",
  },
  {
    key: "trial_prep_bundle",
    label:
      "The one-command local prep bundle can create a missing manifest, preserve an existing answer sheet, refresh the image-map/intake packet, and write JSON/Markdown preflight proof before scan time is spent.",
    status: "ready_to_test",
  },
  {
    key: "trial_intake_cockpit",
    label:
      "The one-command local intake cockpit can dry-run staging, refresh prep/preflight receipts, sync manifest/worksheet image paths, and write one JSON/Markdown next-action receipt without applying staging or touching live systems.",
    status: "ready_to_test",
  },
  {
    key: "trial_image_staging",
    label:
      "The local image staging helper can dry-run raw scanner exports from instacomp-trial-inbox, normalize clean pairs into instacomp-trial-images as 001-front/001-back files, and write a receipt without deleting originals.",
    status: "ready_to_test",
  },
  {
    key: "trial_raw_inbox_dropzone",
    label:
      "The final tester status can show how many accepted scanner image files are waiting in the raw instacomp-trial-inbox drop zone before staging.",
    status:
      trialInboxImageCount >= 200
        ? "ready_for_intake"
        : trialInboxImageCount > 0
          ? "partial_raw_inbox"
          : "needs_local_trial_files",
  },
  {
    key: "trial_image_path_sync",
    label:
      "The local image-path sync can update manifest and worksheet front/back image columns from the current image-map receipt without changing answer-key identity fields.",
    status: "ready_to_test",
  },
  {
    key: "trial_readiness_monitor",
    label:
      "The local readiness monitor can show answer-key rows, image-file count, complete pairs, stale receipts, readiness gates, ordered operator next actions, first missing rows/files, and the exact next command while the 100-card lot is being loaded.",
    status: "ready_to_test",
  },
  {
    key: "trial_image_audit",
    label:
      "The pre-scan image audit can catch missing fronts/backs, duplicate images, unknown filenames, and extra files before the 100-card lot burns scanner time.",
    status: "ready_to_test",
  },
  {
    key: "trial_image_map",
    label:
      "The pre-scan image-map receipt can prove which uploaded scanner file became each trial card front/back pair before the lot is scanned.",
    status: getTrialReceiptStatus({
      matchesCurrentAudit: trialImageMap.matchesCurrentAudit,
      needsCurrentReceiptStatus: trialImageAudit.readyToScan
        ? "needs_image_map"
        : "needs_local_trial_files",
      preflight: trialPreflight,
      shortfall: finalTrialImageShortfall,
    }),
    next: getTrialReceiptNext({
      matchesCurrentAudit: trialImageMap.matchesCurrentAudit,
      refreshCommand: "npm run instacomp:trial:map",
      preflight: trialPreflight,
      shortfall: finalTrialImageShortfall,
    }),
  },
  {
    key: "trial_preflight_gate",
    label:
      "The one-shot final tester preflight can prove the answer key, image pairs, image-map receipt, and intake packet are all current, then issue an explicit scan permit and ordered operator next actions before the operator spends scanner time.",
    status: trialPreflight.readyToScan
      ? "scan_permit_granted"
      : trialPreflight.available
        ? "scan_permit_blocked"
        : "needs_preflight_repair",
  },
  {
    key: "trial_intake_packet",
    label:
      "The pre-scan intake packet can give the operator a readable image-count, pairing-preview, problem-list, and next-command receipt before scanner time is spent.",
    status: getTrialReceiptStatus({
      matchesCurrentAudit: trialIntakePacket.matchesCurrentAudit,
      needsCurrentReceiptStatus: "needs_trial_packet",
      preflight: trialPreflight,
      shortfall: finalTrialImageShortfall,
    }),
    next: getTrialReceiptNext({
      matchesCurrentAudit: trialIntakePacket.matchesCurrentAudit,
      refreshCommand: "npm run instacomp:trial:packet",
      preflight: trialPreflight,
      shortfall: finalTrialImageShortfall,
    }),
  },
  {
    key: "hundred_card_trial",
    label:
      "100-card / 200-scan final trial must score at least 94% against the local ground-truth manifest and pass the final tester speed gate: timing required, average <= 15s/card, p95 <= 45s/card.",
    status: existsSync(join(repoRoot, manifestPath)) && existsSync(join(repoRoot, resultsPath))
      ? trialManifestAudit.readyToScore
        ? "ready_to_score"
        : "needs_groundtruth"
      : trialPreflight.readyToScan
        ? "ready_to_scan"
        : trialPreflight.available
          ? "scan_permit_blocked"
        : "needs_local_trial_files",
  },
  {
    key: "ui_cleanup",
    label:
      "Final tester should identify the ugly UI spots before the polish pass; no production-live claim until the tester is clean.",
    status: "ready_to_test",
  },
];

const readiness = {
  schema: "tcos.instacompFinalTesterReadiness.v1",
  generatedAt: new Date().toISOString(),
  targetReadyByLocal: "2026-07-16",
  priority: "front_of_goal_todo",
  testerUrl: "http://localhost:3000/admin/instacomp",
  git: {
    head: runGit(["rev-parse", "--short", "HEAD"]) || "unknown",
    originMain: runGit(["rev-parse", "--short", "origin/main"]) || "unknown",
    workingTreeClean: runGit(["status", "--short"]) === "",
  },
  localTrial: {
    manifestPath,
    manifestExists: existsSync(join(repoRoot, manifestPath)),
    resultsPath,
    resultsExists: existsSync(join(repoRoot, resultsPath)),
    inboxDir: trialInboxDir,
    inboxAbsolutePath: trialInboxAbsolutePath,
    inboxDirExists: existsSync(trialInboxAbsolutePath),
    inboxImageFileCount: trialInboxImageCount,
    inboxNonImageFileCount: trialInboxNonImageFileCount,
    imagesDir: trialImagesDir,
    imagesAbsolutePath: trialImagesAbsolutePath,
    imagesDirExists: existsSync(trialImagesAbsolutePath),
    imageFileCount: trialImageCount,
    nonImageFileCount: trialNonImageFileCount,
    expectedImageCount: 200,
    imageDropZoneGuide: trialImageDropZoneGuide,
    manifestAudit: trialManifestAudit,
    groundTruthWorksheet: trialGroundTruthWorksheet,
    groundTruthGuide: trialGroundTruthGuide,
    answerKeyHtml: trialAnswerKeyHtml,
    answerKeyValidation: trialAnswerKeyValidation,
    imageAudit: trialImageAudit,
    imageMap: trialImageMap,
    intakePacket: trialIntakePacket,
    preflight: trialPreflight,
  },
  checklist,
  commands: {
    openTester: "http://localhost:3000/admin/instacomp",
    buildConsensus:
      "Implement InstaComp™ Multi-Scanner Consensus before the final July 16 tester pass.",
    verifyHarness: "npm run verify:instacomp",
    intakeTrial: "npm run instacomp:trial:intake",
    initTrial: "npm run instacomp:trial:init",
    writeTrialGroundTruthSheet: "npm run instacomp:trial:groundtruth:sheet",
    writeTrialAnswerKeyHtml: "npm run instacomp:trial:answer-key-html",
    validateTrialAnswerKey: "npm run instacomp:trial:answer-key:validate",
    applyTrialGroundTruthSheet: "npm run instacomp:trial:groundtruth:apply",
    refreshTrialAnswerKeyGuide: "npm run instacomp:trial:intake",
    prepTrial: "npm run instacomp:trial:prep",
    stageTrialImages: "npm run instacomp:trial:stage-images",
    applyStagedTrialImages: "npm run instacomp:trial:stage-images -- --apply",
    syncTrialImages: "npm run instacomp:trial:sync-images",
    monitorTrial: "npm run instacomp:trial:monitor",
    monitorTrialJson: "npm run instacomp:trial:monitor:json",
    auditTrialGroundTruth: "npm run instacomp:trial:groundtruth",
    auditTrialImages: "npm run instacomp:trial:audit",
    mapTrialImages: "npm run instacomp:trial:map",
    writeTrialPacket: "npm run instacomp:trial:packet",
    preflightTrial: "npm run instacomp:trial:preflight",
    readyTrialImages: "npm run instacomp:trial:ready",
    scoreTrial:
      "npm run instacomp:trial:score",
    scoreTrialFailures: "npm run instacomp:trial:failures",
    fullLocalSafety:
      "npm run lint && npm run verify:instacomp && npm run build && npm run check:production-guardrails",
  },
  next:
    "Run the 100-card lot through the wired Multi-Scanner Consensus path, score it against 94% plus the final tester timing gate, record misses, and clean the UI before calling it done-done.",
  safeBuildBoundary:
    "This InstaComp™ tester status is read-only. It does not approve live money, buy postage, release payouts, create Checkout, publish listings, or start production deploys.",
};

if (jsonOutput) {
  console.log(JSON.stringify(readiness, null, 2));
} else {
  console.log("TCOS InstaComp™ final tester readiness:");
  console.log(`- target ready by local: ${readiness.targetReadyByLocal}`);
  console.log(`- priority: ${readiness.priority}`);
  console.log(`- tester URL: ${readiness.testerUrl}`);
  console.log(`- git HEAD: ${readiness.git.head}`);
  console.log(`- git origin/main: ${readiness.git.originMain}`);
  console.log(`- git working tree clean: ${readiness.git.workingTreeClean ? "yes" : "no"}`);
  console.log(`- trial manifest: ${readiness.localTrial.manifestExists ? "present" : "missing"}`);
  console.log(`- trial results: ${readiness.localTrial.resultsExists ? "present" : "missing"}`);
  console.log(
    `- trial ground truth ready: ${readiness.localTrial.manifestAudit.readyToScore ? "yes" : "no"}`,
  );
  console.log(
    `- trial ground truth rows: ${readiness.localTrial.manifestAudit.readyRows ?? "unknown"}/${readiness.localTrial.manifestAudit.expectedCards ?? "unknown"} core-ready`,
  );
  console.log(
    `- trial ground truth core fields: ${readiness.localTrial.manifestAudit.coreFields.length ? readiness.localTrial.manifestAudit.coreFields.join(", ") : "unknown"}`,
  );
  console.log(
    `- trial ground truth problems: missing core rows ${readiness.localTrial.manifestAudit.missingCoreRows ?? "unknown"}, duplicate trialCardId rows ${readiness.localTrial.manifestAudit.duplicateTrialCardIdCount ?? "unknown"}, missing trialCardId rows ${readiness.localTrial.manifestAudit.missingTrialCardIdCount ?? "unknown"}, short manifest rows ${readiness.localTrial.manifestAudit.shortManifestRows ?? "unknown"}`,
  );
  if (readiness.localTrial.manifestAudit.firstMissingCoreRows.length > 0) {
    console.log(
      `- first missing ground-truth rows: ${readiness.localTrial.manifestAudit.firstMissingCoreRows
        .map((row) => `${row.trialCardId} missing ${row.missing.join("/")}`)
        .join(", ")}`,
    );
  }
  console.log(`- trial ground truth next: ${readiness.localTrial.manifestAudit.next}`);
  console.log(
    `- trial answer-key worksheet: ${readiness.localTrial.groundTruthWorksheet.exists ? "present" : "missing"} - rows ${readiness.localTrial.groundTruthWorksheet.coreReadyRows}/${readiness.localTrial.groundTruthWorksheet.rowCount} core-ready - ${readiness.localTrial.groundTruthWorksheet.path}`,
  );
  console.log(
    `- trial answer-key worksheet columns: ${readiness.localTrial.groundTruthWorksheet.requiredColumnsPresent ? "ok" : `missing ${readiness.localTrial.groundTruthWorksheet.missingColumns.join(", ")}`}`,
  );
  if (readiness.localTrial.groundTruthWorksheet.error) {
    console.log(
      `- trial answer-key worksheet error: ${readiness.localTrial.groundTruthWorksheet.error}`,
    );
  }
  console.log(
    `- trial answer-key worksheet next: ${readiness.localTrial.groundTruthWorksheet.next}`,
  );
  console.log(
    `- trial answer-key guide: ${readiness.localTrial.groundTruthGuide.exists ? "present" : "missing"} - ${readiness.localTrial.groundTruthGuide.matchesCurrentAudit ? "matches audit" : "not ready"} - ${readiness.localTrial.groundTruthGuide.path}`,
  );
  if (readiness.localTrial.groundTruthGuide.error) {
    console.log(`- trial answer-key guide error: ${readiness.localTrial.groundTruthGuide.error}`);
  }
  console.log(`- trial answer-key guide next: ${readiness.localTrial.groundTruthGuide.next}`);
  console.log(
    `- trial answer-key HTML: ${readiness.localTrial.answerKeyHtml.exists ? "present" : "missing"} - ${readiness.localTrial.answerKeyHtml.matchesCurrentWorksheet ? "matches worksheet" : "not ready"} - ${readiness.localTrial.answerKeyHtml.path}`,
  );
  if (readiness.localTrial.answerKeyHtml.error) {
    console.log(`- trial answer-key HTML error: ${readiness.localTrial.answerKeyHtml.error}`);
  }
  console.log(`- trial answer-key HTML next: ${readiness.localTrial.answerKeyHtml.next}`);
  console.log(
    `- trial answer-key validation: ${readiness.localTrial.answerKeyValidation.exists ? "present" : "missing"} - ${readiness.localTrial.answerKeyValidation.matchesCurrentWorksheet ? "matches worksheet" : "not ready"} - ${readiness.localTrial.answerKeyValidation.ok ? "clean" : "needs fixes"} - ${readiness.localTrial.answerKeyValidation.path}`,
  );
  if (readiness.localTrial.answerKeyValidation.error) {
    console.log(
      `- trial answer-key validation error: ${readiness.localTrial.answerKeyValidation.error}`,
    );
  }
  console.log(
    `- trial answer-key validation next: ${readiness.localTrial.answerKeyValidation.next}`,
  );
  console.log(
    `- trial raw scanner inbox exists: ${readiness.localTrial.inboxDirExists ? "yes" : "no"}`,
  );
  console.log(`- trial raw scanner inbox: ${readiness.localTrial.inboxAbsolutePath}`);
  console.log(
    `- trial raw scanner inbox files: ${readiness.localTrial.inboxImageFileCount}/${readiness.localTrial.expectedImageCount} accepted images in ${trialInboxDir}`,
  );
  console.log(
    `- trial raw scanner inbox non-image files ignored: ${readiness.localTrial.inboxNonImageFileCount}`,
  );
  console.log(
    `- trial raw scanner inbox next: ${
      readiness.localTrial.inboxImageFileCount >= readiness.localTrial.expectedImageCount
        ? "Run npm run instacomp:trial:intake to dry-run staging and refresh the local receipts."
        : readiness.localTrial.inboxImageFileCount > 0
          ? "Keep copying scanner files until the inbox has about 200 accepted images, then run npm run instacomp:trial:intake."
          : "Copy scanner files into instacomp-trial-inbox, then run npm run instacomp:trial:intake."
    }`,
  );
  console.log(`- trial image folder exists: ${readiness.localTrial.imagesDirExists ? "yes" : "no"}`);
  console.log(`- trial image drop zone: ${readiness.localTrial.imagesAbsolutePath}`);
  console.log(
    `- accepted trial image patterns: ordered scanner files pair 1+2, 3+4, 5+6; or explicit 001-front.jpg + 001-back.jpg`,
  );
  console.log(
    `- accepted trial side words: front/fr/f/obverse and back/bk/b/reverse/rear`,
  );
  console.log(
    `- after copying images: ${readiness.localTrial.imageDropZoneGuide.afterCopyCommands.join(" | ")}`,
  );
  console.log(
    `- trial image files: ${readiness.localTrial.imageFileCount}/${readiness.localTrial.expectedImageCount} accepted images in ${trialImagesDir}`,
  );
  console.log(
    `- trial non-image files ignored: ${readiness.localTrial.nonImageFileCount}`,
  );
  console.log(
    `- trial image audit ready: ${readiness.localTrial.imageAudit.readyToScan ? "yes" : "no"}`,
  );
  console.log(
    `- trial image audit pairs: ${readiness.localTrial.imageAudit.completePairs ?? "unknown"}/${readiness.localTrial.imageAudit.expectedCards ?? "unknown"}`,
  );
  console.log(
    `- trial ordered-pair files: ${readiness.localTrial.imageAudit.orderedPairCandidateFiles ?? "unknown"} files / ${readiness.localTrial.imageAudit.orderedPairCompletePairs ?? "unknown"} pairs`,
  );
  console.log(
    `- trial image map: ${readiness.localTrial.imageMap.exists ? "present" : "missing"} - ${readiness.localTrial.imageMap.matchesCurrentAudit ? "matches audit" : "not ready"} - rows ${readiness.localTrial.imageMap.rowCount}/${readiness.localTrial.imageAudit.expectedCards ?? "unknown"}`,
  );
  if (readiness.localTrial.imageMap.generatedAt) {
    console.log(`- trial image map generated: ${readiness.localTrial.imageMap.generatedAt}`);
  }
  if (readiness.localTrial.imageMap.error) {
    console.log(`- trial image map error: ${readiness.localTrial.imageMap.error}`);
  }
  console.log(`- trial image map next: ${readiness.localTrial.imageMap.next}`);
  console.log(
    `- trial intake packet: ${readiness.localTrial.intakePacket.exists ? "present" : "missing"} - ${readiness.localTrial.intakePacket.matchesCurrentAudit ? "matches audit" : "not ready"}`,
  );
  console.log(`- trial intake packet next: ${readiness.localTrial.intakePacket.next}`);
  console.log(
    `- trial scan permit: ${readiness.localTrial.preflight.scanPermit.status} - ${readiness.localTrial.preflight.scanPermit.summary}`,
  );
  if (readiness.localTrial.preflight.scanPermit.operatorWarning) {
    console.log(
      `- trial scan warning: ${readiness.localTrial.preflight.scanPermit.operatorWarning}`,
    );
  }
  console.log(
    `- trial preflight blockers: ${readiness.localTrial.preflight.blockerCount ?? "unknown"}`,
  );
  if (readiness.localTrial.preflight.blockers.length > 0) {
    console.log(
      `- first preflight blockers: ${readiness.localTrial.preflight.blockers
        .map((blocker) => `${blocker.key}: ${blocker.next}`)
        .join(" | ")}`,
    );
  }
  if (readiness.localTrial.preflight.operatorNextActions.length > 0) {
    console.log(
      `- trial preflight next actions: ${readiness.localTrial.preflight.operatorNextActions
        .map((action, index) => `${index + 1}. ${action.command}`)
        .join(" | ")}`,
    );
  }
  console.log(`- trial preflight next: ${readiness.localTrial.preflight.next}`);
  console.log(
    `- trial image audit problems: missing fronts ${readiness.localTrial.imageAudit.missingFrontCount ?? "unknown"}, missing backs ${readiness.localTrial.imageAudit.missingBackCount ?? "unknown"}, duplicates ${Number(readiness.localTrial.imageAudit.duplicateFrontCount || 0) + Number(readiness.localTrial.imageAudit.duplicateBackCount || 0)}, unknown files ${readiness.localTrial.imageAudit.unknownFileCount ?? "unknown"}, extra files ${readiness.localTrial.imageAudit.extraFileCount ?? "unknown"}`,
  );
  if (readiness.localTrial.imageAudit.firstMissingFronts.length > 0) {
    console.log(
      `- first missing fronts: ${readiness.localTrial.imageAudit.firstMissingFronts.join(", ")}`,
    );
  }
  if (readiness.localTrial.imageAudit.firstMissingBacks.length > 0) {
    console.log(
      `- first missing backs: ${readiness.localTrial.imageAudit.firstMissingBacks.join(", ")}`,
    );
  }
  console.log("");
  console.log("Done-done tester checklist:");
  for (const item of checklist) {
    console.log(`- ${item.status}: ${item.label}`);
    if (item.next) console.log(`  next: ${item.next}`);
  }
  console.log("");
  console.log("Commands:");
  console.log(`- verify harness: ${readiness.commands.verifyHarness}`);
  console.log(`- intake cockpit: ${readiness.commands.intakeTrial}`);
  console.log(`- init trial: ${readiness.commands.initTrial}`);
  console.log(`- write trial ground truth sheet: ${readiness.commands.writeTrialGroundTruthSheet}`);
  console.log(`- write trial answer-key HTML: ${readiness.commands.writeTrialAnswerKeyHtml}`);
  console.log(`- validate trial answer key: ${readiness.commands.validateTrialAnswerKey}`);
  console.log(`- apply trial ground truth sheet: ${readiness.commands.applyTrialGroundTruthSheet}`);
  console.log(`- refresh trial answer-key guide: ${readiness.commands.refreshTrialAnswerKeyGuide}`);
  console.log(`- prep trial bundle: ${readiness.commands.prepTrial}`);
  console.log(`- dry-run trial image staging: ${readiness.commands.stageTrialImages}`);
  console.log(`- apply trial image staging: ${readiness.commands.applyStagedTrialImages}`);
  console.log(`- sync trial image paths: ${readiness.commands.syncTrialImages}`);
  console.log(`- monitor trial readiness: ${readiness.commands.monitorTrial}`);
  console.log(`- audit trial ground truth: ${readiness.commands.auditTrialGroundTruth}`);
  console.log(`- audit trial images: ${readiness.commands.auditTrialImages}`);
  console.log(`- map trial images: ${readiness.commands.mapTrialImages}`);
  console.log(`- write trial packet: ${readiness.commands.writeTrialPacket}`);
  console.log(`- preflight trial: ${readiness.commands.preflightTrial}`);
  console.log(`- ready trial images: ${readiness.commands.readyTrialImages}`);
  console.log(`- score trial: ${readiness.commands.scoreTrial}`);
  console.log(`- score + write failure report: ${readiness.commands.scoreTrialFailures}`);
  console.log(`- full local safety: ${readiness.commands.fullLocalSafety}`);
  console.log("");
  console.log(`Next: ${readiness.next}`);
  console.log(`Safe build boundary: ${readiness.safeBuildBoundary}`);
}
