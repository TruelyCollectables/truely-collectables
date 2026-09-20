import assert from "node:assert/strict";
import { resolveInstaCompChecklistFirstFromRegistry } from "../src/lib/instacomp-checklist-first-server";
import { titleRegistryDimensionHints } from "../src/lib/instacomp-title-registry-hints";

type Golden = {
  label: string;
  title: string;
  year: string;
  manufacturer: string;
  cardNumber: string;
  player: string;
  team?: string | null;
  sport?: string | null;
  league?: string | null;
  parallel?: string | null;
  serialNumber?: string | null;
  expectedIdentityId: string;
  expectedFingerprint: string;
  expectedProduct: string;
  expectedSetName: string;
};

async function resolveGolden(card: Golden) {
  const hints = [
    ...titleRegistryDimensionHints({
      title: card.title,
      manufacturer: card.manufacturer,
      cardNumber: card.cardNumber,
    }),
    { label: "core_only", brand: null, setName: null },
  ].slice(0, 8);

  const exact = new Map<string, any>();
  const trace: Array<Record<string, unknown>> = [];
  for (const hint of hints) {
    const started = Date.now();
    const decision = await resolveInstaCompChecklistFirstFromRegistry(
      {
        year: card.year,
        manufacturer: card.manufacturer,
        brand: hint.brand || card.manufacturer,
        setName: hint.setName,
        cardNumber: card.cardNumber,
        player: card.player,
        team: card.team || null,
        sport: card.sport || null,
        league: card.league || null,
        serialNumber: card.serialNumber || null,
        isAuto: null,
        isRelic: null,
        parallel: card.parallel || null,
        variation: null,
        ocrText: card.title,
      },
      12_000,
    );
    trace.push({
      label: hint.label,
      brand: hint.brand,
      setName: hint.setName,
      status: decision.status,
      identityId: decision.match?.identityId || null,
      elapsedMs: Date.now() - started,
    });
    if (
      decision.status === "exact_match" &&
      decision.match?.identityId &&
      decision.match?.fingerprintSha256
    ) {
      exact.set(decision.match.identityId, decision.match);
      const confirmations = trace.filter(
        (entry) =>
          entry.status === "exact_match" &&
          entry.identityId === decision.match?.identityId,
      ).length;
      if (exact.size > 1 || confirmations >= 2) break;
    }
  }

  assert.equal(
    exact.size,
    1,
    `${card.label} must resolve to exactly one Registry UUID. Trace: ${JSON.stringify(trace)}`,
  );
  const match = [...exact.values()][0];
  assert.equal(match.identityId, card.expectedIdentityId);
  assert.equal(match.fingerprintSha256, card.expectedFingerprint);
  assert.equal(match.product, card.expectedProduct);
  assert.equal(match.setName, card.expectedSetName);
  console.log(
    `PASS golden identity: ${card.label} -> ${match.identityId} (${trace.length} lookup${trace.length === 1 ? "" : "s"})`,
  );
}

async function main() {
  await resolveGolden({
    label: "2026 Topps Flagship Football ROOKIES #301 Fernando Mendoza Base",
    title: "2026 Topps Flagship Football ROOKIES #301 Fernando Mendoza Base",
    year: "2026",
    manufacturer: "Topps",
    cardNumber: "301",
    player: "Fernando Mendoza",
    team: "Las Vegas Raiders",
    sport: "Football",
    league: "NFL",
    expectedIdentityId: "b8e682db-8f26-51c6-8499-78377d8a87b5",
    expectedFingerprint:
      "e04a20d82d5600959a37056043c4e43283019b7fcdefc2fb969d5ce35f149b8d",
    expectedProduct: "Flagship Football",
    expectedSetName: "ROOKIES",
  });

  await resolveGolden({
    label: "2023 Upper Deck Series 2 Honor Roll #HR46 Joona Koppanen",
    title: "2023 Upper Deck Series 2 Honor Roll #HR46 Joona Koppanen",
    year: "2023",
    manufacturer: "Upper Deck",
    cardNumber: "HR46",
    player: "Joona Koppanen",
    parallel: "Base",
    team: "Boston Bruins",
    sport: "Hockey",
    league: "NHL",
    expectedIdentityId: "dcf99c60-2a2d-51af-a9c5-7e6dd4548a77",
    expectedFingerprint:
      "2e25c2600ac2b45b29890632633bfe25e2f12e8b76dcb5b9e4c7204689e96754",
    expectedProduct: "Upper Deck Series 2",
    expectedSetName: "Honor Roll",
  });

  await resolveGolden({
    label: "2024 Panini Prizm #42 Julie Vanloo Blue Prizm /199",
    title: "2024 Panini Prizm #42 Julie Vanloo Blue Prizm /199",
    year: "2024",
    manufacturer: "Panini",
    cardNumber: "42",
    player: "Julie Vanloo",
    parallel: "Blue Prizm",
    serialNumber: "/199",
    sport: "Basketball",
    league: "WNBA",
    expectedIdentityId: "d201f389-9650-5fec-8b73-ce4e503227b1",
    expectedFingerprint:
      "ea03ba3adf0e49dc77c49ccab6b0c50b28994ba6376b87ced762247619a04425",
    expectedProduct: "Prizm WNBA",
    expectedSetName: "Base",
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
