import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan } from "../mainstream-checklist/registry-tools.mjs";
import { normalizeGoGtsPdfCoordinates } from "./gogts-pdf-coordinate-normalizer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.SOURCE_DUPLICATE_PDF_RECEIPT || `${ROOT}/source-duplicate-pdf-recovery-receipt.json`);
const PLAN_DIR = resolve(process.env.SOURCE_DUPLICATE_PDF_PLAN_DIR || `${ROOT}/source-duplicate-pdf-plans`);
const MINIMUM_CARD_ROWS = Math.max(20, Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 20));
const EXACT_KEYS = new Set([
  "hockey|2021-22|upper-deck|the-cup-nhl",
  "hockey|2022-23|upper-deck|premier-nhl",
  "hockey|2023-24|upper-deck|skybox-metal-universe-nhl",
  "hockey|2024-25|upper-deck|series-two-nhl",
  "hockey|2024-25|upper-deck|sp-authentic-nhl",
]);

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath = resolve(ROOT, "output/summary.json");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(sourcesDir)) throw new Error("Verified harvest bundle is incomplete.");
mkdirSync(PLAN_DIR, { recursive: true });

const acronyms = new Map([["ahl","AHL"],["chl","CHL"],["nba","NBA"],["nfl","NFL"],["nhl","NHL"],["pwhl","PWHL"],["wnba","WNBA"]]);
const displayToken = (value) => String(value || "").split("-").filter(Boolean).map((part) => acronyms.get(part.toLowerCase()) || `${part.slice(0,1).toUpperCase()}${part.slice(1)}`).join(" ");
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const clean = (value) => String(value ?? "").normalize("NFKC").replace(/[®™]/g, "").replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
const normalizedKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function buildEntry(row, sourceUrl) {
  const [sportKey, seasonKey, manufacturerKey, productKey] = row.exactSetKey.split("|");
  const manufacturer = displayToken(manufacturerKey);
  const product = displayToken(productKey);
  return {
    id: `source-duplicate-pdf-${safeSlug(row.exactSetKey)}`,
    sourceName: new URL(sourceUrl).hostname,
    sourceUrl,
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: MINIMUM_CARD_ROWS,
    release: {
      exactSetKey: row.exactSetKey,
      canonicalName: `${seasonKey} ${manufacturer} ${product} ${displayToken(sportKey)}`,
      manufacturer,
      brand: null,
      product,
      releaseYear: Number(String(seasonKey).match(/\d{4}/)?.[0] || 0),
      season: seasonKey,
      sport: sportKey,
      league: null,
    },
  };
}

function explicitlyMultiSubjectSet(name) {
  const text = clean(name).toLowerCase();
  const multi = /\b(?:dual|triple|quad|quartet|quint(?:uple)?|sextet|six[- ]?way|octet|eight[- ]?way|multi(?:ple)?|combo|combination|pairing|book|booklet|ensemble)\b/i.test(text);
  const hitType = /\b(?:autograph|signature|signed|relic|memorabilia|patch|swatch|jersey|book|booklet)\b/i.test(text);
  return Boolean(text && multi && hitType);
}

function splitSubject(subject) {
  const text = clean(subject).replace(/\s+(?:RC|ROOKIE CARD|ROOKIE)$/i, "").replace(/\s+\(RC\)$/i, "").replace(/\s+\*+$/g, "").trim();
  const pieces = text.split(/\s+(?:\/|;|\+|&amp;)\s+/i).map(clean).filter((value) => value.length >= 2 && value.length <= 180);
  return pieces.length ? [...new Set(pieces)] : text ? [text] : [];
}

function statusForSet(setName) {
  const value = clean(setName).toLowerCase();
  return {
    autographStatus: /autograph|signature|signed/.test(value) ? "autograph" : "non-auto",
    memorabiliaStatus: /relic|memorabilia|patch|swatch|jersey|materials?/.test(value) ? "memorabilia" : "non-memorabilia",
  };
}

