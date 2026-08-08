import fs from "node:fs";
import path from "node:path";
import { resolveInstaCompChecklistFirstFromRegistry } from "../src/lib/instacomp-checklist-first-server";

type Card = {
  ordinal: number;
  year: string;
  manufacturer: string;
  brand: string;
  set_name: string;
  player: string;
  card_number: string;
  parallel: string | null;
  operator_note?: string;
};

type Json = Record<string, any>;

const fixturePath = path.resolve("scripts/fixtures/instacomp-supervised-batch-004-cards-76-100.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { cards: Card[] };
const macBase = String(process.env.INSTACOMP_AI_LOCAL_URL || "").replace(/\/+$/, "");
const macKey = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
if (!macBase || !macKey) throw new Error("Production InstaComp Mac coordinates are missing.");

const n = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const p = (value: unknown) => {
  const x = n(value);
  if (!x || x === "base") return "";
  return x.replace(/\bprizms?\b/g, "").replace(/\s+/g, " ").trim();
};
const sameText = (a: unknown, b: unknown) => n(a) === n(b);
const productFamily = (value: unknown) => {
  const x = n(value);
  if (x.includes("donruss")) return "donruss";
  if (x.includes("select")) return "select";
  if (x.includes("prizm")) return "prizm";
  return x;
};

async function getJson(url: string) {
  const response = await fetch(url, {
    headers: { "X-InstaComp-AI-Key": macKey, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

function exactMemoryMatch(card: Card, example: Json) {
  const id = example?.confirmed_identity || {};
  return (
    sameText(id.year, card.year) &&
    sameText(id.player, card.player) &&
    sameText(id.card_number, card.card_number) &&
    sameText(id.set_name, card.set_name) &&
    productFamily(id.brand || id.manufacturer) === productFamily(card.brand) &&
    p(id.parallel) === p(card.parallel) &&
    example?.trusted === true
  );
}

function registryCandidateMatch(card: Card, candidate: Json) {
  return (
    sameText(candidate.year, card.year) &&
    sameText(candidate.player, card.player) &&
    sameText(candidate.cardNumber, card.card_number) &&
    sameText(candidate.setName, card.set_name) &&
    productFamily(candidate.brand || candidate.product || candidate.manufacturer) === productFamily(card.brand) &&
    p(candidate.parallel) === p(card.parallel)
  );
}

const training = await getJson(`${macBase}/v1/training/examples?trusted_only=true&limit=2000`);
const examples: Json[] = Array.isArray(training?.examples) ? training.examples : [];
const rows: Json[] = [];

for (const card of fixture.cards) {
  const memoryMatches = examples.filter((example) => exactMemoryMatch(card, example));
  const decision = await resolveInstaCompChecklistFirstFromRegistry({
    year: card.year,
    manufacturer: card.manufacturer,
    brand: card.brand,
    setName: card.set_name,
    cardNumber: card.card_number,
    player: card.player,
    serialNumber: null,
    isAuto: false,
    isRelic: false,
    parallel: card.parallel,
    variation: null,
    ocrText: null,
  });
  const registryMatches = decision.candidates.filter((candidate: Json) => registryCandidateMatch(card, candidate));
  rows.push({
    ordinal: card.ordinal,
    player: card.player,
    cardNumber: card.card_number,
    setName: card.set_name,
    parallel: card.parallel,
    trustedMemoryCount: memoryMatches.length,
    trustedMemoryVerified: memoryMatches.length > 0,
    registryStatus: decision.status,
    registryCandidateCount: decision.candidates.length,
    registryExpectedCandidateCount: registryMatches.length,
    registryExpectedCandidateVerified: registryMatches.length > 0,
    operatorNote: card.operator_note || null,
  });
}

const receipt = {
  schema: "tcos.instacomp-ai.supervised-batch-verification.v1",
  batch: "004",
  checkedAt: new Date().toISOString(),
  total: rows.length,
  trustedMemoryVerified: rows.filter((row) => row.trustedMemoryVerified).length,
  registryExpectedCandidateVerified: rows.filter((row) => row.registryExpectedCandidateVerified).length,
  missingTrustedMemoryOrdinals: rows.filter((row) => !row.trustedMemoryVerified).map((row) => row.ordinal),
  missingRegistryOrdinals: rows.filter((row) => !row.registryExpectedCandidateVerified).map((row) => row.ordinal),
  rows,
};

fs.mkdirSync("audits/instacomp-supervised", { recursive: true });
fs.writeFileSync("audits/instacomp-supervised/batch-004-live-verification.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
