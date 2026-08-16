import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan } from "../mainstream-checklist/registry-tools.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.LAYOUT_PDF_RECEIPT || `${ROOT}/layout-pdf-recovery-receipt.json`);
const PLAN_DIR = resolve(process.env.LAYOUT_PDF_PLAN_DIR || `${ROOT}/layout-pdf-plans`);
const MINIMUM_CARD_ROWS = Math.max(20, Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 20));
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/layout-pdf-tmp");

const TARGETS = new Map([
  ["hockey|2021-22|topps|sticker-collection-nhl", { mode: "topps-stickers", sourceHint: "2021-Topps-NHL-Sticker-Collection-Checklist.pdf" }],
  ["hockey|2022-23|upper-deck|o-pee-chee-nhl", { mode: "gogts-table", sourceHint: "2022-23-O-Pee-Chee-NHL-Hockey-Cards-Checklist.pdf" }],
  ["hockey|2022|leaf|art-of", { mode: "leaf-art", sourceHint: "2022-Leaf-Art-of-Hockey-Cards-Checklist.pdf" }],
]);

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath = resolve(ROOT, "output/summary.json");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(sourcesDir)) throw new Error("Verified harvest bundle is incomplete.");
mkdirSync(PLAN_DIR, { recursive: true });
mkdirSync(TEMP_ROOT, { recursive: true });

