import assert from "node:assert/strict";
import { buildInstaCompRegistryLockProbe } from "../src/lib/instacomp-registry-lock-request";

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
assert.equal(sonia.setName, "Panini Prizm");
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

console.log("PASS Registry-lock request keeps product family while stripping unsupported parallel display titles");
