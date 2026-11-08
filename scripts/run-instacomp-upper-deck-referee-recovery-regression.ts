import assert from "node:assert/strict";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";

let identitySequence = 0;

function identity(parallel: string, serialRun: number | null = null) {
  identitySequence += 1;
  return {
    id: `identity-${identitySequence}`,
    fingerprint_sha256: `${identitySequence}`.padStart(64, "0"),
    canonical_key: "language_code=∅|configuration=∅",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    configuration_exclusivity: null,
    metadata: {},
    parallel: {
      name: parallel,
      serial_run: serialRun,
    },
  };
}

function registryCard(params: {
  setName: string;
  cardNumber: string;
  players: string[];
  team?: string;
  releaseYear?: string;
  product?: string;
  identities: ReturnType<typeof identity>[];
}) {
  return {
    id: `card-${params.setName}-${params.cardNumber}`,
    card_number: params.cardNumber,
    normalized_card_number: params.cardNumber.toLowerCase().replace(/[\s-]/g, ""),
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: {
      id: `set-${params.setName}`,
      name: params.setName,
      normalized_name: params.setName.toLowerCase(),
    },
    release: {
      id: "release-upper-deck-series-1",
      product_name: params.product || "Upper Deck Series 1 Hockey",
      release_year: null,
      season: params.releaseYear || "2024-25",
      manufacturer: { name: "Upper Deck" },
      brand: { name: "Upper Deck" },
      sport: { name: "Hockey" },
      league: { name: "NHL" },
    },
    players: params.players.map((player, index) => ({
      display_order: index,
      player: { canonical_name: player },
    })),
    teams: [params.team || "Chicago Blackhawks"].map((team, index) => ({
      display_order: index,
      team: { canonical_name: team },
    })),
    identities: params.identities,
  };
}

function scanIdentity(overrides: Record<string, unknown>) {
  return {
    player: "Connor Bedard",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "Upper Deck Series 1 Hockey",
    cardNumber: "1",
    parallel: "Base",
    variation: null,
    serialNumber: null,
    team: "Chicago Blackhawks",
    sport: "Hockey",
    league: "NHL",
    languageCode: null,
    configurationExclusivity: null,
    isAuto: false,
    isRelic: false,
    notes: "Front and back show the standard card with no numbered, autograph, or relic evidence.",
    ...overrides,
  };
}

const laneHutson = registryCard({
  setName: "Young Guns",
  cardNumber: "229",
  players: ["Lane Hutson"],
  team: "Montreal Canadiens",
  identities: [
    identity("Base"),
    identity("Clear Cut"),
    identity("Deluxe", 250),
    identity("Outburst Silver"),
  ],
});
const laneMatch = chooseRegistryMatch(
  scanIdentity({
    player: "Lane Hutson",
    year: "2024",
    setName: "Upper Deck Series 1 - Young Guns",
    cardNumber: "229",
    parallel: "Young Guns",
    team: "Montreal Canadiens",
    notes:
      "Young Guns is the printed subset name. No foil, clear stock, serial stamp, or parallel cues are visible.",
  }),
  [laneHutson],
);
assert.equal(laneMatch?.parallel, "Base");
assert.equal(laneMatch?.cardNumber, "229");

const canvasYoungGuns = registryCard({
  setName: "UD Canvas - Young Guns",
  cardNumber: "C-113",
  players: ["Matt Rempe"],
  team: "New York Rangers",
  identities: [identity("Base"), identity("Black and White")],
});
const canvasMatch = chooseRegistryMatch(
  scanIdentity({
    player: "Matt Rempe",
    year: "2024-25",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",
    cardNumber: "C-113",
    parallel: "UD Canvas",
    team: "New York Rangers",
    notes: "UD Canvas and Young Guns are printed subset names; no separate finish is visible.",
  }),
  [canvasYoungGuns],
);
assert.equal(canvasMatch?.parallel, "Base");

const citySatellites = registryCard({
  setName: "City Satellites",
  cardNumber: "CS-3",
  players: ["Connor McDavid"],
  team: "Edmonton Oilers",
  identities: [identity("Base"), identity("Speckle"), identity("Black")],
});
const cityBaseMatch = chooseRegistryMatch(
  scanIdentity({
    player: "Connor McDavid",
    setName: "Upper Deck Series 1 - City Satellites",
    cardNumber: "CS-3",
    parallel: "Insert - exact type uncertain",
    team: "Edmonton Oilers",
    notes: "City Satellites is the insert name. No serial number or parallel evidence is visible.",
  }),
  [citySatellites],
);
assert.equal(cityBaseMatch?.parallel, "Base");

const cityAmbiguous = chooseRegistryMatch(
  scanIdentity({
    player: "Connor McDavid",
    setName: "Upper Deck Series 1 - City Satellites",
    cardNumber: "CS-3",
    parallel: "Holo",
    team: "Edmonton Oilers",
    notes: "A holographic background is visible, but the exact official finish cannot be identified.",
  }),
  [citySatellites],
);
assert.equal(cityAmbiguous, null);

