import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan } from "../mainstream-checklist/registry-tools.mjs";
import { parseChecklist } from "../mainstream-checklist/source-tools.mjs";
import { normalizeCoordinateParsedChecklist, normalizeGoGtsPdfCoordinates } from "./gogts-pdf-coordinate-normalizer.mjs";

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
const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
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

function subjectLabel(card) {
  const players = (Array.isArray(card.players) ? card.players : []).map(clean).filter(Boolean);
  if (players.length) return players.join(" / ");
  const teams = (Array.isArray(card.teams) ? card.teams : []).map(clean).filter(Boolean);
  if (teams.length) return teams.join(" / ");
  return clean(card.sourceNotes) || "Source row";
}

function disambiguateSourceDuplicates(parsed) {
  const output = structuredClone(parsed);
  const groups = new Map();
  for (const card of output.cards || []) {
    const baseVariation = normalizedKey(card.variation || "");
    const key = `${normalizedKey(card.setName)}\u001f${normalizedKey(card.cardNumber)}\u001f${baseVariation}`;
    const list = groups.get(key) || [];
    list.push(card);
    groups.set(key, list);
  }

  const resolved = [];
  const unresolved = [];
  for (const [key, cards] of groups) {
    if (cards.length < 2) continue;
    const subjects = new Map();
    for (const card of cards) {
      const label = subjectLabel(card);
      const normalizedSubject = normalizedKey(label);
      const list = subjects.get(normalizedSubject) || [];
      list.push({ card, label });
      subjects.set(normalizedSubject, list);
    }
    if (subjects.size < 2) continue;
    if ([...subjects.keys()].some((value) => !value)) {
      unresolved.push({ key, reason: "missing_source_subject" });
      continue;
    }
    for (const entries of subjects.values()) {
      const label = entries[0].label;
      for (const { card } of entries) {
        const sourceDisambiguator = `Checklist subject: ${label}`;
        card.variation = clean(card.variation) ? `${clean(card.variation)} | ${sourceDisambiguator}` : sourceDisambiguator;
        card.sourceNotes = [clean(card.sourceNotes), "Source-authentic duplicate card number preserved with subject disambiguator."].filter(Boolean).join("; ");
      }
    }
    resolved.push({
      key,
      setName: clean(cards[0]?.setName),
      cardNumber: clean(cards[0]?.cardNumber),
      subjects: [...subjects.values()].map((entries) => entries[0].label),
    });
  }

  const postKeys = new Map();
  for (const card of output.cards || []) {
    const key = `${normalizedKey(card.setName)}\u001f${normalizedKey(card.cardNumber)}\u001f${normalizedKey(card.variation || "")}`;
    const prior = postKeys.get(key);
    if (prior && normalizedKey(subjectLabel(prior)) !== normalizedKey(subjectLabel(card))) {
      unresolved.push({ key, reason: "post_disambiguation_collision", subjects: [subjectLabel(prior), subjectLabel(card)] });
    } else if (!prior) {
      postKeys.set(key, card);
    }
  }

  const conflictErrors = (output.errors || []).filter((issue) => issue?.code === "reference_card_number_subject_conflict");
  if (conflictErrors.length && !resolved.length) {
    unresolved.push({ reason: "parser_reported_conflict_without_resolved_group", messages: conflictErrors.map((issue) => issue.message) });
  }
  output.errors = (output.errors || []).filter((issue) => issue?.code !== "reference_card_number_subject_conflict");
  output.warnings = [
    ...(output.warnings || []),
    ...resolved.map((row) => ({
      code: "source_duplicate_card_number_preserved",
      severity: "warning",
      message: `${row.setName} #${row.cardNumber} is reused by the source checklist; preserved ${row.subjects.length} subjects with source-subject variations.`,
    })),
  ];
  if (unresolved.length) {
    output.errors.push({
      code: "source_duplicate_disambiguation_unresolved",
      severity: "error",
      message: `${unresolved.length} source duplicate card-number groups could not be safely disambiguated.`,
    });
  }
  return { parsed: output, resolved, unresolved, originalConflictErrorCount: conflictErrors.length };
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
    const initialParsed = normalizeCoordinateParsedChecklist(parseChecklist(entry, coordinate.text));
    const repaired = disambiguateSourceDuplicates(initialParsed);
    const plan = buildPlan(entry, repaired.parsed, source, new Date().toISOString());
    const complexity = assertPlanComplexity(plan);
    const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
    const planPath = resolve(PLAN_DIR, `${slug}.json`);
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    results.push({
      exactSetKey: row.exactSetKey,
      status: plan.validation.status === "passed" ? "validated" : "validation_failed",
      coordinateRows: coordinate.rows.length,
      coordinateBuckets: coordinate.buckets.length,
      originalConflictErrorCount: repaired.originalConflictErrorCount,
      resolvedDuplicateGroups: repaired.resolved,
      unresolvedDuplicateGroups: repaired.unresolved,
      counts: plan.validation.counts,
      serializedBytes: complexity.serializedBytes,
      validationErrors: errors.slice(0, 30),
      planFile: planPath.split("/").pop(),
    });
  } catch (error) {
    results.push({ exactSetKey: row.exactSetKey, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

const validated = results.filter((row) => row.status === "validated");
const receipt = {
  schema: "tcos.checklist.sourceDuplicatePdfRecovery.v1",
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
