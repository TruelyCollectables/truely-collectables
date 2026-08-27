import assert from "node:assert/strict";
import {
  chooseReleaseFirstRegistryExactMatch,
  narrowDirectRegistryReleaseRows,
} from "../src/lib/instacomp-registry-direct-exact-release-first";
import type { DirectRegistryCardRow } from "../src/lib/instacomp-registry-direct-exact";

const probe = {
  year: "2024",
  brand: "Panini",
  setName: "Panini Instant",
  cardNumber: "198",
  player: "Caitlin Clark",
};

const rows = [
  {
    id: "target",
    product_name: "2024 Panini Instant WNBA",
    release_year: "2024",
    season: "2024",
    manufacturer: { name: "Panini" },
    brand: { name: "Panini Instant" },
  },
  {
    id: "wrong-year",
    product_name: "2023 Panini Instant WNBA",
    release_year: "2023",
    season: "2023",
    manufacturer: { name: "Panini" },
    brand: { name: "Panini Instant" },
  },
  {
    id: "wrong-manufacturer",
    product_name: "2024 Upper Deck Hockey",
    release_year: "2024",
    season: "2024-25",
    manufacturer: { name: "Upper Deck" },
    brand: { name: "Upper Deck" },
  },
  ...Array.from({ length: 1251 }, (_, index) => ({
    id: `noise-${index}`,
    product_name: `Unrelated ${index}`,
    release_year: index % 2 ? "2025" : "2022",
    season: index % 2 ? "2025" : "2022",
    manufacturer: { name: index % 3 ? "Topps" : "Upper Deck" },
    brand: { name: index % 3 ? "Bowman" : "Upper Deck" },
  })),
];

const narrowed = narrowDirectRegistryReleaseRows(probe, rows);
assert.deepEqual(
  narrowed.map((row) => row.id),
  ["target"],
  "release-first narrowing must reject global active-version noise before card lookup",
);

const productSpecific = narrowDirectRegistryReleaseRows(
  { ...probe, brand: "Panini Instant" },
  rows,
);
assert.deepEqual(productSpecific.map((row) => row.id), ["target"]);

const fingerprint = (char: string) => char.repeat(64);

const kikiRows: DirectRegistryCardRow[] = [
  {
    id: "kiki-72",
    card_number: "72",
    set: { name: "Base" },
    release: {
      product_name: "2025 Panini Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Prizm" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Kiki Iriafen" } }],
    teams: [{ team: { canonical_name: "Washington Mystics" } }],
    identities: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        fingerprint_sha256: fingerprint("a"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Prizms Silver", serial_run: null },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        fingerprint_sha256: fingerprint("b"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Base", serial_run: null },
      },
    ],
  },
];

const kikiRecovered = chooseReleaseFirstRegistryExactMatch(
  {
    year: "2025",
    brand: "Prizm",
    setName: "Prizm",
    cardNumber: "72",
    player: "WASHINGTON MYSTICS",
    parallel: "Silver Prizm",
    isAuto: false,
    isRelic: false,
  },
  kikiRows,
);
assert.ok(kikiRecovered, "Registry team-name OCR must be treated as absent player evidence");
assert.equal(kikiRecovered.playerRecovered, true);
assert.equal(kikiRecovered.match.player, "Kiki Iriafen");
assert.equal(kikiRecovered.match.parallel, "Prizms Silver");

const uniquePlayerlessRows: DirectRegistryCardRow[] = [
  {
    id: "unique-300",
    card_number: "300",
    set: { name: "Base" },
    release: {
      product_name: "2025 Panini Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Prizm" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Unique Player" } }],
    teams: [{ team: { canonical_name: "Unique Team" } }],
    identities: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        fingerprint_sha256: fingerprint("f"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Base", serial_run: null },
      },
    ],
  },
];
const uniquePlayerless = chooseReleaseFirstRegistryExactMatch(
  {
    year: "2025",
    brand: "Prizm",
    setName: "Prizm",
    cardNumber: "300",
    player: null,
    parallel: null,
    isAuto: false,
    isRelic: false,
  },
  uniquePlayerlessRows,
);
assert.ok(uniquePlayerless, "missing player may recover when only one Registry fingerprint exists");
assert.equal(uniquePlayerless.playerRecovered, true);
assert.equal(uniquePlayerless.match.player, "Unique Player");

const soniaRows: DirectRegistryCardRow[] = [
  {
    id: "sonia-148",
    card_number: "148",
    set: { name: "Base" },
    release: {
      product_name: "2025 Panini Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Prizm" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Sonia Citron" } }],
    teams: [{ team: { canonical_name: "Washington Mystics" } }],
    identities: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        fingerprint_sha256: fingerprint("c"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Base", serial_run: null },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        fingerprint_sha256: fingerprint("d"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Prizms Silver", serial_run: null },
      },
    ],
  },
];

assert.equal(
  chooseReleaseFirstRegistryExactMatch(
    {
      year: "2025",
      brand: "Prizm",
      setName: "Prizm",
      cardNumber: "148",
      player: null,
      parallel: "Base",
      isAuto: false,
      isRelic: false,
    },
    soniaRows,
  ),
  null,
  "missing player plus default Base evidence must remain blocked when an unnumbered parallel is also possible",
);

assert.equal(
  chooseReleaseFirstRegistryExactMatch(
    {
      year: "2025",
      brand: "Prizm",
      setName: "Prizm",
      cardNumber: "148",
      player: "TOTALLY WRONG PERSON",
      parallel: "Base",
    },
    soniaRows,
  ),
  null,
  "non-team wrong player evidence must remain a hard mismatch",
);

const ambiguousRows: DirectRegistryCardRow[] = [
  ...uniquePlayerlessRows,
  {
    ...uniquePlayerlessRows[0],
    id: "other-300",
    players: [{ player: { canonical_name: "Another Player" } }],
    teams: [{ team: { canonical_name: "Another Team" } }],
    identities: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        fingerprint_sha256: fingerprint("e"),
        autograph_status: "non-auto",
        memorabilia_status: "non-memorabilia",
        parallel: { name: "Base", serial_run: null },
      },
    ],
  },
];
assert.equal(
  chooseReleaseFirstRegistryExactMatch(
    {
      year: "2025",
      brand: "Prizm",
      setName: "Prizm",
      cardNumber: "300",
      player: null,
      parallel: null,
    },
    ambiguousRows,
  ),
  null,
  "playerless recovery must stay fail-closed when more than one fingerprint remains",
);

console.log(
  "PASS release-first Registry narrowing avoids global fanout; team-name OCR can recover through a specific variant, while Base/missing-player ambiguity stays blocked",
);
