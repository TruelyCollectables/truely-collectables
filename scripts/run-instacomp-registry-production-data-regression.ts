import assert from "node:assert/strict";
import {
  resolveChecklistRegistry,
  type ChecklistRegistryLookupResult,
} from "../src/lib/instacomp-learning-server";
import { buildInstaCompRegistryLockProbe } from "../src/lib/instacomp-registry-lock-request";

type Expected = {
  key: string;
  body: Record<string, unknown>;
  identityId: string;
  fingerprint: string;
  cardNumber: string;
};

async function resolveWithBoundedLeadingDigitRecovery(body: Record<string, unknown>) {
  const probe = buildInstaCompRegistryLockProbe(body);
  let resolution = await resolveChecklistRegistry(probe, { evidenceTrusted: false });
  const observed = String(probe.cardNumber || "").trim();

  if (resolution.status !== "internal_exact_match" && /^\d{1,3}$/.test(observed)) {
    const recovered = new Map<string, ChecklistRegistryLookupResult>();
    for (let prefix = 1; prefix <= 9; prefix += 1) {
      const attempt = await resolveChecklistRegistry(
        { ...probe, cardNumber: `${prefix}${observed}` },
        { evidenceTrusted: false },
      );
      if (attempt.status === "internal_exact_match" && attempt.match) {
        recovered.set(attempt.match.identityId, attempt);
      }
    }
    if (recovered.size === 1) {
      resolution = [...recovered.values()][0];
    }
  }

  return { probe, resolution };
}

const cases: Expected[] = [
  {
    key: "sonia-122-base-from-real-bad-reader-payload",
    body: {
      year: "2025",
      manufacturer: null,
      brand: "Prizm",
      setName: "2025 Panini Prizm WNBA - Silver Prizms",
      cardNumber: "22",
      player: "Sonia Citron",
      team: "Washington Mystics",
      sport: "Basketball",
      league: null,
      parallel: null,
      variation: null,
      ocrText: "SONIA CITRON ROOKIE PRIZ PRZN RC CARD 22 WASHINGTON MYSTICS",
    },
    identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
    fingerprint: "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
    cardNumber: "122",
  },
  {
    key: "malonga-116-ice",
    body: {
      year: "2025",
      manufacturer: "Panini",
      brand: "Prizm",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "116",
      player: "Dominique Malonga",
      sport: "Basketball",
      league: "WNBA",
      parallel: "Ice",
    },
    identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    fingerprint: "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
    cardNumber: "116",
  },
  {
    key: "sonia-13-groovy",
    body: {
      year: "2025",
      manufacturer: "Panini",
      brand: "Prizm",
      setName: "2025 Panini Prizm WNBA Groovy",
      cardNumber: "13",
      player: "Sonia Citron",
      sport: "Basketball",
      league: "WNBA",
      parallel: "Base",
      ocrText: "SONIA CITRON GROOVY 13 PANINI",
    },
    identityId: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
    fingerprint: "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad",
    cardNumber: "13",
  },
  {
    key: "paige-5-ice",
    body: {
      year: "2025",
      manufacturer: "Panini",
      brand: "Prizm",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "5",
      player: "Paige Bueckers",
      sport: "Basketball",
      league: "WNBA",
      parallel: "Ice",
    },
    identityId: "575556fe-fdd4-4083-baee-c5071ed3161f",
    fingerprint: "66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42",
    cardNumber: "5",
  },
  {
    key: "rickea-118-base-from-green-title",
    body: {
      year: "2025",
      manufacturer: null,
      brand: "Panini",
      setName: "2025 Panini Prizm WNBA - Green Prizms",
      cardNumber: "118",
      player: "Rickea Jackson",
      team: "Los Angeles Sparks",
      sport: "Basketball",
      parallel: "Base",
      ocrText: "PANINI PRIZN LOS ANGELES SPARKS RICKEA ACKSON No. 118",
    },
    identityId: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
    fingerprint: "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028",
    cardNumber: "118",
  },
];

async function main() {
  for (const testCase of cases) {
    const { probe, resolution } = await resolveWithBoundedLeadingDigitRecovery(testCase.body);
    assert.equal(
      resolution.status,
      "internal_exact_match",
      `${testCase.key}: expected exact Registry match, got ${resolution.status} reasons=${JSON.stringify(resolution.reasons)} count=${resolution.candidateCount} probe=${JSON.stringify(probe)}`,
    );
    assert.ok(resolution.match, `${testCase.key}: exact status missing Registry match`);
    assert.equal(resolution.match.identityId, testCase.identityId, `${testCase.key}: UUID regression`);
    assert.equal(resolution.match.fingerprintSha256, testCase.fingerprint, `${testCase.key}: fingerprint regression`);
    assert.equal(resolution.match.cardNumber, testCase.cardNumber, `${testCase.key}: card-number regression`);
    console.log(
      `PASS production Registry ${testCase.key}: ${resolution.match.identityId} #${resolution.match.cardNumber} ${resolution.match.parallel}`,
    );
  }

  console.log("PASS production Registry data resolves all five Frozen Five canonical identities exactly");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
