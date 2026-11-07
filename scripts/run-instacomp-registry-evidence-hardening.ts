import {
  buildEvidenceFirstRegistryProbe,
  registryMatchEvidenceConflicts,
} from "../src/lib/instacomp-registry-evidence-guard";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const probe = buildEvidenceFirstRegistryProbe({
  evidenceAi: {
    player: "Yolanda Griffith",
    year: "2025",
    cardNumber: "LS-YG",
    parallel: "Lava",
    isAuto: true,
    isRelic: false,
  },
  listingIdentityHint: {
    year: "2024",
    brand: "Donruss",
    setName: "Legendary Signatures",
    cardNumber: "10",
  },
  registryVisibleText: "No. LS-YG YOLANDA GRIFFITH 2025 DONRUSS WNBA",
  parallelEvidenceAdjudicated: true,
});

assert(probe.year === "2025", "listing hint must not overwrite physical year");
assert(probe.cardNumber === "LS-YG", "listing hint must not overwrite physical card number");
assert(probe.brand === "Donruss", "listing hint may fill a missing brand lookup coordinate");
assert(probe.setName === "Legendary Signatures", "listing hint may fill a missing set lookup coordinate");

const conflicts = registryMatchEvidenceConflicts({
  registryMatch: {
    player: "Yolanda Griffith",
    year: "2025",
    cardNumber: "10",
    parallel: "Base",
    isAuto: true,
    isRelic: false,
  },
  evidenceAi: {
    player: "Yolanda Griffith",
    year: "2025",
    cardNumber: "LS-YG",
    parallel: "Lava",
    isAuto: true,
    isRelic: false,
  },
  parallelEvidenceAdjudicated: true,
});

assert(
  conflicts.includes("registry_card_number_conflicts_with_physical_evidence"),
  "stale numeric checklist alias must be rejected against LS-YG",
);
assert(
  conflicts.includes("registry_parallel_conflicts_with_adjudicated_physical_evidence"),
  "Base Registry row must be rejected against adjudicated Lava evidence",
);

const safe = registryMatchEvidenceConflicts({
  registryMatch: {
    player: "Yolanda Griffith",
    year: "2025",
    cardNumber: "LS-YG",
    parallel: "Lava",
    isAuto: true,
    isRelic: false,
  },
  evidenceAi: {
    player: "Yolanda Griffith",
    year: "2025",
    cardNumber: "LS YG",
    parallel: "Lava",
    isAuto: true,
    isRelic: false,
  },
  parallelEvidenceAdjudicated: true,
});
assert(safe.length === 0, `normalized exact Registry match should pass: ${safe.join(",")}`);

console.log("PASS InstaComp Registry evidence hardening");
