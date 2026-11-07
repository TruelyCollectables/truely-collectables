\set ON_ERROR_STOP on
\set plan `cat .codex-run/checklist-registry-integration-plan.json`

create temp table versioned_identity_plan(plan jsonb not null);
insert into versioned_identity_plan(plan) values (:'plan'::jsonb);

do $$
declare
  v_plan_v1 jsonb;
  v_plan_v2 jsonb;
  v_result_v1 jsonb;
  v_result_v2 jsonb;
  v_repair jsonb;
  v_repair_again jsonb;
  v_release_id uuid;
  v_version_v1 uuid;
  v_version_v2 uuid;
  v_expected integer;
  v_v1_count integer;
  v_v2_count integer;
  v_duplicate_fingerprints integer;
  v_index_exists boolean;
  v_writer_definition text;
begin
  select plan into v_plan_v1 from versioned_identity_plan;
  v_expected := (v_plan_v1 #>> '{validation,counts,identities}')::integer;

  v_result_v1 := public.tcos_apply_checklist_import_plan(
    v_plan_v1,
    v_plan_v1 #>> '{source,storage,originalFilename}',
    v_plan_v1 #>> '{source,storage,mimeType}',
    (v_plan_v1 #>> '{source,storage,sizeBytes}')::bigint,
    v_plan_v1 #>> '{source,storage,sha256}',
    v_plan_v1 #>> '{source,storage,bucket}',
    v_plan_v1 #>> '{source,storage,objectPath}'
  );

  if v_result_v1->>'status' <> 'live' then
    raise exception 'Version 1 did not go live: %', v_result_v1;
  end if;

  v_release_id := (v_result_v1->>'releaseId')::uuid;
  v_version_v1 := (v_result_v1->>'versionId')::uuid;

  v_plan_v2 := jsonb_set(v_plan_v1, '{adapterVersion}', to_jsonb('versioned-identity-ci-v2'::text));
  v_plan_v2 := jsonb_set(
    v_plan_v2,
    '{source,storage,sha256}',
    to_jsonb(repeat('b', 64))
  );
  v_plan_v2 := jsonb_set(
    v_plan_v2,
    '{source,storage,objectPath}',
    to_jsonb(
      ('tcos/checklist/sourcePath/v1/ci/versioned-identities/bb/' ||
       repeat('b', 64) || '-versioned-identities-v2.json')::text
    )
  );
  v_plan_v2 := jsonb_set(
    v_plan_v2,
    '{source,storage,originalFilename}',
    to_jsonb('versioned-identities-v2.json'::text)
  );

  v_result_v2 := public.tcos_apply_checklist_import_plan(
    v_plan_v2,
    v_plan_v2 #>> '{source,storage,originalFilename}',
    v_plan_v2 #>> '{source,storage,mimeType}',
    (v_plan_v2 #>> '{source,storage,sizeBytes}')::bigint,
    v_plan_v2 #>> '{source,storage,sha256}',
    v_plan_v2 #>> '{source,storage,bucket}',
    v_plan_v2 #>> '{source,storage,objectPath}'
  );

  if v_result_v2->>'status' <> 'live' then
    raise exception 'Version 2 did not go live: %', v_result_v2;
  end if;

  v_version_v2 := (v_result_v2->>'versionId')::uuid;

  select count(*) into v_v1_count
  from public.checklist_card_identities
  where version_id = v_version_v1;

  select count(*) into v_v2_count
  from public.checklist_card_identities
  where version_id = v_version_v2;

  if v_v1_count <> v_expected or v_v2_count <> v_expected then
    raise exception 'Replacement versions are incomplete: v1 %, v2 %, expected %',
      v_v1_count, v_v2_count, v_expected;
  end if;

  select count(*) into v_duplicate_fingerprints
  from (
    select identity_schema, fingerprint_sha256
    from public.checklist_card_identities
    where version_id in (v_version_v1, v_version_v2)
    group by identity_schema, fingerprint_sha256
    having count(*) = 2
  ) repeated;

  if v_duplicate_fingerprints <> v_expected then
    raise exception 'Expected % preserved fingerprints in both versions, found %',
      v_expected, v_duplicate_fingerprints;
  end if;

  if not exists (
    select 1 from public.checklist_versions
    where id = v_version_v1 and status = 'superseded' and not is_active
  ) or not exists (
    select 1 from public.checklist_versions
    where id = v_version_v2 and status = 'live' and is_active
  ) then
    raise exception 'Checklist version activation history is incorrect';
  end if;

  -- Reproduce the Production defect without deleting cards or history, then
  -- prove the source-key repair restores every active-version identity.
  delete from public.checklist_card_identities
  where version_id = v_version_v2;

  v_repair := public.tcos_repair_active_checklist_identities(array[v_release_id]);

  if coalesce((v_repair->>'ok')::boolean, false) is not true
     or (v_repair->>'insertedIdentities')::integer <> v_expected
     or jsonb_array_length(v_repair->'unresolvedVersions') <> 0 then
    raise exception 'Active identity repair failed: %', v_repair;
  end if;

  select count(*) into v_v1_count
  from public.checklist_card_identities
  where version_id = v_version_v1;

  select count(*) into v_v2_count
  from public.checklist_card_identities
  where version_id = v_version_v2;

  if v_v1_count <> v_expected or v_v2_count <> v_expected then
    raise exception 'Repair did not preserve history and restore active rows: v1 %, v2 %',
      v_v1_count, v_v2_count;
  end if;

  v_repair_again := public.tcos_repair_active_checklist_identities(array[v_release_id]);
  if coalesce((v_repair_again->>'ok')::boolean, false) is not true
     or (v_repair_again->>'insertedIdentities')::integer <> 0 then
    raise exception 'Repair is not idempotent: %', v_repair_again;
  end if;

  select exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'checklist_card_identities'
      and indexname = 'checklist_card_identities_version_fingerprint_unique'
      and indexdef like '%version_id%identity_schema%fingerprint_sha256%'
  ) into v_index_exists;

  if not v_index_exists then
    raise exception 'Version-scoped checklist identity uniqueness is missing';
  end if;

  select pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  ) into v_writer_definition;

  if v_writer_definition ~* 'on conflict\s*\(identity_schema,\s*fingerprint_sha256\)\s*do nothing' then
    raise exception 'Transactional writer still silently skips cross-version identities';
  end if;

  raise notice '%', jsonb_build_object(
    'schema', 'tcos.checklist.versionedIdentityVerification.v1',
    'status', 'passed',
    'releaseId', v_release_id,
    'version1', v_version_v1,
    'version2', v_version_v2,
    'identitiesPerVersion', v_expected,
    'repair', v_repair,
    'idempotentRepair', v_repair_again
  );
end;
$$;
