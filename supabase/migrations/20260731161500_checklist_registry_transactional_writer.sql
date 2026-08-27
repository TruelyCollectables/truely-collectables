-- Transactional writer for validated Checklist Registry import plans.
-- The original source file is archived privately by the application before this
-- RPC is called. All normalized facts and exact identities commit atomically.

create or replace function public.tcos_checklist_slug(p_value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_value, ''))), '&', ' and ', 'g'),
      '[^[:alnum:]]+',
      '-',
      'g'
    ),
    ''
  );
$$;

create or replace function public.tcos_checklist_normalized_name(p_value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_value, ''))), '&', ' and ', 'g'),
      '[^[:alnum:]/]+',
      ' ',
      'g'
    ),
    ''
  );
$$;

create or replace function public.tcos_apply_checklist_import_plan(
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
as $$
declare
  v_release jsonb := coalesce(p_plan->'release', '{}'::jsonb);
  v_source jsonb := coalesce(p_plan->'source', '{}'::jsonb);
  v_validation jsonb := coalesce(p_plan->'validation', '{}'::jsonb);
  v_manufacturer_id uuid;
  v_brand_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_release_id uuid;
  v_release_source_id uuid;
  v_source_file_id uuid;
  v_previous_version_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_import_run_id uuid;
  v_set_map jsonb := '{}'::jsonb;
  v_card_map jsonb := '{}'::jsonb;
  v_parallel_map jsonb := '{}'::jsonb;
  v_set jsonb;
  v_card jsonb;
  v_parallel jsonb;
  v_identity jsonb;
  v_issue jsonb;
  v_player_value jsonb;
  v_team_value jsonb;
  v_set_id uuid;
  v_card_id uuid;
  v_parallel_id uuid;
  v_player_id uuid;
  v_team_id uuid;
  v_player_order integer;
  v_team_order integer;
  v_set_count integer := 0;
  v_card_count integer := 0;
  v_parallel_count integer := 0;
  v_identity_count integer := 0;
  v_error_count integer := 0;
  v_release_slug text;
  v_manufacturer_slug text;
  v_sport_slug text;
  v_league_slug text;
  v_brand_slug text;
  v_normalized_name text;
  v_status text;
begin
  if p_plan->>'schema' <> 'tcos.checklist.importPlan.v1' then
    raise exception 'Unsupported Checklist Registry import-plan schema';
  end if;

  if v_validation->>'status' <> 'passed' then
    raise exception 'Checklist import plan requires validation before persistence';
  end if;

  if coalesce((v_source->>'privateArchiveRequired')::boolean, false) is not true then
    raise exception 'Checklist source must require private archival';
  end if;

  if coalesce((v_source->>'normalizedFactsInternalOnly')::boolean, false) is not true then
    raise exception 'Checklist normalized facts must remain internal';
  end if;

  if p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Checklist source SHA-256 is invalid';
  end if;

  if p_size_bytes < 0 or p_size_bytes > 52428800 then
    raise exception 'Checklist source file exceeds the 50 MiB Registry limit';
  end if;

  v_release_slug := public.tcos_checklist_slug(v_release->>'releaseSlug');
  v_manufacturer_slug := public.tcos_checklist_slug(v_release->>'manufacturer');
  v_sport_slug := public.tcos_checklist_slug(v_release->>'sport');
  v_league_slug := public.tcos_checklist_slug(v_release->>'league');
  v_brand_slug := public.tcos_checklist_slug(v_release->>'brand');

  if v_release_slug is null or v_manufacturer_slug is null or v_sport_slug is null then
    raise exception 'Checklist release manufacturer, sport, and release slug are required';
  end if;

  select id into v_manufacturer_id
  from public.checklist_manufacturers
  where slug = v_manufacturer_slug;

  if v_manufacturer_id is null then
    insert into public.checklist_manufacturers(name, slug)
    values (v_release->>'manufacturer', v_manufacturer_slug)
    returning id into v_manufacturer_id;
  end if;

  select id into v_sport_id
  from public.checklist_sports
  where slug = v_sport_slug;

  if v_sport_id is null then
    insert into public.checklist_sports(name, slug)
    values (v_release->>'sport', v_sport_slug)
    returning id into v_sport_id;
  end if;

  if v_brand_slug is not null then
    select id into v_brand_id
    from public.checklist_brands
    where manufacturer_id = v_manufacturer_id and slug = v_brand_slug;

    if v_brand_id is null then
      insert into public.checklist_brands(manufacturer_id, name, slug)
      values (v_manufacturer_id, v_release->>'brand', v_brand_slug)
      returning id into v_brand_id;
    end if;
  end if;

  if v_league_slug is not null then
    select id into v_league_id
    from public.checklist_leagues
    where sport_id = v_sport_id and slug = v_league_slug;

    if v_league_id is null then
      insert into public.checklist_leagues(sport_id, name, slug)
      values (v_sport_id, v_release->>'league', v_league_slug)
      returning id into v_league_id;
    end if;
  end if;

  select id into v_release_id
  from public.checklist_releases
  where manufacturer_id = v_manufacturer_id
    and brand_id is not distinct from v_brand_id
    and sport_id = v_sport_id
    and league_id is not distinct from v_league_id
    and slug = v_release_slug
    and coalesce(release_year, '') = coalesce(v_release->>'releaseYear', '')
    and coalesce(season, '') = coalesce(v_release->>'season', '')
  limit 1;

  if v_release_id is null then
    insert into public.checklist_releases(
      manufacturer_id,
      brand_id,
      sport_id,
      league_id,
      product_name,
      slug,
      release_year,
      season,
      official_checklist_url,
      release_status,
      checklist_status,
      import_status,
      last_checked_at,
      metadata
    ) values (
      v_manufacturer_id,
      v_brand_id,
      v_sport_id,
      v_league_id,
      v_release->>'product',
      v_release_slug,
      nullif(v_release->>'releaseYear', ''),
      nullif(v_release->>'season', ''),
      nullif(v_source->>'sourceUrl', ''),
      'released',
      'detected',
      'importing',
      now(),
      jsonb_build_object(
        'latestAdapterId', p_plan->>'adapterId',
        'latestAdapterVersion', p_plan->>'adapterVersion'
      )
    ) returning id into v_release_id;
  else
    update public.checklist_releases
    set product_name = coalesce(nullif(v_release->>'product',''), product_name),
        official_checklist_url = coalesce(nullif(v_source->>'sourceUrl',''), official_checklist_url),
        checklist_status = 'detected',
        import_status = 'importing',
        last_checked_at = now(),
        metadata = metadata || jsonb_build_object(
          'latestAdapterId', p_plan->>'adapterId',
          'latestAdapterVersion', p_plan->>'adapterVersion'
        )
    where id = v_release_id;
  end if;

  insert into public.checklist_release_sources(
    release_id,
    source_type,
    source_url,
    authoritative,
    access_status,
    last_checked_at,
    last_successful_at,
    metadata
  ) values (
    v_release_id,
    'checklist_file',
    v_source->>'sourceUrl',
    (v_source->>'authority') in ('official_manufacturer','manual_official_file'),
    'available',
    now(),
    now(),
    jsonb_build_object(
      'authority', v_source->>'authority',
      'redistributionAllowed', coalesce((v_source->>'redistributionAllowed')::boolean,false)
    )
  )
  on conflict (release_id, source_type, source_url) do update
  set authoritative = excluded.authoritative,
      access_status = 'available',
      last_checked_at = now(),
      last_successful_at = now(),
      metadata = excluded.metadata
  returning id into v_release_source_id;

  select id into v_source_file_id
  from public.checklist_source_files
  where release_id = v_release_id and sha256 = p_sha256;

  if v_source_file_id is null then
    insert into public.checklist_source_files(
      release_id,
      release_source_id,
      source_file_type,
      source_url,
      original_filename,
      storage_bucket,
      storage_object_path,
      mime_type,
      size_bytes,
      sha256,
      retrieved_at,
      importer_version,
      import_status,
      validation_status,
      metadata
    ) values (
      v_release_id,
      v_release_source_id,
      'checklist',
      v_source->>'sourceUrl',
      p_original_filename,
      p_storage_bucket,
      p_storage_object_path,
      p_mime_type,
      p_size_bytes,
      p_sha256,
      coalesce(nullif(v_source->>'retrievedAt','')::timestamptz, now()),
      p_plan->>'adapterVersion',
      'importing',
      'passed',
      jsonb_build_object(
        'adapterId', p_plan->>'adapterId',
        'authority', v_source->>'authority',
        'privateArchiveRequired', true
      )
    ) returning id into v_source_file_id;
  end if;

  select id into v_version_id
  from public.checklist_versions
  where source_file_id = v_source_file_id
    and parser_version = p_plan->>'adapterVersion'
    and normalized_schema_version = 'tcos.checklist.normalized.v1';

  if v_version_id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'releaseId', v_release_id,
      'sourceFileId', v_source_file_id,
      'versionId', v_version_id
    );
  end if;

  select id into v_previous_version_id
  from public.checklist_versions
  where release_id = v_release_id and is_active
  limit 1;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from public.checklist_versions
  where release_id = v_release_id;

  insert into public.checklist_versions(
    release_id,
    source_file_id,
    previous_version_id,
    version_number,
    manufacturer_version_label,
    parser_version,
    normalized_schema_version,
    status,
    source_row_count,
    notes,
    metadata
  ) values (
    v_release_id,
    v_source_file_id,
    v_previous_version_id,
    v_version_number,
    null,
    p_plan->>'adapterVersion',
    'tcos.checklist.normalized.v1',
    'importing',
    coalesce(jsonb_array_length(p_plan->'cards'), 0),
    'Transactional Checklist Registry import',
    jsonb_build_object('adapterId', p_plan->>'adapterId')
  ) returning id into v_version_id;

  insert into public.checklist_import_runs(
    release_id,
    source_file_id,
    checklist_version_id,
    importer_name,
    importer_version,
    status,
    source_row_count,
    started_at,
    summary
  ) values (
    v_release_id,
    v_source_file_id,
    v_version_id,
    p_plan->>'adapterId',
    p_plan->>'adapterVersion',
    'running',
    coalesce(jsonb_array_length(p_plan->'cards'), 0),
    now(),
    jsonb_build_object('schema', p_plan->>'schema')
  ) returning id into v_import_run_id;

  for v_set in select value from jsonb_array_elements(coalesce(p_plan->'sets','[]'::jsonb))
  loop
    insert into public.checklist_sets(
      release_id,
      version_id,
      name,
      normalized_name,
      set_type,
      metadata
    ) values (
      v_release_id,
      v_version_id,
      v_set->>'name',
      coalesce(nullif(v_set->>'normalizedName',''), public.tcos_checklist_normalized_name(v_set->>'name')),
      coalesce(nullif(v_set->>'setType',''), 'other'),
      jsonb_build_object('sourceKey', v_set->>'sourceKey')
    ) returning id into v_set_id;

    v_set_map := v_set_map || jsonb_build_object(v_set->>'sourceKey', v_set_id::text);
    v_set_count := v_set_count + 1;
  end loop;

  for v_card in select value from jsonb_array_elements(coalesce(p_plan->'cards','[]'::jsonb))
  loop
    v_set_id := nullif(v_set_map->>(v_card->>'setSourceKey'), '')::uuid;
    if v_set_id is null then
      raise exception 'Checklist card references unknown set source key %', v_card->>'setSourceKey';
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
    ) values (
      v_release_id,
      v_version_id,
      v_set_id,
      v_card->>'cardNumber',
      regexp_replace(lower(v_card->>'cardNumber'), '[^[:alnum:]/]+', '', 'g'),
      case when v_card ? 'rookieDesignation' then (v_card->>'rookieDesignation')::boolean else null end,
      case when v_card ? 'firstBowmanDesignation' then (v_card->>'firstBowmanDesignation')::boolean else null end,
      coalesce(nullif(v_card->>'autographStatus',''), 'non-auto'),
      coalesce(nullif(v_card->>'memorabiliaStatus',''), 'non-memorabilia'),
      nullif(v_card->>'variation',''),
      public.tcos_checklist_normalized_name(v_card->>'variation'),
      nullif(v_card->>'sourceNotes',''),
      jsonb_build_object('sourceKey', v_card->>'sourceKey')
    ) returning id into v_card_id;

    v_card_map := v_card_map || jsonb_build_object(v_card->>'sourceKey', v_card_id::text);
    v_card_count := v_card_count + 1;

    v_player_order := 0;
    for v_player_value in select value from jsonb_array_elements(coalesce(v_card->'players','[]'::jsonb))
    loop
      v_player_order := v_player_order + 1;
      v_normalized_name := public.tcos_checklist_normalized_name(v_player_value #>> '{}');
      select id into v_player_id
      from public.checklist_players
      where normalized_name = v_normalized_name and birth_date is null
      limit 1;

      if v_player_id is null then
        begin
          insert into public.checklist_players(canonical_name, normalized_name)
          values (v_player_value #>> '{}', v_normalized_name)
          returning id into v_player_id;
        exception when unique_violation then
          select id into v_player_id
          from public.checklist_players
          where normalized_name = v_normalized_name and birth_date is null
          limit 1;
        end;
      end if;

      insert into public.checklist_card_players(card_id, player_id, display_order, role)
      values (v_card_id, v_player_id, v_player_order, 'subject')
      on conflict do nothing;
    end loop;

    v_team_order := 0;
    for v_team_value in select value from jsonb_array_elements(coalesce(v_card->'teams','[]'::jsonb))
    loop
      v_team_order := v_team_order + 1;
      v_normalized_name := public.tcos_checklist_normalized_name(v_team_value #>> '{}');
      select id into v_team_id
      from public.checklist_teams
      where sport_id = v_sport_id
        and league_id is not distinct from v_league_id
        and normalized_name = v_normalized_name
      limit 1;

      if v_team_id is null then
        begin
          insert into public.checklist_teams(
            sport_id, league_id, canonical_name, normalized_name
          ) values (
            v_sport_id, v_league_id, v_team_value #>> '{}', v_normalized_name
          ) returning id into v_team_id;
        exception when unique_violation then
          select id into v_team_id
          from public.checklist_teams
          where sport_id = v_sport_id
            and league_id is not distinct from v_league_id
            and normalized_name = v_normalized_name
          limit 1;
        end;
      end if;

      insert into public.checklist_card_teams(card_id, team_id, display_order, role)
      values (v_card_id, v_team_id, v_team_order, 'card_branding')
      on conflict do nothing;
    end loop;
  end loop;

  for v_parallel in select value from jsonb_array_elements(coalesce(p_plan->'parallels','[]'::jsonb))
  loop
    v_set_id := nullif(v_set_map->>(v_parallel->>'setSourceKey'), '')::uuid;
    if v_set_id is null then
      raise exception 'Checklist parallel references unknown set source key %', v_parallel->>'setSourceKey';
    end if;

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
    ) values (
      v_release_id,
      v_version_id,
      v_set_id,
      v_parallel->>'name',
      public.tcos_checklist_normalized_name(v_parallel->>'name'),
      nullif(v_parallel->>'serialRun','')::integer,
      nullif(v_parallel->>'configurationExclusivity',''),
      false,
      jsonb_build_object('sourceKey', v_parallel->>'sourceKey')
    ) returning id into v_parallel_id;

    v_parallel_map := v_parallel_map || jsonb_build_object(v_parallel->>'sourceKey', v_parallel_id::text);
    v_parallel_count := v_parallel_count + 1;
  end loop;

  for v_identity in select value from jsonb_array_elements(coalesce(p_plan->'identities','[]'::jsonb))
  loop
    v_card_id := nullif(v_card_map->>(v_identity->>'cardSourceKey'), '')::uuid;
    if v_card_id is null then
      raise exception 'Checklist identity references unknown card source key %', v_identity->>'cardSourceKey';
    end if;

    select set_id into v_set_id from public.checklist_cards where id = v_card_id;
    v_parallel_id := null;
    if nullif(v_identity->>'parallelSourceKey','') is not null then
      v_parallel_id := nullif(v_parallel_map->>(v_identity->>'parallelSourceKey'), '')::uuid;
      if v_parallel_id is null then
        raise exception 'Checklist identity references unknown parallel source key %', v_identity->>'parallelSourceKey';
      end if;
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
    ) values (
      v_release_id,
      v_version_id,
      v_set_id,
      v_card_id,
      v_parallel_id,
      coalesce(v_identity #>> '{fingerprint,schema}', 'tcos.checklist.identity.v1'),
      v_identity #>> '{fingerprint,canonicalKey}',
      v_identity #>> '{fingerprint,fingerprintSha256}',
      nullif(v_identity #>> '{fingerprint,normalized,serialRun}', ''),
      coalesce(nullif(v_identity #>> '{fingerprint,normalized,autographStatus}',''), 'non-auto'),
      coalesce(nullif(v_identity #>> '{fingerprint,normalized,memorabiliaStatus}',''), 'non-memorabilia'),
      nullif(v_identity #>> '{fingerprint,normalized,variation}', ''),
      nullif(v_identity #>> '{fingerprint,normalized,configurationExclusivity}', ''),
      jsonb_build_object(
        'players', coalesce(v_identity #> '{fingerprint,normalized,players}', '[]'::jsonb),
        'teams', coalesce(v_identity #> '{fingerprint,normalized,teams}', '[]'::jsonb),
        'parallel', v_identity #>> '{fingerprint,normalized,parallel}'
      )
    )
    on conflict (identity_schema, fingerprint_sha256) do nothing;

    v_identity_count := v_identity_count + 1;
  end loop;

  for v_issue in select value from jsonb_array_elements(coalesce(v_validation->'issues','[]'::jsonb))
  loop
    if v_issue->>'severity' = 'error' then
      v_error_count := v_error_count + 1;
    end if;

    insert into public.checklist_validation_queue(
      release_id,
      checklist_version_id,
      issue_type,
      severity,
      status,
      reason,
      evidence
    ) values (
      v_release_id,
      v_version_id,
      coalesce(nullif(v_issue->>'code',''), 'import_notice'),
      case when v_issue->>'severity' = 'error' then 'high' else 'low' end,
      case when v_issue->>'severity' = 'error' then 'open' else 'dismissed' end,
      v_issue->>'message',
      jsonb_build_object('rowReference', v_issue->>'rowReference')
    );
  end loop;

  if v_previous_version_id is not null then
    update public.checklist_versions
    set is_active = false, status = 'superseded'
    where id = v_previous_version_id;
  end if;

  v_status := case when v_error_count > 0 then 'validation_required' else 'live' end;

  update public.checklist_versions
  set status = v_status,
      normalized_card_count = v_card_count,
      normalized_identity_count = v_identity_count,
      imported_at = now(),
      validated_at = case when v_error_count = 0 then now() else null end,
      activated_at = case when v_error_count = 0 then now() else null end,
      is_active = v_error_count = 0
  where id = v_version_id;

  update public.checklist_source_files
  set importer_version = p_plan->>'adapterVersion',
      import_status = case when v_error_count = 0 then 'successful' else 'validation_required' end,
      validation_status = case when v_error_count = 0 then 'passed' else 'manual_review' end
  where id = v_source_file_id;

  update public.checklist_import_runs
  set status = case when v_error_count = 0 then 'successful' else 'validation_required' end,
      imported_row_count = v_card_count,
      skipped_row_count = 0,
      error_count = v_error_count,
      finished_at = now(),
      summary = jsonb_build_object(
        'sets', v_set_count,
        'cards', v_card_count,
        'parallels', v_parallel_count,
        'identities', v_identity_count,
        'validationIssues', coalesce(jsonb_array_length(v_validation->'issues'), 0)
      )
  where id = v_import_run_id;

  update public.checklist_releases
  set checklist_status = case when v_error_count = 0 then 'live' else 'manual_import_required' end,
      import_status = case when v_error_count = 0 then 'successful' else 'validation_required' end,
      last_successful_check_at = case when v_error_count = 0 then now() else last_successful_check_at end,
      last_checked_at = now()
  where id = v_release_id;

  insert into public.checklist_release_status_events(
    release_id,
    release_source_id,
    status_domain,
    previous_status,
    new_status,
    reason,
    source_snapshot
  ) values (
    v_release_id,
    v_release_source_id,
    'import',
    'importing',
    case when v_error_count = 0 then 'successful' else 'validation_required' end,
    'Transactional Checklist Registry import completed',
    jsonb_build_object('sourceFileId', v_source_file_id, 'versionId', v_version_id)
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'releaseId', v_release_id,
    'sourceFileId', v_source_file_id,
    'versionId', v_version_id,
    'importRunId', v_import_run_id,
    'status', case when v_error_count = 0 then 'live' else 'validation_required' end,
    'counts', jsonb_build_object(
      'sets', v_set_count,
      'cards', v_card_count,
      'parallels', v_parallel_count,
      'identities', v_identity_count,
      'errors', v_error_count
    )
  );
end;
$$;

revoke all on function public.tcos_apply_checklist_import_plan(
  jsonb,text,text,bigint,text,text,text
) from public, anon, authenticated;
grant execute on function public.tcos_apply_checklist_import_plan(
  jsonb,text,text,bigint,text,text,text
) to service_role;
