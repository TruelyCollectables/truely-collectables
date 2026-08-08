import assert from "node:assert/strict";
import {
  revalidateChecklistRegistryReceipt,
  resolveChecklistRegistry,
} from "../../src/lib/instacomp-learning-server";

const directCases = [
  {
    player: "Sonia Citron",
    year: "2025",
    brand: "Panini",
    setName: "2025 Panini Prizm WNBA",
    cardNumber: "122",
    parallel: "Base",
    expected: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
    fp: "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
  },
  {
    player: "Sonia Citron",
    year: "2025",
    brand: "Panini",
    setName: "PRIZM",
    cardNumber: "13",
    parallel: "Base",
    registryVisibleText: "GROOVY SONIA CITRON PRIZM WNBA",
    expected: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
    fp: "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad",
  },
  {
    player: "Rickea Jackson",
    year: "2025",
    brand: "Panini",
    setName: "2025 Panini Prizm WNBA",
    cardNumber: "118",
    parallel: "Base",
    expected: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
    fp: "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028",
  },
] as const;

const receiptCases = [
  {
    player: "Dominique Malonga",
    year: "2025",
    brand: "Panini",
    setName: "Base",
    cardNumber: "116",
    parallel: "Prizms Ice",
    expected: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    fp: "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
  },
  {
    player: "Paige Bueckers",
    year: "2025",
    brand: "Panini",
    setName: "Base",
    cardNumber: "5",
    parallel: "Prizms Ice",
    expected: "575556fe-fdd4-4083-baee-c5071ed3161f",
    fp: "66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42",
  },
] as const;

function assertExact(
  label: string,
  resolution: Awaited<ReturnType<typeof resolveChecklistRegistry>> | null,
  expected: string,
  fp: string,
) {
  assert.ok(resolution, `${label}: no Registry resolution returned`);
  assert.equal(
    resolution.status,
    "internal_exact_match",
    `${label}: ${resolution.status} ${resolution.reasons.join(",")}`,
  );
  assert.equal(resolution.candidateCount, 1, `${label} candidateCount`);
  assert.equal(resolution.match?.identityId, expected, `${label} UUID`);
  assert.equal(resolution.match?.fingerprintSha256, fp, `${label} fingerprint`);
}

async function main() {
  for (const input of directCases) {
    const { expected, fp, ...probe } = input;
    const resolution = await resolveChecklistRegistry(probe, { evidenceTrusted: false });
    assertExact(`${input.player} #${input.cardNumber} direct`, resolution, expected, fp);
    console.log(`PASS direct ${input.player} #${input.cardNumber} -> ${expected}`);
  }

  for (const input of receiptCases) {
    const { expected, fp, ...probe } = input;
    const resolution = await revalidateChecklistRegistryReceipt({
      ai: probe,
      identityId: expected,
      fingerprintSha256: fp,
    });
    assertExact(`${input.player} #${input.cardNumber} receipt`, resolution, expected, fp);
    console.log(`PASS receipt ${input.player} #${input.cardNumber} -> ${expected}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
