import { readFileSync } from "node:fs";

import {
  CHECKLIST_IDENTITY_SCHEMA,
  buildChecklistIdentityFingerprint,
  buildInstaCompCompFingerprint,
  type ChecklistIdentityInput,
} from "../src/lib/checklist-registry/identity";

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

function fingerprint(input: ChecklistIdentityInput) {
  return buildChecklistIdentityFingerprint(input);
}

const migrationSql = readFileSync(
  new URL(
    "../supabase/migrations/20260725_tcos_checklist_registry_core.sql",
    import.meta.url,
  ),
  "utf8",
);
const compactMigrationSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

const createTableStatements = migrationSql.match(/create table[^;]+;/gi) || [];
scenario(
  "migration_uses_idempotent_ddl_contract",
  "Every Registry table creation uses IF NOT EXISTS and seed writes use ON CONFLICT.",
  createTableStatements.length >= 20 &&
    createTableStatements.every((statement) =>
      /create table if not exists/i.test(statement),
    ) &&
    /on conflict \(slug\)/i.test(migrationSql),
  {
    createTableCount: createTableStatements.length,
    nonIdempotentTableStatements: createTableStatements.filter(
      (statement) => !/create table if not exists/i.test(statement),
    ),
  },
);

scenario(
  "release_checklist_and_import_statuses_are_independent",
  "Release timing, checklist availability, and parser/import state are stored independently.",
  compactMigrationSql.includes("release_status text") &&
    compactMigrationSql.includes("checklist_status text") &&
    compactMigrationSql.includes("import_status text"),
  {
    releaseStatus: compactMigrationSql.includes("release_status text"),
    checklistStatus: compactMigrationSql.includes("checklist_status text"),
    importStatus: compactMigrationSql.includes("import_status text"),
  },
);

scenario(
  "wnba_and_womens_soccer_taxonomy_are_preserved",
  "WNBA remains a distinct league under Basketball and Women's Soccer remains separately searchable.",
  migrationSql.includes("('WNBA','wnba')") &&
    migrationSql.includes("where sport.slug = 'basketball'") &&
    migrationSql.includes("('Women''s Soccer','womens-soccer')"),
  {
    hasWnbaLeagueSeed: migrationSql.includes("('WNBA','wnba')"),
    wnbaUnderBasketball: migrationSql.includes("where sport.slug = 'basketball'"),
    hasWomensSoccer: migrationSql.includes(
      "('Women''s Soccer','womens-soccer')",
    ),
  },
);

scenario(
  "source_hash_and_version_uniqueness_are_enforced",
  "Identical files cannot create duplicate source records for one release, and parser/schema reruns cannot duplicate a normalized version.",
  compactMigrationSql.includes("unique (release_id, sha256)") &&
    compactMigrationSql.includes(
      "unique (source_file_id, parser_version, normalized_schema_version)",
    ),
  {
    sourceHashUnique: compactMigrationSql.includes(
      "unique (release_id, sha256)",
    ),
    normalizedVersionUnique: compactMigrationSql.includes(
      "unique (source_file_id, parser_version, normalized_schema_version)",
    ),
  },
);

scenario(
  "release_history_is_append_only",
  "Release date revisions, status events, and revision diffs reject update and delete mutations.",
  compactMigrationSql.includes("tcos_checklist_reject_history_mutation") &&
    compactMigrationSql.includes("before update or delete") &&
    compactMigrationSql.includes("checklist_release_date_revisions") &&
    compactMigrationSql.includes("checklist_release_status_events") &&
    compactMigrationSql.includes("checklist_revision_diffs"),
  {
    hasMutationGuard: compactMigrationSql.includes(
      "tcos_checklist_reject_history_mutation",
    ),
    hasAppendOnlyTrigger: compactMigrationSql.includes(
      "before update or delete",
    ),
  },
);

const protectedMutationPattern =
  /(?:alter|create|drop|truncate|insert\s+into|update|delete\s+from)\s+(?:table\s+)?public\.(products|orders|order_items|offers|ebay_tokens|tcos_mi_[a-z0-9_]+)/gi;
const protectedMutations = migrationSql.match(protectedMutationPattern) || [];
scenario(
  "migration_is_isolated_from_protected_systems",
  "The Registry migration does not mutate storefront, checkout, order, eBay, or Market Intel tables.",
  protectedMutations.length === 0,
  { protectedMutations },
);

