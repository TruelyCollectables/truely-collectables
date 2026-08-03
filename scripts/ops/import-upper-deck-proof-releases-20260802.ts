import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TARGETS = [
  {
    slug: "2025-2026-allure-hockey-checklist",
    cards: 1_056,
    identities: 2_900,
  },
  {
    slug: "2024-25-ud-series-1-hockey-checklist",
    cards: 1_398,
    identities: 4_418,
  },
] as const;

function requireAuditGate() {
  if (!process.argv.includes("--audit-only")) {
    throw new Error("This revision is read-only and requires --audit-only.");
  }
  if (process.argv.includes("--apply")) {
    throw new Error("The timeout audit refuses --apply.");
  }
}

function receiptPath() {
  const index = process.argv.indexOf("--receipt");
  return resolve(
    process.cwd(),
    index >= 0 && process.argv[index + 1]
      ? process.argv[index + 1]
      : "evidence/upper-deck-timeout-audit.json",
  );
}

function quotedTargetSlugs() {
  return TARGETS.map((target) => `'${target.slug}'`).join(", ");
}

function storageObjectPredicate() {
  return TARGETS.map(
    (target) =>
      `object_row.name like 'tcos/checklist/sourcePath/v1/upper-deck/${target.slug}/%'`,
  ).join(" or ");
}

