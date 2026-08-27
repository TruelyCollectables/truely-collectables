import { buildChecklistIdentityFingerprint } from "../src/lib/checklist-registry/identity";
import { normalizeInscribedSubjects } from "../src/lib/checklist-registry/inscriptions";

const cases = [
  {
    manufacturer: "Upper Deck",
    setName: "Centennial Choice Signatures",
    parallel: "Inscriptions",
    player: 'Doug Wilson - HOF 2020"',
    expectedPlayer: "doug wilson",
    expectedVariation: "inscription: hof 2020",
  },
  {
    manufacturer: "Topps",
    setName: "Autograph Inscription Variations",
    parallel: null,
    player: 'Player Alpha - "Go Team"',
    expectedPlayer: "player alpha",
    expectedVariation: "inscription: go team",
  },
  {
    manufacturer: "Panini",
    setName: "Immaculate Ink",
    parallel: "Inscribed Gold",
    player: 'Player Beta "MVP 2025"',
    expectedPlayer: "player beta",
    expectedVariation: "inscription: mvp 2025",
  },
  {
    manufacturer: "Leaf",
    setName: "Message Autographs",
    parallel: null,
    player: 'Player Gamma: "First Pick"',
    expectedPlayer: "player gamma",
    expectedVariation: "inscription: first pick",
  },
];

for (const entry of cases) {
  const fingerprint = buildChecklistIdentityFingerprint({
    releaseYear: "2025",
    manufacturer: entry.manufacturer,
    product: "Regression Product",
    sport: "Hockey",
    league: "NHL",
    setName: entry.setName,
    cardNumber: "A-1",
    players: [entry.player],
    parallel: entry.parallel,
    variation: null,
    autographStatus: "autograph",
  });
  const normalized = fingerprint.normalized;
  if (
    normalized.players.join("|") !== entry.expectedPlayer ||
    normalized.variation !== entry.expectedVariation
  ) {
    throw new Error(
      `${entry.manufacturer} inscription normalization failed: ${JSON.stringify(normalized)}`,
    );
  }
}

const multiSubject = normalizeInscribedSubjects({
  subjects: ['Player One - "Captain"', 'Player Two - "Rookie"'],
  variation: "Short Print",
  context: ["Dual Inscription Autographs"],
});
if (
  multiSubject.subjects.join("|") !== "Player One|Player Two" ||
  multiSubject.variation !==
    "Short Print; Inscription: Captain; Inscription: Rookie"
) {
  throw new Error(`Multi-subject inscriptions failed: ${JSON.stringify(multiSubject)}`);
}

const ordinaryHyphenated = buildChecklistIdentityFingerprint({
  releaseYear: "2025",
  manufacturer: "Any Manufacturer",
  product: "Base Product",
  sport: "Baseball",
  setName: "Base Set",
  cardNumber: "1",
  players: ['Jean-Luc Picard - Alternate Photo"'],
  variation: null,
});
if (
  ordinaryHyphenated.normalized.players.join("|") !==
    'jean-luc picard - alternate photo"' ||
  ordinaryHyphenated.normalized.variation !== ""
) {
  throw new Error(
    `Non-inscription context was altered: ${JSON.stringify(ordinaryHyphenated.normalized)}`,
  );
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      manufacturers: cases.map((entry) => entry.manufacturer),
      multiSubject,
      falsePositiveGuard: ordinaryHyphenated.normalized,
    },
    null,
    2,
  ),
);
