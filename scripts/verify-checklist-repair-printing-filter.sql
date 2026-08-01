\set ON_ERROR_STOP on

do $$
declare
  v_release_id uuid;
  v_active_version_id uuid;
  v_historical_version_id uuid;
  v_card_id uuid;
  v_materialized_printings jsonb;
  v_expected_before integer;
  v_expected_after integer;
  v_active_before integer;
  v_active_after integer;
  v_historical_count integer;
  v_repair jsonb;
  v_repair_again jsonb;
begin
  select release_id, id, normalized_identity_count
  into v_release_id, v_active_version_id, v_expected_before
  from public.checklist_versions
  where is_active and status = 'live'
  order by version_number desc
  limit 1;

  select id into v_historical_version_id
  from public.checklist_versions
  where release_id = v_release_id
    and id <> v_active_version_id
    and status = 'superseded'
  order by version_number desc
  limit 1;

  if v_release_id is null or v_historical_version_id is null then
    raise exception 'Versioned identity fixture was not created';
  end if;

  -- Choose one card that has both Base and named non-Base identities. The test
  -- will preserve every current named printing while explicitly omitting Base.
  select card.id into v_card_id
  from public.checklist_cards card
  where card.version_id = v_active_version_id
    and exists (
      select 1
      from public.checklist_card_identities base_identity
      where base_identity.version_id = v_active_version_id
        and base_identity.card_id = card.id
        and base_identity.parallel_id is null
    )
    and exists (
      select 1
      from public.checklist_card_identities parallel_identity
      where parallel_identity.version_id = v_active_version_id
        and parallel_identity.card_id = card.id
        and parallel_identity.parallel_id is not null
    )
  order by card.id
  limit 1;

  if v_card_id is null then
    raise exception 'No active card with Base and non-Base identities was available';
  end if;

  select coalesce(jsonb_agg(label order by label), '[]'::jsonb)
  into v_materialized_printings
  from (
    select distinct parallel.name as label
    from public.checklist_card_identities identity_row
    join public.checklist_parallels parallel
      on parallel.id = identity_row.parallel_id
    where identity_row.version_id = v_active_version_id
      and identity_row.card_id = v_card_id
      and identity_row.parallel_id is not null
  ) labels;

  if jsonb_array_length(v_materialized_printings) = 0 then
    raise exception 'The selected card has no named physical printings';
  end if;

  select count(*) into v_active_before
  from public.checklist_card_identities
  where version_id = v_active_version_id;

  if v_active_before <> v_expected_before then
    raise exception 'Active fixture starts incomplete: actual %, expected %',
      v_active_before, v_expected_before;
  end if;

  -- The active source keeps every named printing but does not materialize Base.
  -- Only the repair-created Phase 1 Base membership should be removed.
  update public.checklist_cards
  set checklist_notes = jsonb_build_object(
    'materializedPhysicalPrintings', v_materialized_printings
  )::text
  where id = v_card_id;

  v_expected_after := v_expected_before - 1;
  update public.checklist_versions
  set normalized_identity_count = v_expected_after
  where id = v_active_version_id;

  v_repair := public.tcos_repair_active_checklist_identities(array[v_release_id]);

  if coalesce((v_repair->>'ok')::boolean, false) is not true
     or (v_repair->>'removedInvalidIdentities')::integer <> 1
     or (v_repair->>'insertedIdentities')::integer <> 0
     or jsonb_array_length(v_repair->'unresolvedVersions') <> 0 then
    raise exception 'Printing-aware cleanup failed: %', v_repair;
  end if;

  select count(*) into v_active_after
  from public.checklist_card_identities
  where version_id = v_active_version_id;

  select count(*) into v_historical_count
  from public.checklist_card_identities
  where version_id = v_historical_version_id;

  if v_active_after <> v_expected_after then
    raise exception 'Active printing-aware population is wrong: actual %, expected %',
      v_active_after, v_expected_after;
  end if;

  if v_historical_count <> v_expected_before then
    raise exception 'Historical identity membership changed: actual %, expected %',
      v_historical_count, v_expected_before;
  end if;

  if exists (
    select 1
    from public.checklist_card_identities
    where version_id = v_active_version_id
      and card_id = v_card_id
      and parallel_id is null
  ) then
    raise exception 'The invalid repair-created Base identity remains active';
  end if;

  if (
    select count(*)
    from public.checklist_card_identities identity_row
    join public.checklist_parallels parallel
      on parallel.id = identity_row.parallel_id
    where identity_row.version_id = v_active_version_id
      and identity_row.card_id = v_card_id
      and parallel.name in (
        select value
        from jsonb_array_elements_text(v_materialized_printings) printing(value)
      )
  ) <> jsonb_array_length(v_materialized_printings) then
    raise exception 'A valid named printing was removed from the active card';
  end if;

  v_repair_again := public.tcos_repair_active_checklist_identities(array[v_release_id]);
  if coalesce((v_repair_again->>'ok')::boolean, false) is not true
     or (v_repair_again->>'removedInvalidIdentities')::integer <> 0
     or (v_repair_again->>'insertedIdentities')::integer <> 0 then
    raise exception 'Printing-aware repair is not idempotent: %', v_repair_again;
  end if;

  raise notice '%', jsonb_build_object(
    'schema', 'tcos.checklist.repairPrintingFilterVerification.v1',
    'status', 'passed',
    'releaseId', v_release_id,
    'activeVersionId', v_active_version_id,
    'historicalVersionId', v_historical_version_id,
    'materializedPrintings', v_materialized_printings,
    'removedInvalidIdentities', v_repair->'removedInvalidIdentities',
    'activeIdentities', v_active_after,
    'historicalIdentities', v_historical_count,
    'idempotentRepair', v_repair_again
  );
end;
$$;
