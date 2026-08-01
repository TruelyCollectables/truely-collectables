-- Tighten the active-version identity repair to the physical printings that the
-- active card actually materializes.
--
-- Phase 1 Japanese versions had one Base identity for every card. Phase 2
-- versions can intentionally omit Base when the source only identifies Holo,
-- Reverse Holo, or another physical printing. The first versioned-identity
-- repair correctly restored historical membership, but it needed this
-- card-level printing gate to avoid copying an old Base identity onto a card
-- whose active source evidence does not contain Base.

create or replace function public.tcos_checklist_try_jsonb(p_value text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return '{}'::jsonb;
  end if;
  return p_value::jsonb;
exception when others then
  return '{}'::jsonb;
end;
$$;

revoke all on function public.tcos_checklist_try_jsonb(text)
  from public, anon, authenticated;
grant execute on function public.tcos_checklist_try_jsonb(text)
  to service_role;

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
  v_removed_invalid_identities bigint := 0;
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

  -- Remove only rows that were created by the repair and are contradicted by
  -- an explicit active materializedPhysicalPrintings array. Historical rows,
  -- imported rows, and cards without explicit printing evidence are untouched.
  delete from public.checklist_card_identities identity_row
  using public.checklist_cards active_card,
        public.checklist_versions active_version
  where identity_row.card_id = active_card.id
    and identity_row.version_id = active_version.id
    and active_version.is_active
    and (
      p_release_ids is null
      or cardinality(p_release_ids) = 0
      or active_version.release_id = any(p_release_ids)
    )
    and identity_row.metadata->>'repairedFromSupersededVersion' = 'true'
    and coalesce(
      jsonb_typeof(
        public.tcos_checklist_try_jsonb(active_card.checklist_notes)
          ->'materializedPhysicalPrintings'
      ),
      ''
    ) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements_text(
        public.tcos_checklist_try_jsonb(active_card.checklist_notes)
          ->'materializedPhysicalPrintings'
      ) printing(value)
      where printing.value = coalesce(
        (
          select active_parallel.name
          from public.checklist_parallels active_parallel
          where active_parallel.id = identity_row.parallel_id
        ),
        'Base'
      )
    );

  get diagnostics v_removed_invalid_identities = row_count;

  with active_cards as (
    select
      card.id as active_card_id,
      card.release_id,
      card.version_id,
      card.set_id,
      nullif(card.metadata->>'sourceKey', '') as source_key,
      public.tcos_checklist_try_jsonb(card.checklist_notes) as source_notes
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
      and (
        coalesce(
          jsonb_typeof(active_card.source_notes->'materializedPhysicalPrintings'),
          ''
        ) <> 'array'
        or exists (
          select 1
          from jsonb_array_elements_text(
            active_card.source_notes->'materializedPhysicalPrintings'
          ) printing(value)
          where printing.value = coalesce(active_parallel.name, 'Base')
        )
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
    'schema', 'tcos.checklist.activeIdentityRepair.v2',
    'activeVersions', v_active_versions,
    'expectedIdentities', v_expected_identities,
    'beforeIdentities', v_before_identities,
    'removedInvalidIdentities', v_removed_invalid_identities,
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
