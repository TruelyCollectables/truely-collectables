-- Replace the row-by-row Checklist Registry persistence hot path with set-based
-- inserts while preserving validation, private-source archival, atomic version
-- activation, and service-role-only execution.
--
-- Also restore version-scoped identity uniqueness. A historical repair had
-- reintroduced global fingerprint uniqueness, which can silently suppress valid
-- identities in replacement checklist versions.

drop index if exists public.checklist_card_identities_schema_fingerprint_repair_unique;

create unique index if not exists checklist_card_identities_version_fingerprint_unique
  on public.checklist_card_identities(version_id, identity_schema, fingerprint_sha256);

create index if not exists checklist_card_identities_fingerprint_lookup_idx
  on public.checklist_card_identities(identity_schema, fingerprint_sha256);

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
set statement_timeout = '55s'
set lock_timeout = '30s'
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
      manufacturer_id, brand_id, sport_id, league_id, product_name, slug,
      release_year, season, official_checklist_url, release_status,
      checklist_status, import_status, last_checked_at, metadata
    ) values (
      v_manufacturer_id, v_brand_id, v_sport_id, v_league_id,
      v_release->>'product', v_release_slug,
      nullif(v_release->>'releaseYear', ''), nullif(v_release->>'season', ''),
      nullif(v_source->>'sourceUrl', ''), 'released', 'detected', 'importing', now(),
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
    release_id, source_type, source_url, authoritative, access_status,
    last_checked_at, last_successful_at, metadata
  ) values (
    v_release_id, 'checklist_file', v_source->>'sourceUrl',
    (v_source->>'authority') in ('official_manufacturer','manual_official_file'),
    'available', now(), now(),
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
      release_id, release_source_id, source_file_type, source_url, original_filename,
      storage_bucket, storage_object_path, mime_type, size_bytes, sha256, retrieved_at,
      importer_version, import_status, validation_status, metadata
    ) values (
      v_release_id, v_release_source_id, 'checklist', v_source->>'sourceUrl', p_original_filename,
      p_storage_bucket, p_storage_object_path, p_mime_type, p_size_bytes, p_sha256,
      coalesce(nullif(v_source->>'retrievedAt','')::timestamptz, now()), p_plan->>'adapterVersion',
      'importing', 'passed',
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
    release_id, source_file_id, previous_version_id, version_number, manufacturer_version_label,
    parser_version, normalized_schema_version, status, source_row_count, notes, metadata
  ) values (
    v_release_id, v_source_file_id, v_previous_version_id, v_version_number, null,
    p_plan->>'adapterVersion', 'tcos.checklist.normalized.v1', 'importing',
    coalesce(jsonb_array_length(p_plan->'cards'), 0),
    'Transactional Checklist Registry bulk import',
    jsonb_build_object('adapterId', p_plan->>'adapterId', 'writer', 'set_based_v1')
  ) returning id into v_version_id;

  insert into public.checklist_import_runs(
    release_id, source_file_id, checklist_version_id, importer_name, importer_version,
    status, source_row_count, started_at, summary
  ) values (
    v_release_id, v_source_file_id, v_version_id, p_plan->>'adapterId', p_plan->>'adapterVersion',
    'running', coalesce(jsonb_array_length(p_plan->'cards'), 0), now(),
    jsonb_build_object('schema', p_plan->>'schema', 'writer', 'set_based_v1')
  ) returning id into v_import_run_id;

  create temporary table tcos_import_sets(
    source_key text primary key,
    object_id uuid not null,
    name text not null,
    normalized_name text not null,
    set_type text not null
  ) on commit drop;

  insert into pg_temp.tcos_import_sets(source_key, object_id, name, normalized_name, set_type)
  select
    x.value->>'sourceKey',
    gen_random_uuid(),
    x.value->>'name',
    coalesce(
      nullif(x.value->>'normalizedName',''),
      public.tcos_checklist_normalized_name(x.value->>'name')
    ),
    coalesce(nullif(x.value->>'setType',''), 'other')
  from jsonb_array_elements(coalesce(p_plan->'sets','[]'::jsonb)) x(value);
  get diagnostics v_set_count = row_count;

  insert into public.checklist_sets(
    id, release_id, version_id, name, normalized_name, set_type, metadata
  )
  select
    object_id, v_release_id, v_version_id, name, normalized_name, set_type,
    jsonb_build_object('sourceKey', source_key)
  from pg_temp.tcos_import_sets;

  create temporary table tcos_import_cards(
    source_key text primary key,
    object_id uuid not null,
    set_source_key text not null,
    card_number text not null,
    normalized_card_number text not null,
    rookie_designation boolean,
    first_bowman_designation boolean,
    autograph_status text not null,
    memorabilia_status text not null,
    variation text,
    normalized_variation text,
    source_notes text,
    players jsonb not null,
    teams jsonb not null
  ) on commit drop;

  insert into pg_temp.tcos_import_cards
  select
    x.value->>'sourceKey',
    gen_random_uuid(),
    x.value->>'setSourceKey',
    x.value->>'cardNumber',
    regexp_replace(lower(x.value->>'cardNumber'), '[^[:alnum:]/]+', '', 'g'),
    case when x.value ? 'rookieDesignation' then (x.value->>'rookieDesignation')::boolean else null end,
    case when x.value ? 'firstBowmanDesignation' then (x.value->>'firstBowmanDesignation')::boolean else null end,
    coalesce(nullif(x.value->>'autographStatus',''), 'non-auto'),
    coalesce(nullif(x.value->>'memorabiliaStatus',''), 'non-memorabilia'),
    nullif(x.value->>'variation',''),
    public.tcos_checklist_normalized_name(x.value->>'variation'),
    nullif(x.value->>'sourceNotes',''),
    coalesce(x.value->'players','[]'::jsonb),
    coalesce(x.value->'teams','[]'::jsonb)
  from jsonb_array_elements(coalesce(p_plan->'cards','[]'::jsonb)) x(value);
  get diagnostics v_card_count = row_count;

  if exists (
    select 1
    from pg_temp.tcos_import_cards c
    left join pg_temp.tcos_import_sets s on s.source_key = c.set_source_key
    where s.source_key is null
  ) then
    raise exception 'Checklist card references unknown set source key';
  end if;

  insert into public.checklist_cards(
    id, release_id, version_id, set_id, card_number, normalized_card_number,
    rookie_designation, first_bowman_designation, autograph_status, memorabilia_status,
    variation, normalized_variation, checklist_notes, metadata
  )
  select
    c.object_id, v_release_id, v_version_id, s.object_id,
    c.card_number, c.normalized_card_number,
    c.rookie_designation, c.first_bowman_designation,
    c.autograph_status, c.memorabilia_status,
    c.variation, c.normalized_variation, c.source_notes,
    jsonb_build_object('sourceKey', c.source_key)
  from pg_temp.tcos_import_cards c
  join pg_temp.tcos_import_sets s on s.source_key = c.set_source_key;

  create temporary table tcos_import_player_refs(
    card_id uuid not null,
    canonical_name text not null,
    normalized_name text not null,
    display_order integer not null
  ) on commit drop;

  insert into pg_temp.tcos_import_player_refs(card_id, canonical_name, normalized_name, display_order)
  select
    c.object_id,
    p.value #>> '{}',
    public.tcos_checklist_normalized_name(p.value #>> '{}'),
    p.ordinality::integer
  from pg_temp.tcos_import_cards c
  cross join lateral jsonb_array_elements(c.players) with ordinality p(value, ordinality);

  insert into public.checklist_players(canonical_name, normalized_name)
  select min(canonical_name), normalized_name
  from pg_temp.tcos_import_player_refs
  group by normalized_name
  on conflict (normalized_name) where birth_date is null do nothing;

  insert into public.checklist_card_players(card_id, player_id, display_order, role)
  select r.card_id, p.id, r.display_order, 'subject'
  from pg_temp.tcos_import_player_refs r
  join public.checklist_players p
    on p.normalized_name = r.normalized_name
   and p.birth_date is null
  on conflict do nothing;

  create temporary table tcos_import_team_refs(
    card_id uuid not null,
    canonical_name text not null,
    normalized_name text not null,
    display_order integer not null
  ) on commit drop;

  insert into pg_temp.tcos_import_team_refs(card_id, canonical_name, normalized_name, display_order)
  select
    c.object_id,
    t.value #>> '{}',
    public.tcos_checklist_normalized_name(t.value #>> '{}'),
    t.ordinality::integer
  from pg_temp.tcos_import_cards c
  cross join lateral jsonb_array_elements(c.teams) with ordinality t(value, ordinality);

  insert into public.checklist_teams(sport_id, league_id, canonical_name, normalized_name)
  select v_sport_id, v_league_id, min(canonical_name), normalized_name
  from pg_temp.tcos_import_team_refs
  group by normalized_name
  on conflict do nothing;

  insert into public.checklist_card_teams(card_id, team_id, display_order, role)
  select r.card_id, t.id, r.display_order, 'card_branding'
  from pg_temp.tcos_import_team_refs r
  join public.checklist_teams t
    on t.sport_id = v_sport_id
   and t.league_id is not distinct from v_league_id
   and t.normalized_name = r.normalized_name
  on conflict do nothing;

  create temporary table tcos_import_parallels(
    source_key text primary key,
    object_id uuid not null,
    set_source_key text not null,
    name text not null,
    normalized_name text not null,
    serial_run integer,
    configuration_exclusivity text
  ) on commit drop;

  insert into pg_temp.tcos_import_parallels
  select
    x.value->>'sourceKey',
    gen_random_uuid(),
    x.value->>'setSourceKey',
    x.value->>'name',
    public.tcos_checklist_normalized_name(x.value->>'name'),
    nullif(x.value->>'serialRun','')::integer,
    nullif(x.value->>'configurationExclusivity','')
  from jsonb_array_elements(coalesce(p_plan->'parallels','[]'::jsonb)) x(value);
  get diagnostics v_parallel_count = row_count;

  if exists (
    select 1
    from pg_temp.tcos_import_parallels p
    left join pg_temp.tcos_import_sets s on s.source_key = p.set_source_key
    where s.source_key is null
  ) then
    raise exception 'Checklist parallel references unknown set source key';
  end if;

  insert into public.checklist_parallels(
    id, release_id, version_id, set_id, name, normalized_name, serial_run,
    configuration_exclusivity, is_base, metadata
  )
  select
    p.object_id, v_release_id, v_version_id, s.object_id,
    p.name, p.normalized_name, p.serial_run,
    p.configuration_exclusivity, false,
    jsonb_build_object('sourceKey', p.source_key)
  from pg_temp.tcos_import_parallels p
  join pg_temp.tcos_import_sets s on s.source_key = p.set_source_key;

  create temporary table tcos_import_identities(
    card_source_key text not null,
    parallel_source_key text,
    identity_schema text not null,
    canonical_key text not null,
    fingerprint_sha256 text not null,
    serial_number_tier text,
    autograph_status text not null,
    memorabilia_status text not null,
    variation text,
    configuration_exclusivity text,
    players jsonb not null,
    teams jsonb not null,
    parallel_name text
  ) on commit drop;

  insert into pg_temp.tcos_import_identities
  select
    x.value->>'cardSourceKey',
    nullif(x.value->>'parallelSourceKey',''),
    coalesce(x.value #>> '{fingerprint,schema}', 'tcos.checklist.identity.v1'),
    x.value #>> '{fingerprint,canonicalKey}',
    x.value #>> '{fingerprint,fingerprintSha256}',
    nullif(x.value #>> '{fingerprint,normalized,serialRun}', ''),
    coalesce(nullif(x.value #>> '{fingerprint,normalized,autographStatus}',''), 'non-auto'),
    coalesce(nullif(x.value #>> '{fingerprint,normalized,memorabiliaStatus}',''), 'non-memorabilia'),
    nullif(x.value #>> '{fingerprint,normalized,variation}', ''),
    nullif(x.value #>> '{fingerprint,normalized,configurationExclusivity}', ''),
    coalesce(x.value #> '{fingerprint,normalized,players}', '[]'::jsonb),
    coalesce(x.value #> '{fingerprint,normalized,teams}', '[]'::jsonb),
    x.value #>> '{fingerprint,normalized,parallel}'
  from jsonb_array_elements(coalesce(p_plan->'identities','[]'::jsonb)) x(value);
  get diagnostics v_identity_count = row_count;

  if exists (
    select 1
    from pg_temp.tcos_import_identities i
    left join pg_temp.tcos_import_cards c on c.source_key = i.card_source_key
    where c.source_key is null
  ) then
    raise exception 'Checklist identity references unknown card source key';
  end if;

  if exists (
    select 1
    from pg_temp.tcos_import_identities i
    left join pg_temp.tcos_import_parallels p on p.source_key = i.parallel_source_key
    where i.parallel_source_key is not null
      and p.source_key is null
  ) then
    raise exception 'Checklist identity references unknown parallel source key';
  end if;

  insert into public.checklist_card_identities(
    release_id, version_id, set_id, card_id, parallel_id,
    identity_schema, canonical_key, fingerprint_sha256,
    serial_number_tier, autograph_status, memorabilia_status,
    variation, configuration_exclusivity, metadata
  )
  select
    v_release_id, v_version_id, s.object_id, c.object_id, p.object_id,
    i.identity_schema, i.canonical_key, i.fingerprint_sha256,
    i.serial_number_tier, i.autograph_status, i.memorabilia_status,
    i.variation, i.configuration_exclusivity,
    jsonb_build_object(
      'players', i.players,
      'teams', i.teams,
      'parallel', i.parallel_name
    )
  from pg_temp.tcos_import_identities i
  join pg_temp.tcos_import_cards c on c.source_key = i.card_source_key
  join pg_temp.tcos_import_sets s on s.source_key = c.set_source_key
  left join pg_temp.tcos_import_parallels p on p.source_key = i.parallel_source_key;

  select count(*)::integer into v_error_count
  from jsonb_array_elements(coalesce(v_validation->'issues','[]'::jsonb)) issue(value)
  where issue.value->>'severity' = 'error';

  insert into public.checklist_validation_queue(
    release_id, checklist_version_id, issue_type, severity, status, reason, evidence
  )
  select
    v_release_id,
    v_version_id,
    coalesce(nullif(issue.value->>'code',''), 'import_notice'),
    case when issue.value->>'severity' = 'error' then 'high' else 'low' end,
    case when issue.value->>'severity' = 'error' then 'open' else 'dismissed' end,
    issue.value->>'message',
    jsonb_build_object('rowReference', issue.value->>'rowReference')
  from jsonb_array_elements(coalesce(v_validation->'issues','[]'::jsonb)) issue(value);

  if v_previous_version_id is not null then
    update public.checklist_versions
    set is_active = false,
        status = 'superseded'
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
        'validationIssues', coalesce(jsonb_array_length(v_validation->'issues'), 0),
        'writer', 'set_based_v1'
      )
  where id = v_import_run_id;

  update public.checklist_releases
  set checklist_status = case when v_error_count = 0 then 'live' else 'manual_import_required' end,
      import_status = case when v_error_count = 0 then 'successful' else 'validation_required' end,
      last_successful_check_at = case when v_error_count = 0 then now() else last_successful_check_at end,
      last_checked_at = now()
  where id = v_release_id;

  insert into public.checklist_release_status_events(
    release_id, release_source_id, status_domain, previous_status,
    new_status, reason, source_snapshot
  ) values (
    v_release_id, v_release_source_id, 'import', 'importing',
    case when v_error_count = 0 then 'successful' else 'validation_required' end,
    'Transactional Checklist Registry set-based import completed',
    jsonb_build_object(
      'sourceFileId', v_source_file_id,
      'versionId', v_version_id,
      'writer', 'set_based_v1'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'releaseId', v_release_id,
    'sourceFileId', v_source_file_id,
    'versionId', v_version_id,
    'importRunId', v_import_run_id,
    'status', case when v_error_count = 0 then 'live' else 'validation_required' end,
    'writer', 'set_based_v1',
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
  jsonb, text, text, bigint, text, text, text
) from public, anon, authenticated;

grant execute on function public.tcos_apply_checklist_import_plan(
  jsonb, text, text, bigint, text, text, text
) to service_role;

select pg_notify('pgrst', 'reload schema');