async function queryProduction() {
  const accessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "");
  const productionUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (!accessToken || !productionUrl) {
    throw new Error("Production audit credentials are incomplete.");
  }

  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Could not resolve Production project reference.");
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const query = `with target_releases as (
      select release_row.*
      from public.checklist_releases release_row
      where release_row.slug in (${quotedTargetSlugs()})
    ), active_versions as (
      select version_row.*
      from public.checklist_versions version_row
      where version_row.is_active
    ), global_identity_counts as (
      select version_row.id,
        version_row.normalized_identity_count as expected_identities,
        count(identity_row.id)::bigint as actual_identities
      from active_versions version_row
      left join public.checklist_card_identities identity_row
        on identity_row.version_id = version_row.id
      group by version_row.id, version_row.normalized_identity_count
    )
    select jsonb_build_object(
      'global', jsonb_build_object(
        'releases', (select count(*) from public.checklist_releases),
        'activeVersions', (select count(*) from active_versions),
        'activeCards', (
          select count(*) from public.checklist_cards card_row
          join active_versions version_row on version_row.id = card_row.version_id
        ),
        'activeIdentities', (
          select count(*) from public.checklist_card_identities identity_row
          join active_versions version_row on version_row.id = identity_row.version_id
        ),
        'identityDeficitVersions', (
          select count(*) from global_identity_counts
          where actual_identities <> expected_identities
        ),
        'failedImportRuns', (
          select count(*) from public.checklist_import_runs
          where status = 'failed'
        ),
        'nonterminalImportRuns', (
          select count(*) from public.checklist_import_runs
          where status in ('queued','running','validation_required','partial')
        ),
        'registryPublicGrants', (
          select count(*) from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name like 'checklist\\_%' escape '\\'
            and grantee in ('anon', 'authenticated')
        ),
        'writerRpcPresent', to_regprocedure(
          'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'
        ) is not null,
        'privateSourceBucketPresent', exists (
          select 1 from storage.buckets
          where id = 'tcos-checklist-source-files' and public = false
        )
      ),
      'targets', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'releaseId', release_row.id,
            'slug', release_row.slug,
            'productName', release_row.product_name,
            'releaseStatus', release_row.release_status,
            'checklistStatus', release_row.checklist_status,
            'importStatus', release_row.import_status,
            'adapterId', release_row.metadata->>'latestAdapterId',
            'adapterVersion', release_row.metadata->>'latestAdapterVersion',
            'createdAt', release_row.created_at,
            'updatedAt', release_row.updated_at,
            'versions', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', version_row.id,
                  'versionNumber', version_row.version_number,
                  'status', version_row.status,
                  'isActive', version_row.is_active,
                  'parserVersion', version_row.parser_version,
                  'expectedCards', version_row.normalized_card_count,
                  'actualCards', (
                    select count(*) from public.checklist_cards card_row
                    where card_row.version_id = version_row.id
                  ),
                  'expectedIdentities', version_row.normalized_identity_count,
                  'actualIdentities', (
                    select count(*) from public.checklist_card_identities identity_row
                    where identity_row.version_id = version_row.id
                  ),
                  'actualSets', (
                    select count(*) from public.checklist_sets set_row
                    where set_row.version_id = version_row.id
                  ),
                  'actualParallels', (
                    select count(*) from public.checklist_parallels parallel_row
                    where parallel_row.version_id = version_row.id
                  ),
                  'importedAt', version_row.imported_at,
                  'activatedAt', version_row.activated_at,
                  'createdAt', version_row.created_at,
                  'updatedAt', version_row.updated_at
                ) order by version_row.version_number
              )
              from public.checklist_versions version_row
              where version_row.release_id = release_row.id
            ), '[]'::jsonb),
            'sourceFiles', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', source_file.id,
                  'sha256', source_file.sha256,
                  'sizeBytes', source_file.size_bytes,
                  'objectPath', source_file.storage_object_path,
                  'importStatus', source_file.import_status,
                  'validationStatus', source_file.validation_status,
                  'importerVersion', source_file.importer_version,
                  'retrievedAt', source_file.retrieved_at,
                  'createdAt', source_file.created_at,
                  'updatedAt', source_file.updated_at
                ) order by source_file.created_at
              )
              from public.checklist_source_files source_file
              where source_file.release_id = release_row.id
            ), '[]'::jsonb),
            'importRuns', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', import_run.id,
                  'status', import_run.status,
                  'importerName', import_run.importer_name,
                  'importerVersion', import_run.importer_version,
                  'sourceRows', import_run.source_row_count,
                  'importedRows', import_run.imported_row_count,
                  'skippedRows', import_run.skipped_row_count,
                  'errorCount', import_run.error_count,
                  'startedAt', import_run.started_at,
                  'finishedAt', import_run.finished_at,
                  'createdAt', import_run.created_at,
                  'updatedAt', import_run.updated_at
                ) order by import_run.created_at
              )
              from public.checklist_import_runs import_run
              where import_run.release_id = release_row.id
            ), '[]'::jsonb),
            'openValidationItems', (
              select count(*) from public.checklist_validation_queue validation_row
              where validation_row.release_id = release_row.id
                and validation_row.status in ('open','in_review')
            )
          ) order by release_row.slug
        )
        from target_releases release_row
      ), '[]'::jsonb),
      'targetStorageObjects', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', object_row.id,
            'name', object_row.name,
            'createdAt', object_row.created_at,
            'updatedAt', object_row.updated_at
          ) order by object_row.name
        )
        from storage.objects object_row
        where object_row.bucket_id = 'tcos-checklist-source-files'
          and (${storageObjectPredicate()})
      ), '[]'::jsonb),
      'recentNonterminalRuns', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', import_run.id,
            'status', import_run.status,
            'releaseSlug', release_row.slug,
            'importerName', import_run.importer_name,
            'createdAt', import_run.created_at,
            'updatedAt', import_run.updated_at
          ) order by import_run.created_at desc
        )
        from public.checklist_import_runs import_run
        join public.checklist_releases release_row
          on release_row.id = import_run.release_id
        where import_run.status in ('queued','running','validation_required','partial')
          and import_run.created_at >= now() - interval '12 hours'
      ), '[]'::jsonb)
    ) as audit;`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase read-only timeout audit failed with HTTP ${response.status}: ${text.slice(0, 1500)}`,
    );
  }
  const rows = text ? JSON.parse(text) : [];
  const audit = rows?.[0]?.audit;
  if (!audit) throw new Error("Supabase timeout audit returned no state.");
  audit.targets = Array.isArray(audit.targets) ? audit.targets : [];
  audit.targetStorageObjects = Array.isArray(audit.targetStorageObjects)
    ? audit.targetStorageObjects
    : [];
  audit.recentNonterminalRuns = Array.isArray(audit.recentNonterminalRuns)
    ? audit.recentNonterminalRuns
    : [];
  return audit;
}

function targetIsComplete(target: any) {
  const expected = TARGETS.find((entry) => entry.slug === target.slug);
  if (!expected) return false;
  if (
    target.importStatus !== "successful" ||
    target.checklistStatus !== "live" ||
    target.adapterId !== "upper-deck-official-html-checklist" ||
    Number(target.openValidationItems) !== 0
  ) {
    return false;
  }
  const activeVersions = (target.versions || []).filter(
    (version: any) => version.isActive === true,
  );
  if (activeVersions.length !== 1) return false;
  const version = activeVersions[0];
  if (
    version.status !== "live" ||
    Number(version.expectedCards) !== expected.cards ||
    Number(version.actualCards) !== expected.cards ||
    Number(version.expectedIdentities) !== expected.identities ||
    Number(version.actualIdentities) !== expected.identities
  ) {
    return false;
  }
  return (
    (target.sourceFiles || []).some(
      (file: any) =>
        file.importStatus === "successful" && file.validationStatus === "passed",
    ) &&
    (target.importRuns || []).some((run: any) => run.status === "successful")
  );
}

function classify(audit: any) {
  const targets = audit.targets || [];
  const storageObjects = audit.targetStorageObjects || [];
  if (targets.length === 0 && storageObjects.length === 0) {
    return "clean_absent";
  }
  if (
    targets.length === TARGETS.length &&
    targets.every(targetIsComplete) &&
    Number(audit.global.identityDeficitVersions) === 0 &&
    Number(audit.global.registryPublicGrants) === 0
  ) {
    return "fully_imported";
  }
  return "partial_or_dirty";
}

async function main() {
  requireAuditGate();
  const audit = await queryProduction();
  const receipt = {
    schema: "tcos.checklist.upperDeckTimeoutAudit.v1",
    generatedAt: new Date().toISOString(),
    status: "observed",
    classification: classify(audit),
    audit,
    safety: {
      productionDatabaseReads: true,
      productionDatabaseWrites: false,
      storageReads: true,
      storageWrites: false,
      migrationsApplied: false,
      deploymentPerformed: false,
      rawOfficialHtmlIncluded: false,
    },
  };
  const output = receiptPath();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exitCode = 1;
});