const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const normalized = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const acronyms = new Map([["nhl","NHL"],["pwhl","PWHL"],["wnba","WNBA"]]);
const displayToken = (value) => String(value || "").split("-").filter(Boolean).map((part) => acronyms.get(part.toLowerCase()) || `${part.slice(0,1).toUpperCase()}${part.slice(1)}`).join(" ");
const plausibleCard = (value) => /^[A-Za-z0-9][A-Za-z0-9./#()\-]{0,39}$/.test(normalized(value));

function buildEntry(row, sourceUrl) {
  const [sportKey, seasonKey, manufacturerKey, productKey] = row.exactSetKey.split("|");
  const manufacturer = displayToken(manufacturerKey);
  const product = displayToken(productKey);
  return {
    id: `layout-pdf-${safeSlug(row.exactSetKey)}`,
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

function pdfText(bytes, filename) {
  const pdfPath = resolve(TEMP_ROOT, `${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
  const txtPath = `${pdfPath}.txt`;
  writeFileSync(pdfPath, bytes);
  try {
    execFileSync("pdftotext", ["-layout", "-nopgbrk", pdfPath, txtPath], { timeout: 180000, stdio: "pipe" });
    return readFileSync(txtPath, "utf8");
  } finally {
    rmSync(pdfPath, { force: true });
    rmSync(txtPath, { force: true });
  }
}

function cardRow(setName, cardNumber, subject, team = "", sourceNotes = "") {
  const setText = normalized(setName).slice(0, 180);
  const subjectText = normalized(subject).slice(0, 180);
  const teamText = normalized(team).slice(0, 120);
  return {
    setName: setText || "Base Set",
    cardNumber: normalized(cardNumber).replace(/^#\s*/, "").slice(0, 40),
    players: subjectText ? [subjectText] : [],
    teams: teamText ? [teamText] : [],
    rookieDesignation: /(?:^|\s)(?:RC|Rookie)(?:\s|$)/i.test(subjectText),
    firstBowmanDesignation: false,
    autographStatus: /autograph|auto|signature|signed/i.test(setText) ? "autograph" : "non-auto",
    memorabiliaStatus: /relic|memorabilia|patch|swatch|jersey/i.test(setText) ? "memorabilia" : "non-memorabilia",
    variation: null,
    sourceNotes,
  };
}

function parseTopps(text) {
  const cards = [];
  let major = "Base";
  let active = "Base - Player Stickers I";
  const headings = new Set(["BASE", "INSERT", "PAGES"]);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, "");
    const stripped = line.trim();
    if (!stripped || /2021 Topps NHL Sticker Collection Checklist/i.test(stripped)) continue;
    const match = line.match(/^\s*([A-Za-z0-9-]+)\s+(.+?)\s{2,}(.+?)\s*$/);
    if (match && plausibleCard(match[1])) {
      cards.push(cardRow(active, match[1], match[2], match[3], "pdftotext layout row"));
      continue;
    }
    if (stripped.length < 100 && (stripped.toUpperCase() === stripped || /^PLAYER STICKERS/i.test(stripped))) {
      if (headings.has(stripped)) major = displayToken(stripped.toLowerCase());
      else active = `${major} - ${displayToken(stripped.toLowerCase())}`;
    }
  }
  return { cards, parallels: [], warnings: [{ code: "layout_pdf_parser", severity: "warning", message: "Recovered deterministic sticker rows from the official layout text." }], errors: [] };
}

function parseGoGtsTable(text) {
  const cards = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s{2,}/).map(normalized).filter(Boolean);
    if (parts.length < 4 || /^Set Name$/i.test(parts[0]) || !plausibleCard(parts[1])) continue;
    const [setName, cardNumber, subject, team] = parts;
    const exact = `${setName.toLowerCase()}::${cardNumber.toLowerCase()}::${subject.toLowerCase()}`;
    if (seen.has(exact)) continue;
    seen.add(exact);
    cards.push(cardRow(setName, cardNumber, subject, team, "pdftotext layout table row"));
  }
  return { cards, parallels: [], warnings: [{ code: "layout_pdf_parser", severity: "warning", message: "Recovered deterministic GoGTS table rows from the official layout text." }], errors: [] };
}

function parseLeafArt(text) {
  const cards = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, "");
    if (!line.trim() || /2022 Leaf Art of Hockey/i.test(line)) continue;
    const match = line.match(/^\s*(.*?)\s{2,}(.+?)\s{2,}([A-Z0-9][A-Z0-9-]{2,12})\s*$/);
    if (!match) continue;
    const setName = normalized(match[1]);
    const subject = normalized(match[2]);
    const cardNumber = normalized(match[3]);
    if (!setName || setName.startsWith("*") || /colors include/i.test(setName) || !plausibleCard(cardNumber)) continue;
    const exact = `${setName.toLowerCase()}::${cardNumber.toLowerCase()}::${subject.toLowerCase()}`;
    if (seen.has(exact)) continue;
    seen.add(exact);
    cards.push(cardRow(setName, cardNumber, subject, "", "pdftotext layout row"));
  }
  return { cards, parallels: [], warnings: [{ code: "layout_pdf_parser", severity: "warning", message: "Recovered deterministic Leaf checklist rows from the official layout text." }], errors: [] };
}

function findConflicts(cards) {
  const byNumber = new Map();
  const conflicts = [];
  for (const card of cards) {
    const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const subject = card.players.join("/").toLowerCase();
    const prior = byNumber.get(key);
    if (prior && prior !== subject) conflicts.push({ key, prior, subject });
    else byNumber.set(key, subject);
  }
  return conflicts;
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const candidates = (summary.validationFailed || []).filter((row) => TARGETS.has(row.exactSetKey));
if (candidates.length !== TARGETS.size) throw new Error(`Expected ${TARGETS.size} layout-PDF failures, found ${candidates.length}.`);
const sourceFiles = readdirSync(sourcesDir);
const results = [];
for (const row of candidates) {
  const target = TARGETS.get(row.exactSetKey);
  const slug = safeSlug(row.exactSetKey);
  const sourceName = sourceFiles.find((name) => name.startsWith(`${slug}__`) && name.endsWith(target.sourceHint));
  if (!sourceName) {
    results.push({ exactSetKey: row.exactSetKey, status: "failed", error: `Immutable source ${target.sourceHint} missing.` });
    continue;
  }
  const bytes = readFileSync(resolve(sourcesDir, sourceName));
  const sourceUrl = row.selectedUrl || row.finalUrl || row.sourceUrl;
  const source = { bytes, filename: sourceName.slice(sourceName.indexOf("__") + 2), mimeType: "application/pdf", selectedUrl: sourceUrl, finalUrl: row.finalUrl || sourceUrl };
  const entry = buildEntry(row, sourceUrl);
  try {
    const text = pdfText(bytes, source.filename);
    const parsed = target.mode === "topps-stickers" ? parseTopps(text) : target.mode === "leaf-art" ? parseLeafArt(text) : parseGoGtsTable(text);
    const conflicts = findConflicts(parsed.cards);
    if (parsed.cards.length < MINIMUM_CARD_ROWS) parsed.errors.push({ code: "reference_checklist_insufficient_rows", severity: "error", message: `Only ${parsed.cards.length} deterministic card rows were parsed.` });
    if (conflicts.length) parsed.errors.push({ code: "reference_card_number_subject_conflict", severity: "error", message: `${conflicts.length} same-set/card subject conflicts remained after layout recovery.` });
    const plan = buildPlan(entry, parsed, source, new Date().toISOString());
    const complexity = assertPlanComplexity(plan);
    const outPath = resolve(PLAN_DIR, `${slug}.json`);
    writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`);
    results.push({
      exactSetKey: row.exactSetKey,
      status: plan.validation.status === "passed" ? "validated" : "validation_failed",
      layoutRows: parsed.cards.length,
      conflicts: conflicts.slice(0, 20),
      counts: plan.validation.counts,
      serializedBytes: complexity.serializedBytes,
      validationErrors: plan.validation.issues.filter((issue) => issue.severity === "error").slice(0, 30),
      planFile: outPath.split("/").pop(),
    });
  } catch (error) {
    results.push({ exactSetKey: row.exactSetKey, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}
const validated = results.filter((row) => row.status === "validated");
const receipt = { schema: "tcos.checklist.layoutPdfRecovery.v1", targetCount: TARGETS.size, validatedCount: validated.length, unresolvedCount: results.length - validated.length, results };
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (validated.length !== TARGETS.size) process.exitCode = 2;
