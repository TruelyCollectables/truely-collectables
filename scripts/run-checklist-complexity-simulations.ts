import {
  assertChecklistPlanComplexity,
  CHECKLIST_IMPORT_COMPLEXITY_LIMITS,
} from "../src/lib/checklist-registry/server";
import type { ChecklistImportPlan } from "../src/lib/checklist-registry/source-adapter";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function basePlan(): ChecklistImportPlan {
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: "complexity-fixture",
    adapterVersion: "1.0.0",
    source: {
      sourceUrl: "https://example.test/checklist.json",
      retrievedAt: "2026-08-01T00:00:00.000Z",
      authority: "manual_official_file",
      redistributionAllowed: false,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage: {
        schema: "tcos.checklist.sourcePath.v1",
        bucket: "tcos-checklist-source-files",
        objectPath: "fixture/checklist.json",
        originalFilename: "checklist.json",
        mimeType: "application/json",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        isPublic: false,
      },
    },
    release: {
      manufacturer: "Panini",
      brand: "Panini",
      product: "Fixture",
      releaseYear: "2026",
      season: null,
      sport: "Basketball",
      league: "WNBA",
      releaseSlug: "fixture",
    },
    sets: [
      {
        sourceKey: "base",
        name: "Base",
        normalizedName: "base",
        setType: "base",
      },
    ],
    cards: [
      {
        sourceKey: "base:1:player",
        setSourceKey: "base",
        cardNumber: "1",
        players: ["Player"],
        teams: ["Team"],
        rookieDesignation: false,
        firstBowmanDesignation: false,
        autographStatus: "non-auto",
        memorabiliaStatus: "non-memorabilia",
        variation: null,
        sourceNotes: null,
      },
    ],
    parallels: [],
    identities: [],
    validation: {
      status: "passed",
      issues: [],
      counts: { sets: 1, cards: 1, parallels: 0, identities: 0 },
    },
  };
}

const safe = basePlan();
safe.identities.push({
  cardSourceKey: "base:1:player",
  parallelSourceKey: null,
  fingerprint: {
    schema: "tcos.checklist.identity.v1",
    normalized: {
      schema: "tcos.checklist.identity.v1",
      releaseYear: "2026",
      season: "",
      manufacturer: "panini",
      brand: "panini",
      product: "fixture",
      sport: "basketball",
      league: "wnba",
      setName: "base",
      subset: "",
      cardNumber: "1",
      players: ["player"],
      teams: ["team"],
      parallel: "base",
      variation: "",
      serialRun: "",
      autographStatus: "non-auto",
      memorabiliaStatus: "non-memorabilia",
      configurationExclusivity: "",
    },
    canonicalKey: "fixture",
    fingerprintSha256: "b".repeat(64),
  },
});
safe.validation.counts.identities = 1;
const receipt = assertChecklistPlanComplexity(safe);
assert(receipt.counts.identities === 1, "safe plan count was wrong");
console.log("PASS normal checklist plan stays inside complexity budget");

const expansion = basePlan();
expansion.identities = Array.from({ length: 1_001 }, (_, index) => ({
  cardSourceKey: "base:1:player",
  parallelSourceKey: null,
  fingerprint: {
    ...safe.identities[0].fingerprint,
    canonicalKey: `fixture-${index}`,
    fingerprintSha256: index.toString(16).padStart(64, "0").slice(-64),
  },
}));
expansion.validation.counts.identities = expansion.identities.length;
let blocked = false;
try {
  assertChecklistPlanComplexity(expansion);
} catch (error) {
  blocked = /identity expansion/.test(
    error instanceof Error ? error.message : String(error),
  );
}
assert(blocked, "identity expansion was not blocked");
console.log("PASS card-by-parallel identity explosion is blocked");

assert(
  CHECKLIST_IMPORT_COMPLEXITY_LIMITS.identities <= 250_000,
  "identity ceiling was unexpectedly relaxed",
);
assert(
  CHECKLIST_IMPORT_COMPLEXITY_LIMITS.serializedPlanBytes <= 64 * 1024 * 1024,
  "serialized plan ceiling was unexpectedly relaxed",
);
console.log("PASS hard global Checklist Registry ceilings remain enforced");
