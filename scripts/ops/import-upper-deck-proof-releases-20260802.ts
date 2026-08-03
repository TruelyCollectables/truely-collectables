import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { importChecklistArtifact } from "../../src/lib/checklist-registry/server";
import type {
  ChecklistImportPlan,
  ChecklistSourceArtifact,
} from "../../src/lib/checklist-registry/source-adapter";

type SourceDefinition = {
  id: string;
  url: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  expected: {
    releaseSlug: string;
    sets: number;
    cards: number;
    parallels: number;
    identities: number;
  };
};

type AuditTarget = {
  release_slug: string;
  release_id: string;
  active_version_id: string;
  adapter_id: string | null;
  cards: number;
  identities: number;
  expected_cards: number;
  expected_identities: number;
};

type AuditState = {
  releases: number;
  active_versions: number;
  active_cards: number;
  active_identities: number;
  identity_deficit_versions: number;
  failed_import_runs: number;
  registry_public_grants: number;
  writer_rpc: boolean;
  private_source_bucket: boolean;
  targets: AuditTarget[];
};

const EXPECTED_ADAPTER = "upper-deck-official-html-checklist";
const SOURCES: SourceDefinition[] = [
  {
    id: "2025-26-upper-deck-allure-hockey",
    url: "https://upperdeck.com/checklist/2025-2026-allure-hockey-checklist/",
    filename: "2025-2026-allure-hockey-checklist.html",
    sha256: "c42b7eaf449f2d3242d093c72d59d9310715a166c34c7ebd589b19f09c6105f8",
    sizeBytes: 886_090,
    expected: {
      releaseSlug: "2025-2026-allure-hockey-checklist",
      sets: 29,
      cards: 1_056,
      parallels: 80,
      identities: 2_900,
    },
  },
  {
    id: "2024-25-upper-deck-series-1-hockey",
    url: "https://upperdeck.com/checklist/2024-25-ud-series-1-hockey-checklist/",
    filename: "2024-25-ud-series-1-hockey-checklist.html",
    sha256: "2cbf501c541daa3eeea4bc273f5c7e6c1ccd298f47800ca6e1a6fd4d9e35d016",
    sizeBytes: 1_196_363,
    expected: {
      releaseSlug: "2024-25-ud-series-1-hockey-checklist",
      sets: 28,
      cards: 1_398,
      parallels: 66,
      identities: 4_418,
    },
  },
];

function requireApplyGate() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Production import requires the explicit --apply flag.");
  }
  if (process.env.ALLOW_PRODUCTION_UPPER_DECK_IMPORT !== "YES") {
    throw new Error(
      "Production import requires ALLOW_PRODUCTION_UPPER_DECK_IMPORT=YES.",
    );
  }
}

function outputPath() {
  const index = process.argv.indexOf("--receipt");
  const supplied = index >= 0 ? process.argv[index + 1] : null;
  return resolve(
    process.cwd(),
    supplied || "evidence/upper-deck-proof-production.json",
  );
}

function exactCounts(plan: ChecklistImportPlan, source: SourceDefinition) {
  const actual = plan.validation.counts;
  const expected = source.expected;
  const mismatches = [
    ["releaseSlug", plan.release.releaseSlug, expected.releaseSlug],
    ["sets", actual.sets, expected.sets],
    ["cards", actual.cards, expected.cards],
    ["parallels", actual.parallels, expected.parallels],
    ["identities", actual.identities, expected.identities],
  ]
    .filter(([, value, target]) => value !== target)
    .map(([label, value, target]) => `${label}=${value}, expected=${target}`);

  if (plan.validation.status !== "passed") {
    mismatches.push(`validationStatus=${plan.validation.status}`);
  }
  const errors = plan.validation.issues.filter(
    (entry) => entry.severity === "error",
  );
  if (errors.length) {
    mismatches.push(
      `errors=${errors.map((entry) => `${entry.code}: ${entry.message}`).join(" | ")}`,
    );
  }
  if (plan.adapterId !== EXPECTED_ADAPTER) {
    mismatches.push(`adapterId=${plan.adapterId}, expected=${EXPECTED_ADAPTER}`);
  }
  const unique = new Set(
    plan.identities.map((entry) => entry.fingerprint.fingerprintSha256),
  ).size;
  if (unique !== plan.identities.length) {
    mismatches.push(
      `uniqueFingerprints=${unique}, identities=${plan.identities.length}`,
    );
  }
  if (mismatches.length) {
    throw new Error(`${source.id} validation blocked: ${mismatches.join(", ")}`);
  }
}

