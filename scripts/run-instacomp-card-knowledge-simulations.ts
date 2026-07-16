import {
  buildTcosCardKnowledgeDraft,
  extractSerialRunForKnowledge,
  trustStatusForConfirmedCount,
} from "../src/lib/instacomp-card-knowledge";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const baseAi = {
  player: "Connor McDavid",
  year: "2025-26",
  brand: "Upper Deck",
  setName: "SP Authentic Hockey",
  cardNumber: "O-8",
  parallel: "Outliers",
  serialNumber: null,
  team: "Edmonton Oilers",
  sport: "Hockey",
  isRookie: false,
  isAuto: false,
  isRelic: false,
  conditionGuess: null,
  confidence: 0.98,
  notes: null,
};

assert(trustStatusForConfirmedCount(0) === "learning", "0 sightings should learn");
assert(trustStatusForConfirmedCount(1) === "learning", "1 sighting should learn");
assert(trustStatusForConfirmedCount(2) === "learning", "2 sightings should learn");
assert(
  trustStatusForConfirmedCount(3) === "tcos_trusted",
  "3 sightings should trust",
);

assert(extractSerialRunForKnowledge("17/99") === "/99", "serial run extracts /99");
assert(extractSerialRunForKnowledge("1 of 1") === "/1", "one-of-one extracts /1");

const draft = buildTcosCardKnowledgeDraft({
  resultPayload: {
    ok: true,
    ai: baseAi,
    operatorCorrections: {
      customTitle: "2025-26 SP Authentic Hockey Connor McDavid Outliers #O-8",
    },
  },
});

assert(draft, "knowledge draft should build from a scan result");
assert(
  draft?.title === "2025-26 SP Authentic Hockey Connor McDavid Outliers #O-8",
  "operator title should win",
);
assert(
  draft?.identityFingerprint.includes("2025-26|upper-deck|sp-authentic-hockey|o8"),
  `unexpected fingerprint: ${draft?.identityFingerprint}`,
);

const sameDraft = buildTcosCardKnowledgeDraft({
  resultPayload: {
    ok: true,
    ai: {
      ...baseAi,
      setName: "SP Authentic",
      parallel: "Outliers",
    },
  },
});

assert(
  sameDraft?.identityFingerprint.includes("sp-authentic"),
  "fingerprint should normalize comparable identity fields",
);

console.log("InstaComp™ card knowledge simulations passed.");