function buildParsedFromCoordinate(coordinate) {
  const cards = [];
  const parallels = [];
  const resolvedDuplicateGroups = [];
  const combinedMultiSubjectGroups = [];
  const errors = [];

  for (const bucket of coordinate.buckets || []) {
    const setName = clean(bucket.setName) || "Base Set";
    const status = statusForSet(setName);
    const byNumber = new Map();
    for (const row of bucket.rows || []) {
      const cardNumber = clean(row.cardNumber).replace(/^#\s*/, "");
      const subject = clean(row.subject);
      if (!cardNumber || !subject) continue;
      const key = normalizedKey(cardNumber);
      const list = byNumber.get(key) || [];
      list.push({
        cardNumber,
        subject,
        team: clean(row.team),
        sequence: clean(row.sequence),
      });
      byNumber.set(key, list);
    }

    for (const rows of byNumber.values()) {
      const subjectGroups = new Map();
      for (const row of rows) {
        const subjectKey = normalizedKey(row.subject);
        const list = subjectGroups.get(subjectKey) || [];
        list.push(row);
        subjectGroups.set(subjectKey, list);
      }
      const distinct = [...subjectGroups.values()].map((values) => values[0]);
      if (distinct.length > 1 && explicitlyMultiSubjectSet(setName)) {
        const players = [...new Set(distinct.flatMap((row) => splitSubject(row.subject)))];
        const teams = [...new Set(distinct.map((row) => row.team).filter(Boolean))];
        cards.push({
          setName,
          cardNumber: distinct[0].cardNumber,
          players,
          teams,
          rookieDesignation: /\b(?:rookie|rookies|young guns?|1st round rookies|future watch)\b/i.test(setName) || distinct.some((row) => /\bRC\b|\brookie\b/i.test(row.subject)),
          firstBowmanDesignation: false,
          ...status,
          variation: null,
          sourceNotes: "Coordinate-source rows combined as one source-proven multi-subject physical card.",
        });
        combinedMultiSubjectGroups.push({ setName, cardNumber: distinct[0].cardNumber, subjects: distinct.map((row) => row.subject) });
        continue;
      }

      for (const row of distinct) {
        const players = splitSubject(row.subject);
        if (!players.length) {
          errors.push({ code: "source_coordinate_subject_missing", severity: "error", message: `${setName} #${row.cardNumber} has no usable source subject.` });
          continue;
        }
        const sourceDisambiguator = distinct.length > 1 ? `Checklist subject: ${row.subject}` : null;
        cards.push({
          setName,
          cardNumber: row.cardNumber,
          players,
          teams: row.team ? [row.team] : [],
          rookieDesignation: /\b(?:rookie|rookies|young guns?|1st round rookies|future watch)\b/i.test(setName) || /\bRC\b|\brookie\b/i.test(row.subject),
          firstBowmanDesignation: false,
          ...status,
          variation: sourceDisambiguator,
          sourceNotes: [
            row.sequence ? `Source sequence ${row.sequence}` : "",
            distinct.length > 1 ? "Source-authentic duplicate card number preserved with checklist-subject variation." : "Coordinate-extracted source row.",
          ].filter(Boolean).join("; "),
        });
      }
      if (distinct.length > 1) {
        resolvedDuplicateGroups.push({ setName, cardNumber: distinct[0].cardNumber, subjects: distinct.map((row) => row.subject) });
      }
    }

    for (const parallel of bucket.parallels || []) {
      const name = clean(parallel.name);
      if (!name) continue;
      parallels.push({
        setName,
        name,
        serialRun: Number.isFinite(Number(parallel.serialRun)) && Number(parallel.serialRun) > 0 ? Number(parallel.serialRun) : null,
        configurationExclusivity: null,
        appliesToAllCards: true,
      });
    }
  }

  const uniqueness = new Map();
  for (const card of cards) {
    const key = `${normalizedKey(card.setName)}\u001f${normalizedKey(card.cardNumber)}\u001f${normalizedKey(card.variation || "")}`;
    const prior = uniqueness.get(key);
    if (prior) {
      errors.push({
        code: "source_duplicate_disambiguation_unresolved",
        severity: "error",
        message: `${card.setName} #${card.cardNumber} still collides after source-grounded variation assignment.`,
      });
    } else {
      uniqueness.set(key, card);
    }
  }

  const warnings = [
    {
      code: "coordinate_pdf_direct_recovery",
      severity: "warning",
      message: "Built deterministic checklist rows directly from the official PDF coordinate buckets so source-authentic duplicate card numbers are preserved before generic parser deduplication.",
    },
    ...resolvedDuplicateGroups.map((row) => ({
      code: "source_duplicate_card_number_preserved",
      severity: "warning",
      message: `${row.setName} #${row.cardNumber} is reused by the source checklist; preserved ${row.subjects.length} subjects with checklist-subject variations.`,
    })),
  ];
  return { parsed: { cards, parallels, warnings, errors }, resolvedDuplicateGroups, combinedMultiSubjectGroups };
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
if (Number(summary.targetCount) !== 122 || Number(summary.readyCount) !== 90 || Number(summary.validationFailedCount) !== 32) {
  throw new Error("Unexpected immutable 122-catalog harvest summary.");
}
const candidates = (summary.validationFailed || []).filter((row) => EXACT_KEYS.has(row.exactSetKey));
if (candidates.length !== EXACT_KEYS.size) throw new Error(`Expected ${EXACT_KEYS.size} hard PDF failures, found ${candidates.length}.`);
const sourceFiles = readdirSync(sourcesDir);
const results = [];

for (const row of candidates) {
  const slug = safeSlug(row.exactSetKey);
  const sourceName = sourceFiles.find((name) => name.startsWith(`${slug}__`) && name.toLowerCase().endsWith(".pdf"));
  if (!sourceName) {
    results.push({ exactSetKey: row.exactSetKey, status: "failed", error: "Immutable PDF source missing." });
    continue;
  }
  const bytes = readFileSync(resolve(sourcesDir, sourceName));
  const filename = sourceName.slice(sourceName.indexOf("__") + 2);
  const sourceUrl = row.selectedUrl || row.finalUrl || row.sourceUrl;
  const source = { bytes, filename, mimeType: "application/pdf", selectedUrl: sourceUrl, finalUrl: row.finalUrl || sourceUrl };
  const entry = buildEntry(row, sourceUrl);
  console.log(`=== SOURCE-DUPLICATE PDF RECOVERY: ${row.exactSetKey} ===`);
  try {
    const coordinate = normalizeGoGtsPdfCoordinates(bytes);
    if (!coordinate.detected || coordinate.rows.length < MINIMUM_CARD_ROWS) {
      throw new Error(`Coordinate extractor produced only ${coordinate.rows.length} deterministic rows.`);
    }
    const repaired = buildParsedFromCoordinate(coordinate);
    const plan = buildPlan(entry, repaired.parsed, source, new Date().toISOString());
    const complexity = assertPlanComplexity(plan);
    const validationErrors = plan.validation.issues.filter((issue) => issue.severity === "error");
    const planPath = resolve(PLAN_DIR, `${slug}.json`);
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    results.push({
      exactSetKey: row.exactSetKey,
      status: plan.validation.status === "passed" ? "validated" : "validation_failed",
      coordinateRows: coordinate.rows.length,
      coordinateBuckets: coordinate.buckets.length,
      resolvedDuplicateGroups: repaired.resolvedDuplicateGroups,
      combinedMultiSubjectGroups: repaired.combinedMultiSubjectGroups,
      counts: plan.validation.counts,
      serializedBytes: complexity.serializedBytes,
      validationErrors: validationErrors.slice(0, 30),
      planFile: planPath.split("/").pop(),
    });
  } catch (error) {
    results.push({ exactSetKey: row.exactSetKey, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

const validated = results.filter((row) => row.status === "validated");
const receipt = {
  schema: "tcos.checklist.sourceDuplicatePdfRecovery.v2",
  targetCount: EXACT_KEYS.size,
  validatedCount: validated.length,
  unresolvedCount: results.length - validated.length,
  validatedCards: validated.reduce((sum, row) => sum + Number(row.counts?.cards || 0), 0),
  validatedIdentities: validated.reduce((sum, row) => sum + Number(row.counts?.identities || 0), 0),
  results,
};
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ targetCount: receipt.targetCount, validatedCount: receipt.validatedCount, unresolvedCount: receipt.unresolvedCount, validatedCards: receipt.validatedCards, validatedIdentities: receipt.validatedIdentities }, null, 2));
if (validated.length !== EXACT_KEYS.size) process.exitCode = 2;
