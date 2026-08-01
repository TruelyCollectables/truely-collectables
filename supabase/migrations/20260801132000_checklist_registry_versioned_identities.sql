-- Checklist identities belong to a normalized checklist version.
--
-- The original Registry constraint made fingerprint_sha256 globally unique.
-- A replacement version therefore inserted its new identities but silently
-- skipped every preserved identity that already existed in a superseded
-- version. The writer still incremented its planned identity counter and could
-- mark that incomplete active version live.
--
-- This migration:
--   1. scopes exact-identity uniqueness to a checklist version;
--   2. removes the writer's silent cross-version ON CONFLICT skip;
--   3. provides an idempotent service-role repair for active versions; and
--   4. preserves a global fingerprint lookup index for InstaComp searches.

alter table public.checklist_card_identities
  drop constraint if exists checklist_card_identities_identity_schema_fingerprint_sha256_key;

drop index if exists public.checklist_card_identities_identity_schema_fingerprint_sha256_key;

create unique index if not exists checklist_card_identities_version_fingerprint_unique
  on public.checklist_card_identities(
    version_id,
    identity_schema,
    fingerprint_sha256
  );

create index if not exists checklist_card_identities_fingerprint_lookup_idx
  on public.checklist_card_identities(identity_schema, fingerprint_sha256);

-- Keep the transactional writer as the single atomic persistence path, but do
-- not silently discard an identity inside a newly created version. The dynamic
-- replacement is intentionally narrow so this additive migration remains
-- compatible with the exact writer revision already deployed to Production.
do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  ) into v_definition;

  if v_definition ~* 'on conflict\s*\(identity_schema,\s*fingerprint_sha256\)\s*do nothing' then
    v_patched := regexp_replace(
      v_definition,
      E'\\s+on conflict\\s*\\(identity_schema,\\s*fingerprint_sha256\\)\\s*do nothing;',
      ';',
      'i'
    );

    if v_patched = v_definition then
      raise exception 'Could not patch Checklist Registry identity conflict handling';
    end if;

    execute v_patched;
  end if;

  select pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  ) into v_definition;

  if v_definition ~* 'on conflict\s*\(identity_schema,\s*fingerprint_sha256\)\s*do nothing' then
    raise exception 'Checklist Registry writer still silently skips cross-version identities';
  end if;
end;
$migration$;

