import assert from "node:assert/strict";
import { buildInstaCompRegistryLockProbe } from "../src/lib/instacomp-registry-lock-request";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";

const RICKEA_BASE_UUID = "70ad307e-06bb-45c2-90ea-689b6e2f302e";
const RICKEA_BASE_FINGERPRINT = "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028";

const rickeaVisible = [
  "PANINI",
  "PRIZN",
  "LOS ANGELES SPARKS",
  "RICKEA ACKSON",
  "No.",
  "118",
].join("\n");

const rickea = buildInstaCompRegistryLockProbe({
  year: "2025",
  manufacturer: null,
  brand: "Panini",
  setName: "2025 Panini Prizm WNBA - Green Prizms",
  cardNumber: "118",
  player: "Rickea Jackson",
  team: "Los Angeles Sparks",
  sport: "Basketball",
  parallel: "Base",
  ocrText: rickeaVisible,
});

assert.equal(rickea.brand, "Panini");
assert.equal(
  rickea.setName,
  "Panini Prizm",
  "unsupported Green display-title evidence must retain the Prizm product family",
);
assert.equal(rickea.parallel, "Base");
assert.equal(rickea.cardNumber, "118");
assert.equal(rickea.player, "Rickea Jackson");
assert.ok(!String(rickea.setName).toLowerCase().includes("green"));

const rickeaMatch = chooseRegistryMatch(
  rickea,
  [
    {
      card_number: "118",
      variation: null,
      autograph_status: "non-auto",
      memorabilia_status: "non-memorabilia",
      players: [{ player: { canonical_name: "Rickea Jackson" } }],
      teams: [{ team: { canonical_name: "Los Angeles Sparks" } }],
      release: {
        release_year: "2025",
        season: "2025",
        manufacturer: { name: "Panini" },
        brand: { name: "Prizm" },
        product_name: "2025 Panini Prizm WNBA",
        sport: { name: "Basketball" },
        league: { name: "WNBA" },
      },
      set: { name: "Base" },
      identities: [
        {
          id: RICKEA_BASE_UUID,
          fingerprint_sha256: RICKEA_BASE_FINGERPRINT,
          variation: null,
          autograph_status: "non-auto",
          memorabilia_status: "non-memorabilia",
          parallel: { name: "Base", serial_run: null },
          metadata: {},
          canonical_key: "",
        },
        {
          id: "9052ccc6-4cd2-462c-a7d5-773482f378ac",
          fingerprint_sha256: "1".repeat(64),
          variation: null,
          autograph_status: "non-auto",
          memorabilia_status: "non-memorabilia",
          parallel: { name: "Prizms Black Finite", serial_run: 1 },
          metadata: {},
          canonical_key: "",
        },
      ],
    },
  ],
);
assert.ok(rickeaMatch, "Rickea Base must resolve uniquely after request sanitization");
assert.equal(rickeaMatch.identityId, RICKEA_BASE_UUID);
assert.equal(rickeaMatch.fingerprintSha256, RICKEA_BASE_FINGERPRINT);
assert.equal(rickeaMatch.parallel, "Base");

const sonia = buildInstaCompRegistryLockProbe({
  year: "2025",
  manufacturer: null,
  brand: "Prizm",
  setName: "2025 Panini Prizm WNBA - Silver Prizms",
  cardNumber: "22",
  player: "Sonia Citron",
  parallel: null,
  ocrText: "SONIA CITRON\nPRIZ\n22\nWASHINGTON MYSTICS",
});
assert.equal(sonia.setName, "Prizm");
assert.ok(!String(sonia.setName).toLowerCase().includes("silver"));

const supportedGreen = buildInstaCompRegistryLockProbe({
  year: "2025",
  brand: "Panini",
  setName: "2025 Panini Prizm WNBA - Green Prizms",
  cardNumber: "118",
  player: "Rickea Jackson",
  parallel: "Green Prizms",
  ocrText: "RICKEA JACKSON\n118\nGREEN PRIZM",
});
assert.equal(
  supportedGreen.setName,
  "2025 Panini Prizm WNBA - Green Prizms",
  "supported parallel evidence must never be stripped",
);

const groovy = buildInstaCompRegistryLockProbe({
  year: "2025",
  brand: "Panini",
  setName: "2025 Panini Prizm WNBA Groovy",
  cardNumber: "13",
  player: "Sonia Citron",
  parallel: "Base",
  ocrText: "SONIA CITRON\nGROOVY\n13\nPANINI",
});
assert.equal(groovy.setName, "2025 Panini Prizm WNBA Groovy");

console.log(
  "PASS Registry-lock request keeps product family, resolves Rickea Base UUID/fingerprint, and strips only unsupported parallel titles",
);
