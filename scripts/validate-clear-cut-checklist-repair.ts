import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const CLEAR_CUT_URL = "https://upperdeck.com/checklist/2025-26-clear-cut-checklist/";
const SERIES_2_URL = "https://upperdeck.com/checklist/2024-25-upper-deck-series-2-checklist/";
const CLEAR_CUT_ADAPTER = "upper-deck-clear-cut-official-html-checklist";
const SERIES_2_ADAPTER = "upper-deck-2024-25-series-2-errata-html-checklist";

type ParsedResult = Awaited<ReturnType<typeof importChecklistArtifact>>;

function requireIdentity(
  result: ParsedResult,
  cardNumber: string,
  player: string,
  label: string,
) {
  const found = result.plan.cards.some(
    (card) =>
      card.cardNumber.toUpperCase() === cardNumber.toUpperCase() &&
      card.players.some((value) => value.toLowerCase() === player.toLowerCase()),
  );
  if (!found) {
    throw new Error(`${label} preflight is missing ${cardNumber} ${player}.`);
  }
}

function assertNoSubjectConflicts(result: ParsedResult, label: string) {
  const conflicts = result.plan.validation.issues.filter(
    (issue) => issue.code === "card_number_subject_conflict",
  );
  if (conflicts.length) {
    throw new Error(
      `${label} preflight still has ${conflicts.length} card-number subject conflicts: ${conflicts
        .slice(0, 8)
        .map((issue) => issue.message)
        .join(" | ")}`,
    );
  }
  if (result.plan.validation.status !== "passed") {
    const errors = result.plan.validation.issues
      .filter((issue) => issue.severity === "error")
      .slice(0, 10)
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join(" | ");
    throw new Error(`${label} preflight did not pass validation: ${errors}`);
  }
}

async function fetchAndParse(
  sourceUrl: string,
  filename: string,
  expectedAdapter: string,
  label: string,
) {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "TruelyCollectables-Checklist-Reconcile/1.0",
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`${label} preflight fetch failed with HTTP ${response.status}.`);
  }
  const content = await response.text();
  if (content.length < 10_000) {
    throw new Error(`${label} preflight source HTML is unexpectedly small.`);
  }

  const artifact: ChecklistSourceArtifact = {
    sourceUrl,
    originalFilename: filename,
    mimeType: "text/html",
    content,
    retrievedAt: new Date().toISOString(),
    authority: "official_manufacturer",
    redistributionAllowed: false,
  };
  const result = await importChecklistArtifact({ artifact, validateOnly: true });
  if (result.adapter.id !== expectedAdapter) {
    throw new Error(
      `${label} preflight selected ${result.adapter.id}; expected ${expectedAdapter}.`,
    );
  }
  assertNoSubjectConflicts(result, label);
  return result;
}

async function validateClearCut() {
  const result = await fetchAndParse(
    CLEAR_CUT_URL,
    "2025-26-clear-cut-checklist.html",
    CLEAR_CUT_ADAPTER,
    "Clear Cut",
  );

  requireIdentity(result, "CC-RO", "Marco Rossi", "Clear Cut");
  requireIdentity(result, "CC-RO", "Jason Robertson", "Clear Cut");
  requireIdentity(result, "CC-ZB", "Zeev Buium", "Clear Cut");
  requireIdentity(result, "CC-ZB", "Zach Benson", "Clear Cut");
  requireIdentity(result, "CS-ZB", "Zach Benson", "Clear Cut");
  requireIdentity(result, "CS-ZB", "Zachary Bolduc", "Clear Cut");

  return {
    label: "Clear Cut",
    adapter: result.adapter,
    counts: result.plan.validation.counts,
    checkedIdentities: [
      "CC-RO Marco Rossi",
      "CC-RO Jason Robertson",
      "CC-ZB Zeev Buium",
      "CC-ZB Zach Benson",
      "CS-ZB Zach Benson",
      "CS-ZB Zachary Bolduc",
    ],
  };
}

async function validateSeries2() {
  const result = await fetchAndParse(
    SERIES_2_URL,
    "2024-25-upper-deck-series-2-checklist.html",
    SERIES_2_ADAPTER,
    "2024-25 Series 2",
  );

  requireIdentity(result, "C145", "Roman Josi", "2024-25 Series 2");
  requireIdentity(result, "C190", "Elvis Merzlikins", "2024-25 Series 2");

  const badRoman = result.plan.cards.some(
    (card) =>
      card.cardNumber.toUpperCase() === "C190" &&
      card.players.some((value) => value.toLowerCase() === "roman josi"),
  );
  if (badRoman) {
    throw new Error("2024-25 Series 2 preflight still maps Roman Josi to C190.");
  }

  const roman = result.plan.cards.find(
    (card) =>
      card.cardNumber.toUpperCase() === "C145" &&
      card.players.some((value) => value.toLowerCase() === "roman josi"),
  );
  if (!roman?.sourceNotes?.includes("upper_deck_official_card_number_typo")) {
    throw new Error("2024-25 Series 2 preflight lost the Roman Josi source-erratum audit note.");
  }

  return {
    label: "2024-25 Series 2",
    adapter: result.adapter,
    counts: result.plan.validation.counts,
    checkedIdentities: ["C145 Roman Josi", "C190 Elvis Merzlikins"],
  };
}

async function main() {
  const checks = [];
  checks.push(await validateClearCut());
  checks.push(await validateSeries2());

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
