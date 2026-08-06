import assert from "node:assert/strict";
import {
  resolveChecklistParallelFromVisualFeatures,
  type InstaCompParallelVisualFeatures,
} from "../src/lib/instacomp-parallel-pattern-matcher";
import type { InstaCompChecklistCandidate } from "../src/lib/instacomp-checklist-first";

function candidate(params: {
  identityId: string;
  parallel: string | null;
  serialRun?: number | null;
}): InstaCompChecklistCandidate {
  return {
    identityId: params.identityId,
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Prizm WNBA",
    setName: "Prizm WNBA",
    cardNumber: "122",
    player: "Sonia Citron",
    serialRun: params.serialRun || null,
    isAuto: false,
    isRelic: false,
    parallel: params.parallel,
    variation: null,
    team: "Washington Mystics",
    sport: "Basketball",
    league: "WNBA",
  };
}

function features(
  overrides: Partial<InstaCompParallelVisualFeatures>,
): InstaCompParallelVisualFeatures {
  return {
    dominantColor: null,
    pattern: "uncertain",
    serialStampPresent: false,
    serialStampText: null,
    serialRun: null,
    autographPresent: false,
    relicPresent: false,
    confidence: 0.99,
    evidence: [],
    ...overrides,
  };
}

const wnbaCandidates = [
  candidate({ identityId: "base", parallel: "Base" }),
  candidate({ identityId: "blue-velocity", parallel: "Blue Velocity Prizm" }),
  candidate({ identityId: "blue-cracked", parallel: "Blue Cracked Ice Prizm" }),
  candidate({ identityId: "green", parallel: "Green Prizm" }),
];

{
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: wnbaCandidates,
    features: features({
      dominantColor: "blue",
      pattern: "velocity",
      evidence: [
        "Repeated blue diagonal speed lines flow in one consistent direction.",
        "No random polygonal shattered-ice facets are visible.",
      ],
    }),
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.selectedIdentityId, "blue-velocity");
  assert.equal(result.selectedParallel, "Blue Velocity Prizm");
}

{
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: wnbaCandidates,
    features: features({
      dominantColor: "blue",
      pattern: "cracked_ice",
      evidence: [
        "Blue random polygonal shards form a non-directional shattered-glass texture.",
      ],
    }),
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.selectedIdentityId, "blue-cracked");
}

{
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: wnbaCandidates,
    features: features({
      dominantColor: "green",
      pattern: "solid_prizm",
      evidence: ["Green refractor foil is visible without a named geometric texture."],
    }),
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.selectedIdentityId, "green");
  assert.notEqual(result.selectedIdentityId, "base");
}

{
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: wnbaCandidates,
    features: features({
      dominantColor: null,
      pattern: "base",
      serialStampPresent: false,
      evidence: ["No colored refractor treatment or special pattern is visible."],
    }),
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.selectedIdentityId, "base");
}

{
  const numberedCandidates = [
    candidate({
      identityId: "blue-velocity-99",
      parallel: "Blue Velocity Prizm",
      serialRun: 99,
    }),
    candidate({
      identityId: "blue-velocity-149",
      parallel: "Blue Velocity Prizm",
      serialRun: 149,
    }),
  ];
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: numberedCandidates,
    features: features({
      dominantColor: "blue",
      pattern: "velocity",
      serialStampPresent: true,
      serialStampText: "17/99",
      serialRun: 99,
    }),
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.selectedIdentityId, "blue-velocity-99");
}

{
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: wnbaCandidates,
    features: features({
      dominantColor: "blue",
      pattern: "uncertain",
      confidence: 0.99,
    }),
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedIdentityId, null);
}

{
  const result = resolveChecklistParallelFromVisualFeatures({
    candidates: wnbaCandidates,
    features: features({
      dominantColor: null,
      pattern: "base",
      serialStampPresent: null,
      confidence: 0.99,
    }),
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedIdentityId, null);
}

console.log(
  "Exact parallel simulations passed: Velocity, Cracked Ice, Green Prizm, Base, serial run, and uncertainty gates.",
);