async function fetchPinnedArtifact(source: SourceDefinition) {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent":
        "TCOS-Checklist-Registry/1.0 (+private import; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `${source.id} returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const html = await response.text();
  const bytes = Buffer.from(html, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== source.sha256 || bytes.length !== source.sizeBytes) {
    throw new Error(
      `${source.id} source changed: sha256=${sha256}, size=${bytes.length}; expected sha256=${source.sha256}, size=${source.sizeBytes}`,
    );
  }
  return html;
}

function targetSlugsSql() {
  return SOURCES.map((source) => `'${source.expected.releaseSlug}'`).join(", ");
}

async function auditProduction(label: string): Promise<AuditState> {
  const accessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "");
  const productionUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (!accessToken || !productionUrl) {
    throw new Error("Production audit credentials are incomplete.");
  }
  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const query = `with active_versions as (
      select * from public.checklist_versions where is_active
    ), identity_counts as (
      select version_row.id,
        version_row.normalized_identity_count as expected_identities,
        count(identity_row.id)::bigint as actual_identities
      from active_versions version_row
      left join public.checklist_card_identities identity_row
        on identity_row.version_id = version_row.id
      group by version_row.id, version_row.normalized_identity_count
    ), target_rows as (
      select release_row.release_slug,
        release_row.id as release_id,
        version_row.id as active_version_id,
        release_row.metadata->>'latestAdapterId' as adapter_id,
        version_row.normalized_card_count as expected_cards,
        version_row.normalized_identity_count as expected_identities,
        (select count(*) from public.checklist_cards card_row
          where card_row.version_id = version_row.id) as cards,
        (select count(*) from public.checklist_card_identities identity_row
          where identity_row.version_id = version_row.id) as identities
      from public.checklist_releases release_row
      join active_versions version_row on version_row.release_id = release_row.id
      where release_row.release_slug in (${targetSlugsSql()})
    )
    select json_build_object(
      'releases', (select count(*) from public.checklist_releases),
      'active_versions', (select count(*) from active_versions),
      'active_cards', (
        select count(*) from public.checklist_cards card_row
        join active_versions version_row on version_row.id = card_row.version_id
      ),
      'active_identities', (
        select count(*) from public.checklist_card_identities identity_row
        join active_versions version_row on version_row.id = identity_row.version_id
      ),
      'identity_deficit_versions', (
        select count(*) from identity_counts
        where actual_identities <> expected_identities
      ),
      'failed_import_runs', (
        select count(*) from public.checklist_import_runs where status = 'failed'
      ),
      'registry_public_grants', (
        select count(*) from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name like 'checklist\\_%' escape '\\'
          and grantee in ('anon', 'authenticated')
      ),
      'writer_rpc', to_regprocedure(
        'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'
      ) is not null,
      'private_source_bucket', exists (
        select 1 from storage.buckets
        where id = 'tcos-checklist-source-files' and public = false
      ),
      'targets', coalesce((
        select jsonb_agg(to_jsonb(target_rows) order by release_slug)
        from target_rows
      ), '[]'::jsonb)
    ) as state;`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase ${label} audit failed with HTTP ${response.status}: ${text.slice(0, 1000)}`,
    );
  }
  const rows = text ? JSON.parse(text) : [];
  const state = rows?.[0]?.state as AuditState | undefined;
  if (!state) throw new Error(`Supabase ${label} audit returned no state.`);
  state.targets = Array.isArray(state.targets) ? state.targets : [];
  return state;
}

function requireHealthyState(state: AuditState, label: string) {
  const failures: string[] = [];
  if (Number(state.identity_deficit_versions) !== 0) {
    failures.push(`identity_deficit_versions=${state.identity_deficit_versions}`);
  }
  if (Number(state.failed_import_runs) !== 0) {
    failures.push(`failed_import_runs=${state.failed_import_runs}`);
  }
  if (Number(state.registry_public_grants) !== 0) {
    failures.push(`registry_public_grants=${state.registry_public_grants}`);
  }
  if (state.writer_rpc !== true) failures.push("writer_rpc=false");
  if (state.private_source_bucket !== true) {
    failures.push("private_source_bucket=false");
  }
  if (failures.length) {
    throw new Error(`Production ${label} health blocked: ${failures.join(", ")}`);
  }
}

function requireImportedTargets(
  state: AuditState,
  importedSources: SourceDefinition[],
  baseline: AuditState,
) {
  requireHealthyState(state, `after-${importedSources.length}`);
  if (state.targets.length !== importedSources.length) {
    throw new Error(
      `Production has ${state.targets.length} Upper Deck target releases; expected ${importedSources.length}`,
    );
  }

  for (const source of importedSources) {
    const target = state.targets.find(
      (entry) => entry.release_slug === source.expected.releaseSlug,
    );
    if (!target) {
      throw new Error(`Missing imported target ${source.expected.releaseSlug}`);
    }
    const mismatches = [
      ["adapter_id", target.adapter_id, EXPECTED_ADAPTER],
      ["cards", Number(target.cards), source.expected.cards],
      ["expected_cards", Number(target.expected_cards), source.expected.cards],
      ["identities", Number(target.identities), source.expected.identities],
      [
        "expected_identities",
        Number(target.expected_identities),
        source.expected.identities,
      ],
    ]
      .filter(([, actual, expected]) => actual !== expected)
      .map(([field, actual, expected]) => `${field}=${actual}, expected=${expected}`);
    if (mismatches.length) {
      throw new Error(
        `${source.expected.releaseSlug} verification blocked: ${mismatches.join(", ")}`,
      );
    }
  }

  const expectedCards = importedSources.reduce(
    (sum, source) => sum + source.expected.cards,
    0,
  );
  const expectedIdentities = importedSources.reduce(
    (sum, source) => sum + source.expected.identities,
    0,
  );
  if (Number(state.releases) < Number(baseline.releases) + importedSources.length) {
    throw new Error("Global release count did not increase by the imported targets.");
  }
  if (
    Number(state.active_versions) <
    Number(baseline.active_versions) + importedSources.length
  ) {
    throw new Error("Global active-version count did not increase by the targets.");
  }
  if (Number(state.active_cards) < Number(baseline.active_cards) + expectedCards) {
    throw new Error("Global active-card count did not increase by target cards.");
  }
  if (
    Number(state.active_identities) <
    Number(baseline.active_identities) + expectedIdentities
  ) {
    throw new Error(
      "Global active-identity count did not increase by target identities.",
    );
  }
}

async function main() {
  requireApplyGate();
  const retrievedAt = new Date().toISOString();
  const prepared: Array<{
    source: SourceDefinition;
    artifact: ChecklistSourceArtifact;
    plan: ChecklistImportPlan;
  }> = [];

  for (const source of SOURCES) {
    const html = await fetchPinnedArtifact(source);
    const artifact: ChecklistSourceArtifact = {
      sourceUrl: source.url,
      originalFilename: source.filename,
      mimeType: "text/html",
      content: html,
      retrievedAt,
      authority: "official_manufacturer",
      redistributionAllowed: false,
    };
    const validation = await importChecklistArtifact({
      artifact,
      validateOnly: true,
    });
    exactCounts(validation.plan, source);
    prepared.push({ source, artifact, plan: validation.plan });
  }

  const baseline = await auditProduction("baseline");
  requireHealthyState(baseline, "baseline");
  if (baseline.targets.length !== 0) {
    throw new Error(
      `Production baseline already contains target releases: ${baseline.targets
        .map((entry) => entry.release_slug)
        .join(", ")}`,
    );
  }

  const imports = [];
  const auditStates = [{ label: "baseline", state: baseline }];
  const importedSources: SourceDefinition[] = [];

  for (const entry of prepared) {
    const result = await importChecklistArtifact({
      artifact: entry.artifact,
      validateOnly: false,
    });
    if (!result.ok || result.validatedOnly || !result.persistence) {
      throw new Error(`${entry.source.id} did not persist successfully.`);
    }
    importedSources.push(entry.source);
    const state = await auditProduction(`after-${entry.source.id}`);
    requireImportedTargets(state, importedSources, baseline);
    auditStates.push({ label: `after-${entry.source.id}`, state });
    imports.push({
      id: entry.source.id,
      sourceSha256: entry.source.sha256,
      sourceSizeBytes: entry.source.sizeBytes,
      releaseSlug: entry.source.expected.releaseSlug,
      counts: entry.plan.validation.counts,
      adapter: result.adapter,
      persistence: result.persistence,
    });
  }

  const receipt = {
    schema: "tcos.checklist.upperDeckProofProductionImport.v1",
    generatedAt: new Date().toISOString(),
    sourceCommit: process.env.EXPECTED_MAIN_SHA || null,
    status: "passed",
    imports,
    auditStates,
    finalTargets: auditStates.at(-1)?.state.targets || [],
    safety: {
      migrationsApplied: false,
      deploymentPerformed: false,
      rawOfficialHtmlIncluded: false,
      importedReleaseSlugs: SOURCES.map(
        (source) => source.expected.releaseSlug,
      ),
    },
  };
  const receiptPath = outputPath();
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exitCode = 1;
});