create or replace function public.tcos_repair_active_checklist_identities(
  p_release_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_versions integer := 0;
  v_expected_identities bigint := 0;
  v_before_identities bigint := 0;
  v_inserted_identities bigint := 0;
  v_after_identities bigint := 0;
  v_unresolved_versions jsonb := '[]'::jsonb;
begin
  select
    count(*),
    coalesce(sum(version_row.normalized_identity_count), 0)
  into v_active_versions, v_expected_identities
  from public.checklist_versions version_row
  where version_row.is_active
    and (
      p_release_ids is null
      or cardinality(p_release_ids) = 0
      or version_row.release_id = any(p_release_ids)
    );

  select count(*)
  into v_before_identities
  from public.checklist_card_identities identity_row
  join public.checklist_versions version_row
    on version_row.id = identity_row.version_id
   and version_row.is_active
  where p_release_ids is null
     or cardinality(p_release_ids) = 0
     or version_row.release_id = any(p_release_ids);

  with active_cards as (
    select
      card.id as active_card_id,
      card.release_id,
      card.version_id,
      card.set_id,
      nullif(card.metadata->>'sourceKey', '') as source_key
    from public.checklist_cards card
    join public.checklist_versions version_row
      on version_row.id = card.version_id
     and version_row.is_active
    where p_release_ids is null
       or cardinality(p_release_ids) = 0
       or card.release_id = any(p_release_ids)
  ),
  historical_candidates as (
    select
      active_card.release_id,
      active_card.version_id,
      active_card.set_id,
      active_card.active_card_id as card_id,
      case
        when historical_identity.parallel_id is null then null
        else active_parallel.id
      end as parallel_id,
      historical_identity.identity_schema,
      historical_identity.canonical_key,
      historical_identity.fingerprint_sha256,
      historical_identity.serial_number_tier,
      historical_identity.autograph_status,
      historical_identity.memorabilia_status,
      historical_identity.variation,
      historical_identity.configuration_exclusivity,
      historical_identity.metadata,
      historical_version.version_number,
      historical_identity.created_at,
      row_number() over (
        partition by
          active_card.version_id,
          historical_identity.identity_schema,
          historical_identity.fingerprint_sha256
        order by
          historical_version.version_number desc,
          historical_identity.created_at desc,
          historical_identity.id
      ) as candidate_rank
    from active_cards active_card
    join public.checklist_cards historical_card
      on historical_card.release_id = active_card.release_id
     and historical_card.version_id <> active_card.version_id
     and nullif(historical_card.metadata->>'sourceKey', '') = active_card.source_key
    join public.checklist_versions historical_version
      on historical_version.id = historical_card.version_id
    join public.checklist_card_identities historical_identity
      on historical_identity.card_id = historical_card.id
    left join public.checklist_parallels historical_parallel
      on historical_parallel.id = historical_identity.parallel_id
    left join public.checklist_parallels active_parallel
      on active_parallel.version_id = active_card.version_id
     and nullif(active_parallel.metadata->>'sourceKey', '') =
         nullif(historical_parallel.metadata->>'sourceKey', '')
    where active_card.source_key is not null
      and (
        historical_identity.parallel_id is null
        or active_parallel.id is not null
      )
      and not exists (
        select 1
        from public.checklist_card_identities existing_identity
        where existing_identity.version_id = active_card.version_id
          and existing_identity.identity_schema = historical_identity.identity_schema
          and existing_identity.fingerprint_sha256 = historical_identity.fingerprint_sha256
      )
  )
  insert into public.checklist_card_identities(
    release_id,
    version_id,
    set_id,
    card_id,
    parallel_id,
    identity_schema,
    canonical_key,
    fingerprint_sha256,
    serial_number_tier,
    autograph_status,
    memorabilia_status,
    variation,
    configuration_exclusivity,
    metadata
  )
  select
    candidate.release_id,
    candidate.version_id,
    candidate.set_id,
    candidate.card_id,
    candidate.parallel_id,
    candidate.identity_schema,
    candidate.canonical_key,
    candidate.fingerprint_sha256,
    candidate.serial_number_tier,
    candidate.autograph_status,
    candidate.memorabilia_status,
    candidate.variation,
    candidate.configuration_exclusivity,
    candidate.metadata || jsonb_build_object(
      'repairedFromSupersededVersion', true,
      'repairedAt', now()
    )
  from historical_candidates candidate
  where candidate.candidate_rank = 1
  on conflict (version_id, identity_schema, fingerprint_sha256) do nothing;

  get diagnostics v_inserted_identities = row_count;

  select count(*)
  into v_after_identities
  from public.checklist_card_identities identity_row
  join public.checklist_versions version_row
    on version_row.id = identity_row.version_id
   and version_row.is_active
  where p_release_ids is null
     or cardinality(p_release_ids) = 0
     or version_row.release_id = any(p_release_ids);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'releaseId', deficit.release_id,
        'releaseName', deficit.product_name,
        'versionId', deficit.version_id,
        'versionNumber', deficit.version_number,
        'parserVersion', deficit.parser_version,
        'expectedIdentities', deficit.expected_identities,
        'actualIdentities', deficit.actual_identities,
        'missingIdentities', deficit.expected_identities - deficit.actual_identities
      )
      order by deficit.product_name, deficit.version_number
    ),
    '[]'::jsonb
  )
  into v_unresolved_versions
  from (
    select
      version_row.release_id,
      release_row.product_name,
      version_row.id as version_id,
      version_row.version_number,
      version_row.parser_version,
      version_row.normalized_identity_count as expected_identities,
      count(identity_row.id)::integer as actual_identities
    from public.checklist_versions version_row
    join public.checklist_releases release_row
      on release_row.id = version_row.release_id
    left join public.checklist_card_identities identity_row
      on identity_row.version_id = version_row.id
    where version_row.is_active
      and (
        p_release_ids is null
        or cardinality(p_release_ids) = 0
        or version_row.release_id = any(p_release_ids)
      )
    group by
      version_row.release_id,
      release_row.product_name,
      version_row.id,
      version_row.version_number,
      version_row.parser_version,
      version_row.normalized_identity_count
    having count(identity_row.id) <> version_row.normalized_identity_count
  ) deficit;

  return jsonb_build_object(
    'schema', 'tcos.checklist.activeIdentityRepair.v1',
    'activeVersions', v_active_versions,
    'expectedIdentities', v_expected_identities,
    'beforeIdentities', v_before_identities,
    'insertedIdentities', v_inserted_identities,
    'afterIdentities', v_after_identities,
    'unresolvedVersions', v_unresolved_versions,
    'ok', jsonb_array_length(v_unresolved_versions) = 0
  );
end;
$$;

revoke all on function public.tcos_repair_active_checklist_identities(uuid[])
  from public, anon, authenticated;
grant execute on function public.tcos_repair_active_checklist_identities(uuid[])
  to service_role;
