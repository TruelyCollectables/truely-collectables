import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPlanComplexity, buildPlan } from "../mainstream-checklist/registry-tools.mjs";

const EXACT_SET_KEY = "hockey|2022-23|upper-deck|the-cup-nhl";
const SOURCE_FILENAME = "2022-23-Upper-Deck-The-Cup-NHL-Hockey-Cards-Checklist.pdf";
const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.THE_CUP_LAYOUT_RECEIPT || `${ROOT}/the-cup-layout-recovery-receipt.json`);
const PLAN_DIR = resolve(process.env.THE_CUP_LAYOUT_PLAN_DIR || `${ROOT}/the-cup-layout-plans`);
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/the-cup-layout-tmp");
if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root missing: ${ROOT}`);
mkdirSync(PLAN_DIR, { recursive: true });
mkdirSync(TEMP_ROOT, { recursive: true });

const summary = JSON.parse(readFileSync(resolve(ROOT, "output/summary.json"), "utf8"));
const sourceRow = (summary.validationFailed || []).find((row) => row.exactSetKey === EXACT_SET_KEY);
if (!sourceRow) throw new Error(`Immutable harvest does not contain ${EXACT_SET_KEY} as a validation failure.`);
const sourcesDir = resolve(ROOT, "output/sources");
const safeSlug = EXACT_SET_KEY.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
const sourceName = readdirSync(sourcesDir).find((name) => name.startsWith(`${safeSlug}__`) && name.endsWith(SOURCE_FILENAME));
if (!sourceName) throw new Error(`Immutable source ${SOURCE_FILENAME} not found.`);
const bytes = readFileSync(resolve(sourcesDir, sourceName));

const pdfPath = resolve(TEMP_ROOT, `${Date.now()}-${SOURCE_FILENAME}`);
const txtPath = `${pdfPath}.txt`;
writeFileSync(pdfPath, bytes);
let text = "";
try {
  execFileSync("pdftotext", ["-layout", "-nopgbrk", pdfPath, txtPath], { timeout: 180000, stdio: "pipe" });
  text = readFileSync(txtPath, "utf8");
} finally {
  rmSync(pdfPath, { force: true });
  rmSync(txtPath, { force: true });
}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const plausibleNumber = (value) => /^[A-Za-z0-9#][A-Za-z0-9#./()'\-]{0,39}$/.test(clean(value));
const cards = [];
const exactSeen = new Set();
for (const raw of text.split(/\r?\n/)) {
  const parts = raw.trim().split(/\s{2,}/).map(clean).filter(Boolean);
  if (parts.length < 4) continue;
  const [cardNumber, setName, subject, team, serial = "", odds = ""] = parts;
  if (!plausibleNumber(cardNumber) || /^(?:card|number)$/i.test(cardNumber) || !setName || !subject) continue;
  const exact = `${setName.toLowerCase()}\u001f${cardNumber.toLowerCase()}\u001f${subject.toLowerCase()}\u001f${team.toLowerCase()}`;
  if (exactSeen.has(exact)) continue;
  exactSeen.add(exact);
  cards.push({
    setName: setName.slice(0, 180),
    cardNumber: cardNumber.replace(/^#\s*/, "").slice(0, 40),
    players: [subject.slice(0, 180)],
    teams: team ? [team.slice(0, 120)] : [],
    rookieDesignation: /\brookie\b/i.test(setName),
    firstBowmanDesignation: false,
    autographStatus: /autograph|auto|signature|signed/i.test(setName) ? "autograph" : "non-auto",
    memorabiliaStatus: /relic|memorabilia|patch|swatch|jersey|materials?/i.test(setName) ? "memorabilia" : "non-memorabilia",
    variation: null,
    sourceNotes: [serial ? `Serial ${serial}` : "", odds ? `Odds ${odds}` : "", "pdftotext layout table row"].filter(Boolean).join("; "),
  });
}

const conflicts = [];
const byNumber = new Map();
for (const card of cards) {
  const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
  const subject = card.players.join("/").toLowerCase();
  const prior = byNumber.get(key);
  if (prior && prior !== subject) conflicts.push({ key, prior, subject });
  else byNumber.set(key, subject);
}

const parsed = {
  cards,
  parallels: [],
  warnings: [{ code: "layout_pdf_parser", severity: "warning", message: "Recovered deterministic checklist rows from the official GoGTS PDF layout while preserving serial/odds text in source notes." }],
  errors: [],
};
if (cards.length < 1000) parsed.errors.push({ code: "reference_checklist_insufficient_rows", severity: "error", message: `Only ${cards.length} deterministic rows were recovered.` });
if (conflicts.length) parsed.errors.push({ code: "reference_card_number_subject_conflict", severity: "error", message: `${conflicts.length} same-set/card subject conflicts remain.` });

const sourceUrl = sourceRow.selectedUrl || sourceRow.finalUrl || sourceRow.sourceUrl;
const source = { bytes, filename: SOURCE_FILENAME, mimeType: "application/pdf", selectedUrl: sourceUrl, finalUrl: sourceRow.finalUrl || sourceUrl };
const entry = {
  id: "layout-pdf-2022-23-upper-deck-the-cup-nhl",
  sourceName: new URL(sourceUrl).hostname,
  sourceUrl,
  authority: "approved_reference_dataset",
  redistributionAllowed: false,
  minimumCardRows: 1000,
  release: {
    exactSetKey: EXACT_SET_KEY,
    canonicalName: "2022-23 Upper Deck The Cup Hockey",
    manufacturer: "Upper Deck",
    brand: null,
    product: "The Cup NHL",
    releaseYear: 2022,
    season: "2022-23",
    sport: "hockey",
    league: "NHL",
  },
};

const plan = buildPlan(entry, parsed, source, new Date().toISOString());
const complexity = assertPlanComplexity(plan);
const planPath = resolve(PLAN_DIR, `${safeSlug}.json`);
writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
const receipt = {
  schema: "tcos.checklist.theCupLayoutRecovery.v1",
  exactSetKey: EXACT_SET_KEY,
  sourceFilename: SOURCE_FILENAME,
  layoutRows: cards.length,
  uniqueSets: new Set(cards.map((card) => card.setName)).size,
  conflictCount: conflicts.length,
  conflicts: conflicts.slice(0, 30),
  status: plan.validation.status === "passed" ? "validated" : "validation_failed",
  counts: plan.validation.counts,
  serializedBytes: complexity.serializedBytes,
  validationErrors: plan.validation.issues.filter((issue) => issue.severity === "error").slice(0, 30),
  planFile: planPath.split("/").pop(),
};
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (receipt.status !== "validated") process.exitCode = 2;
