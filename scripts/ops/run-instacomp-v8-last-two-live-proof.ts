import assert from "node:assert/strict";
import { applyInstaCompSerialEvidenceGuard } from "../../src/lib/instacomp-identity-guard";
import {
  revalidateChecklistRegistryReceipt,
  resolveChecklistRegistry,
} from "../../src/lib/instacomp-learning-server";

async function exactDirect(input: any, expected: string, fp: string) {
  const r = await resolveChecklistRegistry(input, { evidenceTrusted: false });
  assert.equal(
    r.status,
    "internal_exact_match",
    `${input.player} direct: ${r.status} ${r.reasons.join(",")}`,
  );
  assert.equal(r.candidateCount, 1, `${input.player} candidateCount`);
  assert.equal(r.match?.identityId, expected, `${input.player} UUID`);
  assert.equal(r.match?.fingerprintSha256, fp, `${input.player} fingerprint`);
}

async function exactReceipt(ai: any, expected: string, fp: string) {
  const r = await revalidateChecklistRegistryReceipt({
    ai,
    identityId: expected,
    fingerprintSha256: fp,
  });
  assert.ok(r, `${ai.player} receipt missing`);
  assert.equal(r.status, "internal_exact_match", `${ai.player} receipt status`);
  assert.equal(r.match?.identityId, expected, `${ai.player} receipt UUID`);
  assert.equal(r.match?.fingerprintSha256, fp, `${ai.player} receipt fingerprint`);
}

async function main() {
  await exactDirect(
    { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "2025 Panini Prizm WNBA", cardNumber: "122", parallel: null },
    "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
    "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
  );

  const malongaBad = {
    player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base",
    cardNumber: "116", parallel: "Prizms Ice", serialNumber: "/299",
    team: "Seattle Storm", sport: "Basketball", isRookie: true,
    isAuto: false, isRelic: false, conditionGuess: null, confidence: 0.98, notes: null,
  };
  const malonga = applyInstaCompSerialEvidenceGuard(malongaBad, []);
  assert.equal(malonga.serialNumber, null);
  await exactReceipt(
    malonga,
    "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
  );

  await exactDirect(
    { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "PRIZM", cardNumber: "13", parallel: null, registryVisibleText: "GROOVY SONIA CITRON PRIZM WNBA" },
    "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
    "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad",
  );

  await exactReceipt(
    { player: "Paige Bueckers", year: "2025", brand: "Panini", setName: "Base", cardNumber: "5", parallel: "Prizms Ice", team: "Dallas Wings", sport: "Basketball", isRookie: true, isAuto: false, isRelic: false },
    "575556fe-fdd4-4083-baee-c5071ed3161f",
    "66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42",
  );

  await exactDirect(
    { player: "Rickea Jackson", year: "2025", brand: "Panini", setName: "PRIZM", cardNumber: "118", parallel: null, registryVisibleText: "RICKEA JACKSON PRIZM WNBA LOS ANGELES SPARKS" },
    "70ad307e-06bb-45c2-90ea-689b6e2f302e",
    "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028",
  );

  console.log("PASS live Registry path proof for all five frozen identities");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
