import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parsePaniniStructuredChecklist } from "../src/lib/checklist-registry/panini-structured";
import { buildChecklistSourceStorageReceipt } from "../src/lib/checklist-registry/storage";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const fixturePath = resolve(
  process.cwd(),
  "scripts/fixtures/checklist-registry/2025-panini-select-wnba.structured.json",
);
const fixtureText = readFileSync(fixturePath, "utf8");

const artifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://www.paniniamerica.net/2025-panini-select-wnba-trading-card-box-hobby-blaster",
  originalFilename: "2025-panini-select-wnba-structured-snapshot.json",
  mimeType: "application/json",
  content: fixtureText,
  retrievedAt: "2026-07-25T16:15:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
};

type Scenario = {
  key: string;
  passed: boolean;
  detail: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
function scenario(
  key: string,
  detail: string,
  passed: boolean,
  evidence: Record<string, unknown>,
) {
  scenarios.push({ key, detail, passed, evidence });
}

const plan = parsePaniniStructuredChecklist(artifact);

scenario(
  "official_panini_test_batch_parses_without_errors",
  "The first 2025 Panini Select WNBA structured snapshot produces a usable import plan with only the expected test-batch warning.",
  plan.validation.status === "passed" &&
    plan.validation.issues.every((entry) => entry.severity === "warning") &&
    plan.validation.issues.some((entry) => entry.code === "test_batch_only"),
  {
    status: plan.validation.status,
    issues: plan.validation.issues,
  },
);

scenario(
  "import_counts_match_fixture",
  "The importer accounts for every fixture set, card, parallel definition, and exact identity.",
  plan.validation.counts.sets === 4 &&
    plan.validation.counts.cards === 5 &&
    plan.validation.counts.parallels === 21 &&
    plan.validation.counts.identities === 41,
  plan.validation.counts,
);

scenario(
  "source_archive_is_private_and_deterministic",
  "The source snapshot is assigned a private deterministic object path in the locked TCOS checklist bucket.",
  plan.source.privateArchiveRequired &&
    plan.source.normalizedFactsInternalOnly &&
    plan.source.storage.isPublic === false &&
    plan.source.storage.bucket === "tcos-checklist-source-files" &&
    plan.source.storage.objectPath.includes(plan.source.storage.sha256),
  {
    storage: plan.source.storage,
  },
);

const repeatedReceipt = buildChecklistSourceStorageReceipt({
  manufacturerSlug: "PANINI",
  releaseSlug: "2025 Panini Select WNBA",
  originalFilename: "../2025 Panini Select WNBA Structured Snapshot.JSON",
  mimeType: "application/json",
  content: fixtureText,
});
scenario(
  "source_path_normalization_is_stable",
  "Equivalent source metadata produces the same content hash and a traversal-safe normalized path.",
  repeatedReceipt.sha256 === plan.source.storage.sha256 &&
    repeatedReceipt.objectPath.includes("/panini/2025-panini-select-wnba/") &&
    !repeatedReceipt.objectPath.includes("..") &&
    !repeatedReceipt.objectPath.includes(" "),
  {
    firstPath: plan.source.storage.objectPath,
    repeatedPath: repeatedReceipt.objectPath,
  },
);

function findIdentity(params: {
  setName: string;
  cardNumber: string;
  parallel: string;
  serialRun?: string;
}) {
  return plan.identities.find((entry) => {
    const identity = entry.fingerprint.normalized;
    return (
      identity.setName === params.setName.toLowerCase() &&
      identity.cardNumber === params.cardNumber.toLowerCase() &&
      identity.parallel === params.parallel.toLowerCase() &&
      (params.serialRun === undefined || identity.serialRun === params.serialRun)
    );
  });
}

const enFuegoBase = findIdentity({
  setName: "En Fuego",
  cardNumber: "7",
  parallel: "base",
});
const enFuegoSilver = findIdentity({
  setName: "En Fuego",
  cardNumber: "7",
  parallel: "Silver Prizm",
  serialRun: "",
});
const enFuegoWhiteDisco = findIdentity({
  setName: "En Fuego",
  cardNumber: "7",
  parallel: "White Disco Prizm",
  serialRun: "/75",
});

scenario(
  "sonia_citron_en_fuego_base_silver_and_75_are_distinct",
  "Sonia Citron En Fuego #7 Base, Silver Prizm, and White Disco Prizm /75 remain three exact identities.",
  Boolean(enFuegoBase && enFuegoSilver && enFuegoWhiteDisco) &&
    new Set([
      enFuegoBase?.fingerprint.fingerprintSha256,
      enFuegoSilver?.fingerprint.fingerprintSha256,
      enFuegoWhiteDisco?.fingerprint.fingerprintSha256,
    ]).size === 3,
  {
    base: enFuegoBase?.fingerprint,
    silver: enFuegoSilver?.fingerprint,
    whiteDisco75: enFuegoWhiteDisco?.fingerprint,
  },
);

const concourseBase = findIdentity({
  setName: "Base Set - Concourse",
  cardNumber: "83",
  parallel: "base",
});
const premierBase = findIdentity({
  setName: "Base Set - Premier Level",
  cardNumber: "122",
  parallel: "base",
});
const courtsideBase = findIdentity({
  setName: "Base Set - Courtside",
  cardNumber: "232",
  parallel: "base",
});
scenario(
  "select_levels_never_collapse",
  "Concourse, Premier Level, Courtside, and En Fuego Sonia Citron cards remain separate despite sharing the same player and product.",
  Boolean(concourseBase && premierBase && courtsideBase && enFuegoBase) &&
    new Set([
      concourseBase?.fingerprint.fingerprintSha256,
      premierBase?.fingerprint.fingerprintSha256,
      courtsideBase?.fingerprint.fingerprintSha256,
      enFuegoBase?.fingerprint.fingerprintSha256,
    ]).size === 4,
  {
    concourse: concourseBase?.fingerprint.fingerprintSha256,
    premier: premierBase?.fingerprint.fingerprintSha256,
    courtside: courtsideBase?.fingerprint.fingerprintSha256,
    enFuego: enFuegoBase?.fingerprint.fingerprintSha256,
  },
);

scenario(
  "all_identity_fingerprints_are_unique",
  "No generated exact-card identity collides within the import plan.",
  new Set(plan.identities.map((entry) => entry.fingerprint.fingerprintSha256)).size ===
    plan.identities.length,
  {
    identityCount: plan.identities.length,
    uniqueFingerprintCount: new Set(
      plan.identities.map((entry) => entry.fingerprint.fingerprintSha256),
    ).size,
  },
);

const wrongDomainPlan = parsePaniniStructuredChecklist({
  ...artifact,
  sourceUrl: "https://example.test/not-panini.json",
});
scenario(
  "official_source_domain_mismatch_requires_validation",
  "An artifact claiming official-manufacturer authority is rejected when its URL is not on Panini's official domain.",
  wrongDomainPlan.validation.status === "validation_required" &&
    wrongDomainPlan.validation.issues.some(
      (entry) =>
        entry.code === "official_source_domain_mismatch" &&
        entry.severity === "error",
    ),
  {
    status: wrongDomainPlan.validation.status,
    issues: wrongDomainPlan.validation.issues,
  },
);

let unsupportedMimeRejected = false;
try {
  buildChecklistSourceStorageReceipt({
    manufacturerSlug: "panini",
    releaseSlug: "2025-panini-select-wnba",
    originalFilename: "checklist.exe",
    mimeType: "application/x-msdownload",
    content: "not allowed",
  });
} catch (error) {
  unsupportedMimeRejected =
    error instanceof Error &&
    error.message.includes("Unsupported checklist source MIME type");
}
scenario(
  "unsupported_source_mime_is_rejected",
  "Executable and unsupported source types cannot enter the private checklist archive.",
  unsupportedMimeRejected,
  { unsupportedMimeRejected },
);

const duplicateSnapshot = JSON.parse(fixtureText) as {
  cardsets: Array<{ cards: unknown[] }>;
};
duplicateSnapshot.cardsets[3].cards.push(
  structuredClone(duplicateSnapshot.cardsets[3].cards[0]),
);
const duplicatePlan = parsePaniniStructuredChecklist({
  ...artifact,
  content: JSON.stringify(duplicateSnapshot),
});
scenario(
  "duplicate_card_rows_enter_validation_queue",
  "Duplicate source rows do not silently create duplicate cards or identities.",
  duplicatePlan.validation.status === "validation_required" &&
    duplicatePlan.validation.issues.some(
      (entry) => entry.code === "duplicate_card" && entry.severity === "error",
    ),
  {
    status: duplicatePlan.validation.status,
    duplicateIssues: duplicatePlan.validation.issues.filter(
      (entry) => entry.code === "duplicate_card",
    ),
  },
);

const failed = scenarios.filter((entry) => !entry.passed);
const output = {
  schema: "tcos.checklist.paniniSelectWnbaSimulation.v1",
  status: failed.length ? "failed" : "passed",
  scenarioCount: scenarios.length,
  passedCount: scenarios.length - failed.length,
  failedCount: failed.length,
  scenarios,
};

console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exitCode = 1;
