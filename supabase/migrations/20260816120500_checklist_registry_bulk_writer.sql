-- Bulk transactional writer for large validated Checklist Registry import plans.
-- It reuses the proven transactional writer to create/reuse release/source/version
-- scaffolding inside the same transaction, then loads normalized facts with set-
-- based SQL. If any bulk insert or validation fails, the entire outer transaction
-- rolls back and the previously active checklist version remains untouched.

create or replace function public.tcos_apply_checklist_import_plan_bulk(
  p_plan jsonb,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_storage_bucket text,
  p_storage_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '55s'
set lock_timeout = '30s'
as $$
declare
  v_scaffold_plan jsonb;
  v_scaffold jsonb;
  v_release_id uuid;
  v_source_file_id uuid;
  v_version_id uuid;
  v_import_run_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_expected_sets integer := coalesce(jsonb_array_length(coalesce(p_plan->'sets', '[]'::jsonb)), 0);
  v_expected_cards integer := coalesce(jsonb_array_length(coalesce(p_plan->'cards', '[]'::jsonb)), 0);
  v_expected_parallels integer := coalesce(jsonb_array_length(coalesce(p_plan->'parallels', '[]'::jsonb)), 0);
  v_expected_identities integer := coalesce(jsonb_array_length(coalesce(p_plan->'identities', '[]'::jsonb)), 0);
  v_set_count integer := 0;
  v_card_count integer := 0;
  v_parallel_count integer := 0;
  v_resolved_identity_count integer := 0;
  v_existing_card_count integer := 0;
begin
  -- The established writer performs every schema/archive/validation guard and
  -- creates the release/source/version/import-run rows. Empty fact arrays make
  -- that setup cheap; because this call is nested, its changes are still part of
  -- this function's single transaction and roll back if the bulk phase fails.
  v_scaffold_plan := p_plan
    || jsonb_build_object(
      'sets', '[]'::jsonb,
      'cards', '[]'::jsonb,
      'parallels', '[]'::jsonb,
      'identities', '[]'::jsonb
    )
    || jsonb_build_object(
      'validation',
      coalesce(p_plan->'validation', '{}'::jsonb)
        || jsonb_build_object(
          'counts',
          jsonb_build_object('sets', 0, 'cards', 0, 'parallels', 0, 'identities', 0)
        )
    );

  v_scaffold := public.tcos_apply_checklist_import_plan(
    v_scaffold_plan,
    p_original_filename,
    p_mime_type,
    p_size_bytes,
    p_sha256,
    p_storage_bucket,
    p_storage_object_path
  );

  if coalesce((v_scaffold->>'ok')::boolean, false) is not true then
    raise exception 'Checklist Registry scaffold writer did not return ok=true';
  end if;

  v_release_id := nullif(v_scaffold->>'releaseId', '')::uuid;
  v_source_file_id := nullif(v_scaffold->>'sourceFileId', '')::uuid;
  v_version_id := nullif(v_scaffold->>'versionId', '')::uuid;
  v_import_run_id := nullif(v_scaffold->>'importRunId', '')::uuid;

  if v_release_id is null or v_source_file_id is null or v_version_id is null then
    raise exception 'Checklist Registry scaffold did not return required identifiers';
  end if;

  -- A completed prior bulk import is a valid idempotent success. An incomplete
  -- version with the same parser key is fail-closed rather than silently reused.
  if coalesce((v_scaffold->>'idempotent')::boolean, false) then
    select count(*)::integer into v_existing_card_count
    from public.checklist_cards
    where version_id = v_version_id;

    if v_existing_card_count <> v_expected_cards then
      raise exception 'Idempotent Checklist Registry version is incomplete: expected % cards, found %',
        v_expected_cards, v_existing_card_count;
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'bulk', true,
      'releaseId', v_release_id,
      'sourceFileId', v_source_file_id,
      'versionId', v_version_id,
      'importRunId', v_import_run_id,
      'status', 'live',
      'counts', jsonb_build_object(
        'sets', v_expected_sets,
        'cards', v_expected_cards,
        'parallels', v_expected_parallels,
        'identities', v_expected_identities,
        'errors', 0
      )
    );
  end if;

  select sport_id, league_id into v_sport_id, v_league_id
  from public.checklist_releases
  where id = v_release_id;

  insert into public.checklist_sets(
    release_id,
    version_id,
    name,
    normalized_name,
    set_type,
    metadata
  )
  select
    v_release_id,
    v_version_id,
    s.value->>'name',
    coalesce(
      nullif(s.value->>'normalizedName', ''),
      public.tcos_checklist_normalized_name(s.value->>'name')
    ),
    coalesce(nullif(s.value->>'setType', ''), 'other'),
    jsonb_build_object('sourceKey', s.value->>'sourceKey')
  from jsonb_array_elements(coalesce(p_plan->'sets', '[]'::jsonb)) as s(value);
  get diagnostics v_set_count = row_count;

  if v_set_count <> v_expected_sets then
    raise exception 'Checklist Registry bulk set count mismatch: expected %, inserted %',
      v_expected_sets, v_set_count;
  end if;

  insert into public.checklist_cards(
    release_id,
    version_id,
    set_id,
    card_number,
    normalized_card_number,
    rookie_designation,
    first_bowman_designation,
    autograph_status,
    memorabilia_status,
    variation,
    normalized_variation,
    checklist_notes,
    metadata
  )
  select
    v_release_id,
    v_version_id,
    s.id,
    c.value->>'cardNumber',
    regexp_replace(lower(c.value->>'cardNumber'), '[^[:alnum:]/]+', '', 'g'),
    case when c.value ? 'rookieDesignation' then (c.value->>'rookieDesignation')::boolean else null end,
    case when c.value ? 'firstBowmanDesignation' then (c.value->>'firstBowmanDesignation')::boolean else null end,
    coalesce(nullif(c.value->>'autographStatus', ''), 'non-auto'),
    coalesce(nullif(c.value->>'memorabiliaStatus', ''), 'non-memorabilia'),
    nullif(c.value->>'variation', ''),
    public.tcos_checklist_normalized_name(c.value->>'variation'),
    nullif(c.value->>'sourceNotes', ''),
    jsonb_build_object('sourceKey', c.value->>'sourceKey')
  from jsonb_array_elements(coalesce(p_plan->'cards', '[]'::jsonb)) as c(value)
  join public.checklist_sets s
    on s.version_id = v_version_id
   and s.metadata->>'sourceKey' = c.value->>'setSourceKey';
  get diagnostics v_card_count = row_count;

  if v_card_count <> v_expected_cards then
    raise exception 'Checklist Registry bulk card count mismatch: expected %, inserted %',
      v_expected_cards, v_card_count;
  end if;

  -- Canonical player dictionary first, then ordered card-player links.
  insert into public.checklist_players(canonical_name, normalized_name)
  select distinct on (x.normalized_name)
    x.canonical_name,
    x.normalized_name
  from (
    select
      p.player_name as canonical_name,
      public.tcos_checklist_normalized_name(p.player_name) as normalized_name
    from jsonb_array_elements(coalesce(p_plan->'cards', '[]'::jsonb)) as c(value)
    cross join lateral jsonb_array_elements_text(coalesce(c.value->'players', '[]'::jsonb)) as p(player_name)
  ) x
  where x.normalized_name is not null
  order by x.normalized_name, x.canonical_name
  on conflict do nothing;

  insert into public.checklist_card_players(card_id, player_id, display_order, role)
  select
    card.id,
    player.id,
    p.ordinality::integer,
    'subject'
  from jsonb_array_elements(coalesce(p_plan->'cards', '[]'::jsonb)) as c(value)
  join public.checklist_cards card
    on card.version_id = v_version_id
   and card.metadata->>'sourceKey' = c.value->>'sourceKey'
  cross join lateral jsonb_array_elements_text(coalesce(c.value->'players', '[]'::jsonb))
    with ordinality as p(player_name, ordinality)
  join lateral (
    select cp.id
    from public.checklist_players cp
    where cp.normalized_name = public.tcos_checklist_normalized_name(p.player_name)
      and cp.birth_date is null
    limit 1
  ) player on true
  on conflict do nothing;

  -- Canonical team dictionary first, then ordered card-team links.
  insert into public.checklist_teams(
    sport_id,
    league_id,
    canonical_name,
    normalized_name
  )
  select distinct on (x.normalized_name)
    v_sport_id,
    v_league_id,
    x.canonical_name,
    x.normalized_name
  from (
    select
      t.team_name as canonical_name,
      public.tcos_checklist_normalized_name(t.team_name) as normalized_name
    from jsonb_array_elements(coalesce(p_plan->'cards', '[]'::jsonb)) as c(value)
    cross join lateral jsonb_array_elements_text(coalesce(c.value->'teams', '[]'::jsonb)) as t(team_name)
  ) x
  where x.normalized_name is not null
  order by x.normalized_name, x.canonical_name
  on conflict do nothing;

  insert into public.checklist_card_teams(card_id, team_id, display_order, role)
  select
    card.id,
    team.id,
    t.ordinality::integer,
    'card_branding'
  from jsonb_array_elements(coalesce(p_plan->'cards', '[]'::jsonb)) as c(value)
  join public.checklist_cards card
    on card.version_id = v_version_id
   and card.metadata->>'sourceKey' = c.value->>'sourceKey'
  cross join lateral jsonb_array_elements_text(coalesce(c.value->'teams', '[]'::jsonb))
    with ordinality as t(team_name, ordinality)
  join lateral (
    select ct.id
    from public.checklist_teams ct
    where ct.sport_id = v_sport_id
      and ct.league_id is not distinct from v_league_id
      and ct.normalized_name = public.tcos_checklist_normalized_name(t.team_name)
    limit 1
  ) team on true
  on conflict do nothing;

  insert into public.checklist_parallels(
    release_id,
    version_id,
    set_id,
    name,
    normalized_name,
    serial_run,
    configuration_exclusivity,
    is_base,
    metadata
  )
  select
    v_release_id,
    v_version_id,
    s.id,
    p.value->>'name',
    public.tcos_checklist_normalized_name(p.value->>'name'),
    nullif(p.value->>'serialRun', '')::integer,
    nullif(p.value->>'configurationExclusivity', ''),
    false,
    jsonb_build_object('sourceKey', p.value->>'sourceKey')
  from jsonb_array_elements(coalesce(p_plan->'parallels', '[]'::jsonb)) as p(value)
  join public.checklist_sets s
    on s.version_id = v_version_id
   and s.metadata->>'sourceKey' = p.value->>'setSourceKey';
  get diagnostics v_parallel_count = row_count;

  if v_parallel_count <> v_expected_parallels then
    raise exception 'Checklist Registry bulk parallel count mismatch: expected %, inserted %',
      v_expected_parallels, v_parallel_count;
  end if;

  -- Resolve every identity reference before insertion. Conflicting global identity
  -- fingerprints are intentionally ignored exactly as in the established writer.
  select count(*)::integer into v_resolved_identity_count
  from jsonb_array_elements(coalesce(p_plan->'identities', '[]'::jsonb)) as i(value)
  join public.checklist_cards card
    on card.version_id = v_version_id
   and card.metadata->>'sourceKey' = i.value->>'cardSourceKey'
  left join public.checklist_parallels parallel
    on parallel.version_id = v_version_id
   and parallel.metadata->>'sourceKey' = nullif(i.value->>'parallelSourceKey', '')
  where nullif(i.value->>'parallelSourceKey', '') is null
     or parallel.id is not null;

  if v_resolved_identity_count <> v_expected_identities then
    raise exception 'Checklist Registry bulk identity-reference mismatch: expected %, resolved %',
      v_expected_identities, v_resolved_identity_count;
  end if;

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
    v_release_id,
    v_version_id,
    card.set_id,
    card.id,
    parallel.id,
    coalesce(i.value #>> '{fingerprint,schema}', 'tcos.checklist.identity.v1'),
    i.value #>> '{fingerprint,canonicalKey}',
    i.value #>> '{fingerprint,fingerprintSha256}',
    nullif(i.value #>> '{fingerprint,normalized,serialRun}', ''),
    coalesce(nullif(i.value #>> '{fingerprint,normalized,autographStatus}', ''), 'non-auto'),
    coalesce(nullif(i.value #>> '{fingerprint,normalized,memorabiliaStatus}', ''), 'non-memorabilia'),
    nullif(i.value #>> '{fingerprint,normalized,variation}', ''),
    nullif(i.value #>> '{fingerprint,normalized,configurationExclusivity}', ''),
    jsonb_build_object(
      'players', coalesce(i.value #> '{fingerprint,normalized,players}', '[]'::jsonb),
      'teams', coalesce(i.value #> '{fingerprint,normalized,teams}', '[]'::jsonb),
      'parallel', i.value #>> '{fingerprint,normalized,parallel}'
    )
  from jsonb_array_elements(coalesce(p_plan->'identities', '[]'::jsonb)) as i(value)
  join public.checklist_cards card
    on card.version_id = v_version_id
   and card.metadata->>'sourceKey' = i.value->>'cardSourceKey'
  left join public.checklist_parallels parallel
    on parallel.version_id = v_version_id
   and parallel.metadata->>'sourceKey' = nullif(i.value->>'parallelSourceKey', '')
  where nullif(i.value->>'parallelSourceKey', '') is null
     or parallel.id is not null
  on conflict (identity_schema, fingerprint_sha256) do nothing;

  update public.checklist_versions
  set source_row_count = v_expected_cards,
      normalized_card_count = v_expected_cards,
      normalized_identity_count = v_expected_identities,
      status = 'live',
      validated_at = coalesce(validated_at, now()),
      activated_at = coalesce(activated_at, now()),
      is_active = true,
      notes = 'Bulk transactional Checklist Registry import',
      metadata = metadata || jsonb_build_object('bulkWriter', true)
  where id = v_version_id;

  if v_import_run_id is not null then
    update public.checklist_import_runs
    set source_row_count = v_expected_cards,
        imported_row_count = v_expected_cards,
        skipped_row_count = 0,
        error_count = 0,
        status = 'successful',
        finished_at = now(),
        summary = jsonb_build_object(
          'sets', v_expected_sets,
          'cards', v_expected_cards,
          'parallels', v_expected_parallels,
          'identities', v_expected_identities,
          'validationIssues', coalesce(jsonb_array_length(coalesce(p_plan #> '{validation,issues}', '[]'::jsonb)), 0),
          'bulkWriter', true
        )
    where id = v_import_run_id;
  end if;

  update public.checklist_source_files
  set importer_version = p_plan->>'adapterVersion',
      import_status = 'successful',
      validation_status = 'passed',
      metadata = metadata || jsonb_build_object('bulkWriter', true)
  where id = v_source_file_id;

  update public.checklist_releases
  set checklist_status = 'live',
      import_status = 'successful',
      last_successful_check_at = now(),
      last_checked_at = now(),
      metadata = metadata || jsonb_build_object('latestBulkWriter', true)
  where id = v_release_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'bulk', true,
    'releaseId', v_release_id,
    'sourceFileId', v_source_file_id,
    'versionId', v_version_id,
    'importRunId', v_import_run_id,
    'status', 'live',
    'counts', jsonb_build_object(
      'sets', v_expected_sets,
      'cards', v_expected_cards,
      'parallels', v_expected_parallels,
      'identities', v_expected_identities,
      'errors', 0
    )
  );
end;
$$;

revoke all on function public.tcos_apply_checklist_import_plan_bulk(
  jsonb,text,text,bigint,text,text,text
) from public, anon, authenticated;
grant execute on function public.tcos_apply_checklist_import_plan_bulk(
  jsonb,text,text,bigint,text,text,text
) to service_role;