scenario(
  "registry_tables_are_private_service_role_only",
  "Registry tables enable RLS, revoke anon/authenticated access, and explicitly grant service-role access without public policies.",
  compactMigrationSql.includes("enable row level security") &&
    compactMigrationSql.includes(
      "revoke all on table public.%i from anon, authenticated",
    ) &&
    compactMigrationSql.includes(
      "grant select, insert, update, delete on table public.%i to service_role",
    ) &&
    !/create\s+policy/i.test(migrationSql),
  {
    enablesRls: compactMigrationSql.includes("enable row level security"),
    revokesPublicRoles: compactMigrationSql.includes(
      "revoke all on table public.%i from anon, authenticated",
    ),
    createsPublicPolicy: /create\s+policy/i.test(migrationSql),
  },
);

const soniaUnnumbered = fingerprint({
  releaseYear: 2025,
  manufacturer: "Panini",
  brand: "Select WNBA",
  product: "2025 Panini Select WNBA",
  sport: "Basketball",
  league: "WNBA",
  setName: "En Fuego",
  cardNumber: "#7",
  players: "Sonia Citron",
  teams: "Washington Mystics",
  parallel: "Prizm",
  autographStatus: "non-auto",
});

const soniaNumbered = fingerprint({
  releaseYear: "2025",
  manufacturer: "Panini",
  brand: "Select WNBA",
  product: "2025 Panini Select WNBA",
  sport: "Basketball",
  league: "WNBA",
  setName: "En Fuego",
  cardNumber: "7",
  players: "Sonia Citron",
  teams: "Washington Mystics",
  parallel: "Orange Flash Prizm",
  serialRun: "23/75",
  autographStatus: "Non Auto",
});

scenario(
  "sonia_citron_unnumbered_and_75_stay_distinct",
  "The unnumbered En Fuego Prizm and the separately numbered /75 parallel must never merge.",
  soniaUnnumbered.fingerprintSha256 !== soniaNumbered.fingerprintSha256 &&
    soniaNumbered.normalized.serialRun === "/75",
  {
    unnumbered: soniaUnnumbered.fingerprintSha256,
    numbered: soniaNumbered.fingerprintSha256,
    serialRun: soniaNumbered.normalized.serialRun,
  },
);

const soniaCopyA = fingerprint({
  ...soniaNumbered.normalized,
  manufacturer: "PANINI",
  product: "2025  Panini Select WNBA",
  setName: "En Fuego",
  cardNumber: "# 7",
  players: ["Sonia Citron"],
  serialRun: "23/75",
});
const soniaCopyB = fingerprint({
  ...soniaNumbered.normalized,
  manufacturer: "Panini",
  product: "2025 Panini Select WNBA",
  setName: "En Fuego",
  cardNumber: "7",
  players: ["Sonia Citron"],
  serialRun: "71 / 75",
});

scenario(
  "printed_copy_number_does_not_split_registry_identity",
  "Different physical serial positions within the same /75 tier share one Registry identity.",
  soniaCopyA.fingerprintSha256 === soniaCopyB.fingerprintSha256,
  {
    copyA: soniaCopyA.fingerprintSha256,
    copyB: soniaCopyB.fingerprintSha256,
  },
);

const demidovBase = {
  season: "2025-26",
  manufacturer: "Upper Deck",
  brand: "Allure",
  product: "2025-26 Upper Deck Allure Hockey",
  sport: "Hockey",
  league: "NHL",
  setName: "Base Set",
  cardNumber: "110",
  players: "Ivan Demidov",
  teams: "Montreal Canadiens",
} satisfies ChecklistIdentityInput;
const demidovBlackRainbow = fingerprint({
  ...demidovBase,
  parallel: "Black Rainbow",
});
const demidovGlitterBomb = fingerprint({
  ...demidovBase,
  parallel: "Glitter Bomb",
});

scenario(
  "demidov_black_rainbow_and_glitter_bomb_stay_distinct",
  "Upper Deck Allure Black Rainbow and Glitter Bomb remain separate exact identities.",
  demidovBlackRainbow.fingerprintSha256 !==
    demidovGlitterBomb.fingerprintSha256,
  {
    blackRainbow: demidovBlackRainbow.fingerprintSha256,
    glitterBomb: demidovGlitterBomb.fingerprintSha256,
  },
);

