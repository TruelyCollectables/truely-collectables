import assert from "node:assert/strict";
import { resolveChecklistRegistry } from "../../src/lib/instacomp-learning-server";

const cases = [
  { player:"Sonia Citron", year:"2025", brand:"Panini", setName:"Base", cardNumber:"122", parallel:"Base", expected:"2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f", fp:"4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59" },
  { player:"Dominique Malonga", year:"2025", brand:"Panini", setName:"Base", cardNumber:"116", parallel:"Prizms Ice", expected:"bde0577b-72e8-4e59-8287-89aaf2f9e7e2", fp:"112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32" },
  { player:"Sonia Citron", year:"2025", brand:"Panini", setName:"PRIZM", cardNumber:"13", parallel:"Base", registryVisibleText:"GROOVY SONIA CITRON PRIZM WNBA", expected:"c58ffc4f-e1c7-4cd9-b6e2-599af5a29044", fp:"dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad" },
  { player:"Paige Bueckers", year:"2025", brand:"Panini", setName:"Base", cardNumber:"5", parallel:"Prizms Ice", expected:"575556fe-fdd4-4083-baee-c5071ed3161f", fp:"66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42" },
  { player:"Rickea Jackson", year:"2025", brand:"Panini", setName:"Base", cardNumber:"118", parallel:"Base", expected:"70ad307e-06bb-45c2-90ea-689b6e2f302e", fp:"bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028" },
] as const;

async function main() {
  for (const input of cases) {
    const { expected, fp, ...probe } = input;
    const resolution = await resolveChecklistRegistry(probe, { evidenceTrusted: false });
    assert.equal(
      resolution.status,
      "internal_exact_match",
      `${input.player} #${input.cardNumber}: ${resolution.status} ${resolution.reasons.join(",")}`,
    );
    assert.equal(resolution.candidateCount, 1, `${input.player} candidateCount`);
    assert.equal(resolution.match?.identityId, expected, `${input.player} UUID`);
    assert.equal(resolution.match?.fingerprintSha256, fp, `${input.player} fingerprint`);
    console.log(`PASS ${input.player} #${input.cardNumber} -> ${expected}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
