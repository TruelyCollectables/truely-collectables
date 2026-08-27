import assert from "node:assert/strict";
import {
  chooseDirectRegistryExactMatch,
  type DirectRegistryCardRow,
} from "../src/lib/instacomp-registry-direct-exact";
import { shouldAcceptDirectRegistryRecovery } from "../src/lib/instacomp-registry-direct-acceptance";

const fingerprint = (char: string) => char.repeat(64);

const caitlinRows: DirectRegistryCardRow[] = [
  {
    id: "caitlin-198",
    card_number: "198",
    normalized_card_number: "198",
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: { name: "Panini Instant WNBA" },
    release: {
      product_name: "2024 Panini Instant WNBA",
      release_year: "2024",
      manufacturer: { name: "Panini" },
      brand: { name: "Panini Instant" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Caitlin Clark" } }],
    teams: [{ team: { canonical_name: "Indiana Fever" } }],
    identities: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        fingerprint_sha256: fingerprint("a"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: null, serial_run: null },
      },
    ],
  },
];

const caitlinProbe = {
  year: "2024",
  brand: "Panini",
  setName: "Panini Instant",
  cardNumber: "198",
  player: "CAITLIN CLARK",
  serialNumber: "1/15219",
  isAuto: false,
  isRelic: false,
  registryVisibleText:
    "No. 198 CAITLIN CLARK 1 of 15219 2024-25 PANINI - INSTANT WNBA BASKETBALL",
};

const caitlinMatch = chooseDirectRegistryExactMatch(caitlinProbe, caitlinRows);
assert.ok(caitlinMatch, "Caitlin Instant #198 must resolve to one Registry identity");
assert.equal(caitlinMatch.cardNumber, "198");
assert.equal(caitlinMatch.setName, "Panini Instant WNBA");
assert.equal(caitlinMatch.serialRun, null, "Instant print run must not become a serial parallel");
assert.equal(caitlinMatch.isAuto, false);
assert.equal(caitlinMatch.isRelic, false);
assert.equal(
  shouldAcceptDirectRegistryRecovery({
    probe: caitlinProbe,
    resolution: {
      status: "internal_exact_match",
      match: caitlinMatch,
      reasons: ["fixture"],
      candidateCount: 1,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    },
  }),
  true,
  "same-number direct exact recovery must be accepted",
);

const sarahRows: DirectRegistryCardRow[] = [
  {
    id: "sarah-signatures-15",
    card_number: "15",
    normalized_card_number: "15",
    autograph_status: "autograph",
    memorabilia_status: "non-memorabilia",
    set: { name: "Signatures" },
    release: {
      product_name: "2025 Panini Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Prizm" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Sarah Ashlee Barker" } }],
    teams: [{ team: { canonical_name: "Los Angeles Sparks" } }],
    identities: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        fingerprint_sha256: fingerprint("b"),
        autograph_status: "autograph",
        memorabilia_status: "non-memorabilia",
        parallel: { name: null, serial_run: null },
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        fingerprint_sha256: fingerprint("c"),
        autograph_status: "autograph",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Prizms Green Pulsar", serial_run: 25 },
      },
    ],
    observed_alias: "SG-SAB",
  },
];

const sarahProbe = {
  year: "2025",
  brand: "Panini",
  setName: "Prizm",
  cardNumber: "SG-SAB",
  player: "SARAH ASHLEE BARKER",
  isAuto: true,
  isRelic: false,
  parallel: "Base",
  registryVisibleText:
    "No. SG-SAB SARAH ASHLEE BARKER The autograph is guaranteed by Panini America, Inc. 2025 PANINI - WNBA PRIZM BASKETBALL",
};

const unsafeBaseCandidate = chooseDirectRegistryExactMatch(sarahProbe, sarahRows);
assert.ok(
  unsafeBaseCandidate,
  "fixture must demonstrate why route-level alias acceptance is required",
);
assert.equal(unsafeBaseCandidate.cardNumber, "15");
assert.equal(
  shouldAcceptDirectRegistryRecovery({
    probe: sarahProbe,
    resolution: {
      status: "internal_exact_match",
      match: unsafeBaseCandidate,
      reasons: ["fixture"],
      candidateCount: 1,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    },
  }),
  false,
  "printed alias without specific variant evidence must remain fail-closed",
);

console.log("PASS direct Registry exact recovery keeps Instant #198 exact and physical-number aliases fail closed on variant ambiguity");