const bowmanBase = {
  releaseYear: 2025,
  manufacturer: "Topps",
  brand: "Bowman",
  product: "2025 Bowman Baseball",
  sport: "Baseball",
  league: "MLB",
  setName: "Prospects",
  cardNumber: "BP-1",
  players: "Example Prospect",
  teams: "Example Club",
} satisfies ChecklistIdentityInput;
const bowmanVariants = [
  ["Bowman Paper", null],
  ["Bowman Chrome", null],
  ["Bowman Chrome Mega/Mojo", "Mega Box"],
  ["Bowman Sapphire", "Sapphire"],
  ["Bowman Chrome", "Refractor"],
  ["Bowman Chrome", "Fuchsia Refractor"],
] as const;
const bowmanFingerprints = bowmanVariants.map(([setName, parallel]) =>
  fingerprint({ ...bowmanBase, setName, parallel }),
);

scenario(
  "bowman_product_families_and_parallels_stay_distinct",
  "Paper, Chrome, Mega/Mojo, Sapphire, Refractor, and Fuchsia Refractor identities do not collapse.",
  new Set(bowmanFingerprints.map((item) => item.fingerprintSha256)).size ===
    bowmanVariants.length,
  {
    variants: bowmanVariants.map(([setName, parallel], index) => ({
      setName,
      parallel,
      fingerprint: bowmanFingerprints[index]?.fingerprintSha256,
    })),
  },
);

const normalizedOrderA = fingerprint({
  releaseYear: 2026,
  manufacturer: "Leaf",
  product: "Multi-Signed Sports",
  sport: "Multi-sport",
  setName: "Dual Signatures",
  cardNumber: "DS-1",
  players: ["Player B", "Player A"],
  teams: ["Team B", "Team A"],
  parallel: "Silver",
  autographStatus: "Autograph",
});
const normalizedOrderB = fingerprint({
  releaseYear: "2026",
  manufacturer: "leaf",
  product: "Multi-Signed Sports",
  sport: "Multi-sport",
  setName: "Dual Signatures",
  cardNumber: "DS-1",
  players: ["Player A", "Player B", "Player A"],
  teams: ["Team A", "Team B"],
  parallel: "silver",
  autographStatus: "auto",
});

scenario(
  "normalization_is_deterministic",
  "Whitespace, casing, duplicate names, and player/team input ordering do not create false identities.",
  normalizedOrderA.fingerprintSha256 === normalizedOrderB.fingerprintSha256,
  {
    canonicalA: normalizedOrderA.canonicalKey,
    canonicalB: normalizedOrderB.canonicalKey,
  },
);

const rawComp = buildInstaCompCompFingerprint({
  registryIdentity: soniaNumbered,
  condition: "raw",
});
const psa10Comp = buildInstaCompCompFingerprint({
  registryIdentity: soniaNumbered,
  condition: "graded",
  gradingCompany: "PSA",
  grade: 10,
});

scenario(
  "registry_identity_is_condition_agnostic_but_comp_identity_is_not",
  "Raw and PSA 10 versions share the physical-card Registry identity while receiving different comp fingerprints.",
  rawComp.registryFingerprintSha256 === psa10Comp.registryFingerprintSha256 &&
    rawComp.fingerprintSha256 !== psa10Comp.fingerprintSha256,
  {
    registry: rawComp.registryFingerprintSha256,
    rawComp: rawComp.fingerprintSha256,
    psa10Comp: psa10Comp.fingerprintSha256,
  },
);

scenario(
  "identity_schema_is_versioned",
  "Every Registry fingerprint carries the locked v1 schema marker.",
  soniaUnnumbered.schema === CHECKLIST_IDENTITY_SCHEMA &&
    soniaUnnumbered.canonicalKey.startsWith(
      `schema=${CHECKLIST_IDENTITY_SCHEMA}|`,
    ),
  {
    schema: soniaUnnumbered.schema,
    canonicalPrefix: soniaUnnumbered.canonicalKey.split("|")[0],
  },
);

const failures = scenarios.filter((item) => !item.passed);
const report = {
  schema: "tcos.checklist.registryCoreSimulation.v1",
  status: failures.length ? "failed" : "passed",
  scenarioCount: scenarios.length,
  passedCount: scenarios.length - failures.length,
  failedCount: failures.length,
  scenarios,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) process.exit(1);
