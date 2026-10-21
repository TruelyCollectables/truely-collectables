import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveChecklistRegistry } from "../../src/lib/instacomp-learning-server";

const cards = [
  {
    position: 1,
    label: "Sonia Citron #122 Base",
    expectedIdentityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
    ai: {
      player: "Sonia Citron",
      year: "2025",
      brand: "Panini",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "122",
      parallel: "Base",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
      notes: "",
    },
  },
  {
    position: 2,
    label: "Dominique Malonga #116 Prizms Ice",
    expectedIdentityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    ai: {
      player: "Dominique Malonga",
      year: "2025",
      brand: "Panini",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "116",
      parallel: "Prizms Ice",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
      notes: "Visible cracked-ice surface geometry; no serial stamp visible.",
    },
  },
  {
    position: 3,
    label: "Sonia Citron #13 Groovy Base",
    expectedIdentityId: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
    ai: {
      player: "Sonia Citron",
      year: "2025",
      brand: "Panini",
      setName: "Groovy",
      cardNumber: "13",
      parallel: "Base",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
      notes: "Groovy insert design visible; no serial stamp visible.",
    },
  },
  {
    position: 4,
    label: "Paige Bueckers #5 Prizms Ice",
    expectedIdentityId: "575556fe-fdd4-4083-baee-c5071ed3161f",
    ai: {
      player: "Paige Bueckers",
      year: "2025",
      brand: "Panini",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "5",
      parallel: "Prizms Ice",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
      notes: "Visible cracked-ice surface geometry; no serial stamp visible.",
    },
  },
  {
    position: 5,
    label: "Rickea Jackson #118 Base",
    expectedIdentityId: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
    ai: {
      player: "Rickea Jackson",
      year: "2025",
      brand: "Panini",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "118",
      parallel: "Base",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
      notes: "Printed 2025 Panini product/copyright evidence; no serial stamp visible.",
    },
  },
] as const;

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const output = outputArg >= 0
    ? process.argv[outputArg + 1]
    : "evidence/instacomp-five-card-registry-resolution-20260807/receipt.json";
  await mkdir(dirname(output), { recursive: true });

  const receipt: Record<string, any> = {
    schema: "tcos.instacomp.fiveCardRegistryResolution.v1",
    generatedAt: new Date().toISOString(),
    gateRequired: "5/5 exact Production Registry identity IDs",
    testedCards: 0,
    passedCards: 0,
    status: "running",
    results: [],
  };

  for (const card of cards) {
    const startedAt = Date.now();
    const resolution = await resolveChecklistRegistry(card.ai, {
      evidenceTrusted: true,
    });
    const actualIdentityId = resolution.match?.identityId || null;
    const passed =
      resolution.status === "internal_exact_match" &&
      actualIdentityId === card.expectedIdentityId;
    receipt.results.push({
      position: card.position,
      label: card.label,
      expectedIdentityId: card.expectedIdentityId,
      actualIdentityId,
      passed,
      status: resolution.status,
      candidateCount: resolution.candidateCount,
      reasons: resolution.reasons,
      coveredReleaseIds: resolution.coveredReleaseIds,
      coveredVersionIds: resolution.coveredVersionIds,
      coveredSetIds: resolution.coveredSetIds,
      match: resolution.match,
      durationMs: Date.now() - startedAt,
    });
    receipt.testedCards = receipt.results.length;
    receipt.passedCards = receipt.results.filter((row: any) => row.passed).length;
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(
      `[${card.position}/5] ${passed ? "PASS" : "FAIL"} ${card.label} expected=${card.expectedIdentityId} actual=${actualIdentityId || "none"} status=${resolution.status}`,
    );
  }

  receipt.status = receipt.passedCards === 5 ? "passed" : "failed";
  receipt.finishedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    testedCards: receipt.testedCards,
    passedCards: receipt.passedCards,
  }, null, 2));
  if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