const dazzlers = registryCard({
  setName: "Dazzlers",
  cardNumber: "DZ-13",
  players: ["Connor Bedard"],
  identities: [identity("Base"), identity("Blue"), identity("Red")],
});
const dazzlersBlue = chooseRegistryMatch(
  scanIdentity({
    year: "2024",
    setName: "2023-24 Upper Deck Series 1 - Dazzlers",
    cardNumber: "DZ-13",
    parallel: "Blue Dazzlers",
    notes: "Blue foil finish is visible on the Dazzlers insert.",
  }),
  [dazzlers],
);
assert.equal(dazzlersBlue?.parallel, "Blue");

const opcGlossy = registryCard({
  setName: "O-Pee-Chee Glossy",
  cardNumber: "OG-5",
  players: ["Alex Ovechkin"],
  team: "Washington Capitals",
  identities: [identity("Base"), identity("Gold")],
});
const opcGold = chooseRegistryMatch(
  scanIdentity({
    player: "Alex Ovechkin",
    brand: "O-Pee-Chee / Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - O-Pee-Chee Glossy",
    cardNumber: "OG-5",
    parallel: "Glossy",
    team: "Washington Capitals",
    notes: "Glossy is the insert name; a gold border and gold finish are clearly visible.",
  }),
  [opcGlossy],
);
assert.equal(opcGold?.parallel, "Gold");

const canvasMultiPlayer = registryCard({
  setName: "UD Canvas",
  cardNumber: "C-90",
  players: ["Cole Caufield", "Connor Bedard"],
  identities: [identity("Base")],
});
const multiPlayerMatch = chooseRegistryMatch(
  scanIdentity({
    player: "Connor Bedard, Cole Caufield",
    year: "2024",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas",
    cardNumber: "C-90",
    parallel: "UD Canvas",
    notes: "UD Canvas is the official set name and no separate parallel finish is visible.",
  }),
  [canvasMultiPlayer],
);
assert.equal(multiPlayerMatch?.player, "Cole Caufield / Connor Bedard");

const checkpoint = registryCard({
  setName: "Checkpoint",
  cardNumber: "CP-11",
  players: ["Alex Ovechkin"],
  team: "Washington Capitals",
  identities: [identity("Base")],
});
const checkpointMatch = chooseRegistryMatch(
  scanIdentity({
    player: "Alex Ovechkin",
    setName: "Upper Deck Series 1 - Check Point",
    cardNumber: "CP-11",
    parallel: "Base",
    team: "Washington Capitals",
  }),
  [checkpoint],
);
assert.equal(checkpointMatch?.setName, "Checkpoint");

const populationCount = registryCard({
  setName: "Population Count 1000",
  cardNumber: "PC-3",
  players: ["Connor Bedard"],
  identities: [identity("Base")],
});
const populationMatch = chooseRegistryMatch(
  scanIdentity({
    year: "2024",
    setName: "Upper Deck Series 1 - Population Count",
    cardNumber: "PC-3",
    parallel: "Population Count 1000",
    notes: "Population Count 1000 is printed as the official set identity; no separate finish is visible.",
  }),
  [populationCount],
);
assert.equal(populationMatch?.parallel, "Base");

const wrongCardNumber = chooseRegistryMatch(
  scanIdentity({
    player: "Lane Hutson",
    year: "2024",
    setName: "Upper Deck Series 1 - Young Guns",
    cardNumber: "530",
    parallel: "Outburst",
    team: "Montreal Canadiens",
  }),
  [laneHutson],
);
assert.equal(wrongCardNumber, null);

const sameDenominatorColors = registryCard({
  setName: "Young Guns",
  cardNumber: "107",
  players: ["Shedeur Sanders"],
  team: "Cleveland Browns",
  product: "Origins Football",
  identities: [identity("Holo Blue", 199), identity("Holo Red", 199)],
});
const wrongColorSameSerial = chooseRegistryMatch(
  scanIdentity({
    player: "Shedeur Sanders",
    brand: "Panini",
    setName: "Origins Football - Young Guns",
    cardNumber: "107",
    parallel: "Holo Green",
    serialNumber: "162/199",
    team: "Cleveland Browns",
    sport: "Football",
    league: "NFL",
  }),
  [
    {
      ...sameDenominatorColors,
      release: {
        ...sameDenominatorColors.release,
        manufacturer: { name: "Panini" },
        brand: { name: "Origins" },
        product_name: "Origins Football",
        sport: { name: "Football" },
        league: { name: "NFL" },
      },
    },
  ],
);
assert.equal(wrongColorSameSerial, null);

console.log(
  JSON.stringify(
    {
      ok: true,
      recovered: {
        laneHutson: laneMatch?.parallel,
        canvasYoungGuns: canvasMatch?.parallel,
        citySatellites: cityBaseMatch?.parallel,
        dazzlers: dazzlersBlue?.parallel,
        opcGlossy: opcGold?.parallel,
        multiPlayer: multiPlayerMatch?.player,
        checkpoint: checkpointMatch?.setName,
        populationCount: populationMatch?.parallel,
      },
      rejected: {
        ambiguousHolo: cityAmbiguous === null,
        wrongCardNumber: wrongCardNumber === null,
        wrongColorSameSerial: wrongColorSameSerial === null,
      },
    },
    null,
    2,
  ),
);
