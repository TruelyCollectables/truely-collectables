import assert from "node:assert/strict";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";
const row = {
  card_number: "107", variation: "Rookie",
  players: [{ player: { canonical_name: "Shedeur Sanders" } }],
  teams: [{ team: { canonical_name: "Cleveland Browns" } }],
  release: { release_year: "2025", season: "2025", manufacturer: { name: "Panini" }, brand: { name: "Origins" }, product_name: "Panini Origins Football", sport: { name: "Football" }, league: { name: "NFL" } },
  set: { name: "Base" }, autograph_status: "none", memorabilia_status: "none",
  identities: [{ id: "shedeur-107-holo-blue-199", fingerprint_sha256: "a".repeat(64), parallel: { name: "Holo Blue", serial_run: 199 }, variation: "Rookie", autograph_status: "none", memorabilia_status: "none", metadata: { languageCode: "en" }, canonical_key: "configuration=hobby" }],
};
const scan = { player: "Shedeur Sanders", year: "2025", brand: "Panini", setName: "Origins Football Base", cardNumber: "107", parallel: "Blue Foil", serialNumber: "162/199", isAuto: false, isRelic: false };
assert.equal(chooseRegistryMatch(scan, [row])?.identityId, "shedeur-107-holo-blue-199");
assert.equal(chooseRegistryMatch({ ...scan, cardNumber: "108" }, [row]), null);
assert.equal(chooseRegistryMatch({ ...scan, parallel: "Red Foil" }, [row]), null);
assert.equal(chooseRegistryMatch({ ...scan, serialNumber: "162/99" }, [row]), null);
console.log("Shedeur #107 Holo Blue /199 exact checklist regression passed.");
