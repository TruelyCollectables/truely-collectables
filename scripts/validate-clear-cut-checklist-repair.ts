import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const SOURCE_URL = "https://upperdeck.com/checklist/2025-26-clear-cut-checklist/";
const EXPECTED_ADAPTER = "upper-deck-clear-cut-official-html-checklist";

function requireIdentity(
  cards: Array<{ cardNumber: string; players: string[] }>,
  cardNumber: string,
  player: string,
) {
  const found = cards.some(
    (card) =>
      card.cardNumber.toUpperCase() === cardNumber.toUpperCase() &&
      card.players.some((value) => value.toLowerCase() === player.toLowerCase()),
  );
  if (!found) {
    throw new Error(`Clear Cut preflight is missing ${cardNumber} ${player}.`);
  }
}

async function main() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "TruelyCollectables-Checklist-Reconcile/1.0",
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`Clear Cut preflight fetch failed with HTTP ${response.status}.`);
  }
  const content = await response.text();
  if (content.length < 10_000) {
    throw new Error("Clear Cut preflight source HTML is unexpectedly small.");
  }

  const artifact: ChecklistSourceArtifact = {
    sourceUrl: SOURCE_URL,
    originalFilename: "2025-26-clear-cut-checklist.html",
    mimeType: "text/html",
    content,
    retrievedAt: new Date().toISOString(),
    authority: "official_manufacturer",
    redistributionAllowed: false,
  };
  const result = await importChecklistArtifact({ artifact, validateOnly: true });
  if (result.adapter.id !== EXPECTED_ADAPTER) {
    throw new Error(
      `Clear Cut preflight selected ${result.adapter.id}; expected ${EXPECTED_ADAPTER}.`,
    );
  }

  const conflicts = result.plan.validation.issues.filter(
    (issue) => issue.code === "card_number_subject_conflict",
  );
  if (conflicts.length) {
    throw new Error(
      `Clear Cut preflight still has ${conflicts.length} card-number subject conflicts: ${conflicts
        .slice(0, 5)
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
    throw new Error(`Clear Cut preflight did not pass validation: ${errors}`);
  }

  requireIdentity(result.plan.cards, "CC-RO", "Marco Rossi");
  requireIdentity(result.plan.cards, "CC-RO", "Jason Robertson");
  requireIdentity(result.plan.cards, "CC-ZB", "Zeev Buium");
  requireIdentity(result.plan.cards, "CC-ZB", "Zach Benson");
  requireIdentity(result.plan.cards, "CS-ZB", "Zach Benson");
  requireIdentity(result.plan.cards, "CS-ZB", "Zachary Bolduc");

  console.log(
    JSON.stringify(
      {
        ok: true,
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
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
