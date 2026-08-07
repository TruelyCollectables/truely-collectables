import assert from "node:assert/strict";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";

function row(options: { parallel?: string; serialRun?: number | null } = {}) {
  return {
    id: "card-1",
    card_number: "118",
    variation: null,
    autograph_status: null,
    memorabilia_status: null,
    release: {
      release_year: 2025,
      season: "2025",
      product_name: "2025 Panini Prizm WNBA",
      manufacturer: { name: "Panini" },
      brand: { name: "Prizm" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    set: { name: "Base" },
    players: [{ player: { canonical_name: "Rickea Jackson" } }],
    teams: [{ team: { canonical_name: "Los Angeles Sparks" } }],
    identities: [
      {
        id: "identity-1",
        fingerprint_sha256: "a".repeat(64),
        canonical_key: "",
        variation: null,
        autograph_status: null,
        memorabilia_status: null,
        configuration_exclusivity: null,
        metadata: {},
        parallel: {
          name: options.parallel ?? "Base",
          serial_run: options.serialRun ?? null,
        },
      },
    ],
  };
}

const baseFromProductLineNotes = chooseRegistryMatch(
  {
    player: "Rickea Jackson",
    year: "2025",
    brand: "Panini",
    setName: "PRIZM",
    cardNumber: "118",
    parallel: null,
    notes: "2025 Panini Prizm WNBA card. Standard base design with no special foil finish.",
    team: "Los Angeles Sparks",
    sport: "Basketball",
    league: "WNBA",
    isAuto: false,
    isRelic: false,
  },
  [row()],
);
assert.equal(baseFromProductLineNotes?.identityId, "identity-1");

const iceRow = row({ parallel: "Prizms Ice", serialRun: 0 });
const iceFromExplicitField = chooseRegistryMatch(
  {
    player: "Rickea Jackson",
    year: "2025",
    brand: "Prizm",
    setName: "2025 Panini Prizm WNBA",
    cardNumber: "118",
    parallel: "Prizms Ice",
    notes: "White foil-like border and reflective Prizm appearance.",
    team: "Los Angeles Sparks",
    sport: "Basketball",
    league: "WNBA",
    isAuto: false,
    isRelic: false,
  },
  [iceRow],
);
assert.equal(iceFromExplicitField?.identityId, "identity-1");

const missingParallelWithRealSurfaceRisk = chooseRegistryMatch(
  {
    player: "Rickea Jackson",
    year: "2025",
    brand: "Panini",
    setName: "PRIZM",
    cardNumber: "118",
    parallel: null,
    notes: "Silver foil finish is visible across the card surface.",
    team: "Los Angeles Sparks",
    sport: "Basketball",
    league: "WNBA",
    isAuto: false,
    isRelic: false,
  },
  [row()],
);
assert.equal(missingParallelWithRealSurfaceRisk, null);

console.log("InstaComp Registry visible-evidence recovery simulations passed.");
