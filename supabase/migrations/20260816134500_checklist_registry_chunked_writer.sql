-- Resumable Checklist Registry writer for plans that exceed managed API transaction limits.
-- Facts are loaded into an inactive version in short idempotent chunks. The prior
-- active version remains live until finalize verifies every expected chunk/count,
-- then activation/supersession happens atomically in one short transaction.

create table if not exists public.checklist_chunk_import_progress (
  version_id uuid not null references public.checklist_versions(id) on delete cascade,
  chunk_kind text not null check (chunk_kind in ('sets','cards','parallels','identities')),
  chunk_key text not null,
  row_count integer not null check (row_count >= 0),
  resolved_count integer not null check (resolved_count >= 0),
  completed_at timestamptz not null default now(),
  primary key (version_id, chunk_kind, chunk_key)
);

alter table public.checklist_chunk_import_progress enable row level security;
revoke all on table public.checklist_chunk_import_progress from public, anon, authenticated;

create index if not exists checklist_sets_version_source_key_idx
  on public.checklist_sets(version_id, ((metadata->>'sourceKey')));
create index if not exists checklist_cards_version_source_key_idx
  on public.checklist_cards(version_id, ((metadata->>'sourceKey')));
create index if not exists checklist_parallels_version_source_key_idx
  on public.checklist_parallels(version_id, ((metadata->>'sourceKey')));

create or replace function public.tcos_begin_checklist_chunked_import(
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
set statement_timeout = '35s'
set lock_timeout = '20s'
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
  v_release_slug text;
  v_manufacturer_slug text;
  v_sport_slug text;
  v_league_slug text;
  v_brand_slug text;
  v_expected_cards integer := coalesce(nullif(v_validation #>> '{counts,cards}', '')::integer, 0);
  v_status text;
  v_is_active boolean;
  v_normalized_cards integer;
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

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|', v_manufacturer_slug, v_brand_slug, v_sport_slug, v_league_slug,
      coalesce(v_release->>'releaseYear',''), coalesce(v_release->>'season',''), v_release_slug), 0));

  select id into v_manufacturer_id
  from public.checklist_manufacturers where slug = v_manufacturer_slug;
  if v_manufacturer_id is null then
    insert into public.checklist_manufacturers(name, slug)
    values (v_release->>'manufacturer', v_manufacturer_slug)
    returning id into v_manufacturer_id;
  end if;

  select id into v_sport_id
  from public.checklist_sports where slug = v_sport_slug;
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
      v_release->>'product', v_release_slug, nullif(v_release->>'releaseYear',''),
      nullif(v_release->>'season',''), nullif(v_source->>'sourceUrl',''),
      'released', 'detected', 'importing', now(),
      jsonb_build_object('latestAdapterId', p_plan->>'adapterId',
                         'latestAdapterVersion', p_plan->>'adapterVersion',
                         'chunkedWriter', true)
    ) returning id into v_release_id;
  else
    update public.checklist_releases
    set product_name = coalesce(nullif(v_release->>'product',''), product_name),
        official_checklist_url = coalesce(nullif(v_source->>'sourceUrl',''), official_checklist_url),
        import_status = 'importing',
        last_checked_at = now(),
        metadata = metadata || jsonb_build_object(
          'latestAdapterId', p_plan->>'adapterId',
          'latestAdapterVersion', p_plan->>'adapterVersion',
          'chunkedWriter', true)
    where id = v_release_id;
  end if;

  insert into public.checklist_release_sources(
    release_id, source_type, source_url, authoritative, access_status,
    last_checked_at, last_successful_at, metadata
  ) values (
    v_release_id, 'checklist_file', v_source->>'sourceUrl',
    (v_source->>'authority') in ('official_manufacturer','manual_official_file'),
    'available', now(), now(),
    jsonb_build_object('authority', v_source->>'authority',
      'redistributionAllowed', coalesce((v_source->>'redistributionAllowed')::boolean,false))
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
      release_id, release_source_id, source_file_type, source_url,
      original_filename, storage_bucket, storage_object_path, mime_type,
      size_bytes, sha256, retrieved_at, importer_version,
      import_status, validation_status, metadata
    ) values (
      v_release_id, v_release_source_id, 'checklist', v_source->>'sourceUrl',
      p_original_filename, p_storage_bucket, p_storage_object_path, p_mime_type,
      p_size_bytes, p_sha256,
      coalesce(nullif(v_source->>'retrievedAt','')::timestamptz, now()),
      p_plan->>'adapterVersion', 'importing', 'passed',
      jsonb_build_object('adapterId', p_plan->>'adapterId',
        'authority', v_source->>'authority', 'privateArchiveRequired', true,
        'chunkedWriter', true)
    ) returning id into v_source_file_id;
  else
    update public.checklist_source_files
    set release_source_id = v_release_source_id,
        source_url = v_source->>'sourceUrl',
        original_filename = p_original_filename,
        storage_bucket = p_storage_bucket,
        storage_object_path = p_storage_object_path,
        mime_type = p_mime_type,
        size_bytes = p_size_bytes,
        importer_version = p_plan->>'adapterVersion',
        import_status = case when import_status = 'successful' then import_status else 'importing' end,
        validation_status = 'passed',
        metadata = metadata || jsonb_build_object('chunkedWriter', true)
    where id = v_source_file_id;
  end if;

  select id, status, is_active, normalized_card_count
    into v_version_id, v_status, v_is_active, v_normalized_cards
  from public.checklist_versions
  where source_file_id = v_source_file_id
    and parser_version = p_plan->>'adapterVersion'
    and normalized_schema_version = 'tcos.checklist.normalized.v1'
  limit 1;

  if v_version_id is not null and v_is_active and v_status = 'live' then
    if coalesce(v_normalized_cards, 0) <> v_expected_cards then
      raise exception 'Live chunked version card count mismatch: expected %, recorded %',
        v_expected_cards, coalesce(v_normalized_cards, 0);
    end if;
    return jsonb_build_object(
      'ok', true, 'alreadyLive', true, 'resumed', false,
      'releaseId', v_release_id, 'sourceFileId', v_source_file_id,
      'versionId', v_version_id, 'status', 'live'
    );
  end if;

  if v_version_id is null then
    select id into v_previous_version_id
    from public.checklist_versions
    where release_id = v_release_id and is_active
    order by activated_at desc nulls last, version_number desc
    limit 1;

    select coalesce(max(version_number), 0) + 1 into v_version_number
    from public.checklist_versions where release_id = v_release_id;

    insert into public.checklist_versions(
      release_id, source_file_id, previous_version_id, version_number,
      manufacturer_version_label, parser_version, normalized_schema_version,
      status, source_row_count, notes, metadata
    ) values (
      v_release_id, v_source_file_id, v_previous_version_id, v_version_number,
      null, p_plan->>'adapterVersion', 'tcos.checklist.normalized.v1',
      'importing', v_expected_cards, 'Resumable chunked Checklist Registry import',
      jsonb_build_object('adapterId', p_plan->>'adapterId', 'chunkedWriter', true)
    ) returning id into v_version_id;
  else
    update public.checklist_versions
    set status = 'importing', is_active = false, source_row_count = v_expected_cards,
        notes = 'Resumable chunked Checklist Registry import',
        metadata = metadata || jsonb_build_object('chunkedWriter', true)
    where id = v_version_id;
  end if;

  select id into v_import_run_id
  from public.checklist_import_runs
  where checklist_version_id = v_version_id and status = 'running'
  order by started_at desc
  limit 1;

  if v_import_run_id is null then
    insert into public.checklist_import_runs(
      release_id, source_file_id, checklist_version_id,
      importer_name, importer_version, status, source_row_count,
      started_at, summary
    ) values (
      v_release_id, v_source_file_id, v_version_id,
      p_plan->>'adapterId', p_plan->>'adapterVersion', 'running',
      v_expected_cards, now(),
      jsonb_build_object('schema', p_plan->>'schema', 'chunkedWriter', true)
    ) returning id into v_import_run_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'alreadyLive', false,
    'resumed', exists(select 1 from public.checklist_chunk_import_progress where version_id = v_version_id),
    'releaseId', v_release_id, 'sourceFileId', v_source_file_id,
    'versionId', v_version_id, 'importRunId', v_import_run_id,
    'status', 'importing'
  );
end;
$$;

create or replace function public.tcos_append_checklist_chunk(
  p_version_id uuid,
  p_chunk_kind text,
  p_chunk_key text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '35s'
set lock_timeout = '20s'
as $$
declare
  v_release_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_status text;
  v_is_active boolean;
  v_expected integer := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
  v_resolved integer := 0;
  v_existing public.checklist_chunk_import_progress%rowtype;
begin
  if p_chunk_kind not in ('sets','cards','parallels','identities') then
    raise exception 'Unsupported checklist chunk kind %', p_chunk_kind;
  end if;
  if p_chunk_key is null or btrim(p_chunk_key) = '' then
    raise exception 'Checklist chunk key is required';
  end if;

  select v.release_id, v.status, v.is_active, r.sport_id, r.league_id
    into v_release_id, v_status, v_is_active, v_sport_id, v_league_id
  from public.checklist_versions v
  join public.checklist_releases r on r.id = v.release_id
  where v.id = p_version_id;
  if v_release_id is null then
    raise exception 'Checklist chunk version % does not exist', p_version_id;
  end if;

  select * into v_existing
  from public.checklist_chunk_import_progress
  where version_id = p_version_id
    and chunk_kind = p_chunk_kind
    and chunk_key = p_chunk_key;
  if found then
    if v_existing.row_count <> v_expected or v_existing.resolved_count <> v_expected then
      raise exception 'Checklist chunk %/% replay mismatch', p_chunk_kind, p_chunk_key;
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true,
      'kind', p_chunk_kind, 'chunkKey', p_chunk_key,
      'rows', v_existing.row_count, 'resolved', v_existing.resolved_count);
  end if;

  if v_is_active or v_status <> 'importing' then
    raise exception 'Checklist chunk version % is not an inactive importing version', p_version_id;
  end if;

  if p_chunk_kind = 'sets' then
    insert into public.checklist_sets(
      release_id, version_id, name, normalized_name, set_type, metadata
    )
    select
      v_release_id, p_version_id, s.value->>'name',
      coalesce(nullif(s.value->>'normalizedName',''), public.tcos_checklist_normalized_name(s.value->>'name')),
      coalesce(nullif(s.value->>'setType',''), 'other'),
      jsonb_build_object('sourceKey', s.value->>'sourceKey')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) s(value)
    where not exists (
      select 1 from public.checklist_sets x
      where x.version_id = p_version_id
        and x.metadata->>'sourceKey' = s.value->>'sourceKey'
    );

    select count(*)::integer into v_resolved
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) s(value)
    join public.checklist_sets x
      on x.version_id = p_version_id
     and x.metadata->>'sourceKey' = s.value->>'sourceKey';

  elsif p_chunk_kind = 'cards' then
    select count(*)::integer into v_resolved
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
    join public.checklist_sets s
      on s.version_id = p_version_id
     and s.metadata->>'sourceKey' = c.value->>'setSourceKey';
    if v_resolved <> v_expected then
      raise exception 'Checklist card chunk % has unresolved set references: %/%',
        p_chunk_key, v_resolved, v_expected;
    end if;

    insert into public.checklist_players(canonical_name, normalized_name)
    select distinct on (x.normalized_name) x.canonical_name, x.normalized_name
    from (
      select p.player_name canonical_name,
             public.tcos_checklist_normalized_name(p.player_name) normalized_name
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
      cross join lateral jsonb_array_elements_text(coalesce(c.value->'players','[]'::jsonb)) p(player_name)
    ) x
    where x.normalized_name is not null
    order by x.normalized_name, x.canonical_name
    on conflict do nothing;

    insert into public.checklist_teams(sport_id, league_id, canonical_name, normalized_name)
    select distinct on (x.normalized_name)
      v_sport_id, v_league_id, x.canonical_name, x.normalized_name
    from (
      select t.team_name canonical_name,
             public.tcos_checklist_normalized_name(t.team_name) normalized_name
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
      cross join lateral jsonb_array_elements_text(coalesce(c.value->'teams','[]'::jsonb)) t(team_name)
    ) x
    where x.normalized_name is not null
    order by x.normalized_name, x.canonical_name
    on conflict do nothing;

    insert into public.checklist_cards(
      release_id, version_id, set_id, card_number, normalized_card_number,
      rookie_designation, first_bowman_designation, autograph_status,
      memorabilia_status, variation, normalized_variation, checklist_notes, metadata
    )
    select
      v_release_id, p_version_id, s.id, c.value->>'cardNumber',
      regexp_replace(lower(c.value->>'cardNumber'), '[^[:alnum:]/]+', '', 'g'),
      case when c.value ? 'rookieDesignation' then (c.value->>'rookieDesignation')::boolean else null end,
      case when c.value ? 'firstBowmanDesignation' then (c.value->>'firstBowmanDesignation')::boolean else null end,
      coalesce(nullif(c.value->>'autographStatus',''), 'non-auto'),
      coalesce(nullif(c.value->>'memorabiliaStatus',''), 'non-memorabilia'),
      nullif(c.value->>'variation',''),
      public.tcos_checklist_normalized_name(c.value->>'variation'),
      nullif(c.value->>'sourceNotes',''),
      jsonb_build_object('sourceKey', c.value->>'sourceKey')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
    join public.checklist_sets s
      on s.version_id = p_version_id
     and s.metadata->>'sourceKey' = c.value->>'setSourceKey'
    where not exists (
      select 1 from public.checklist_cards x
      where x.version_id = p_version_id
        and x.metadata->>'sourceKey' = c.value->>'sourceKey'
    );

    insert into public.checklist_card_players(card_id, player_id, display_order, role)
    select card.id, player.id, p.ordinality::integer, 'subject'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
    join public.checklist_cards card
      on card.version_id = p_version_id
     and card.metadata->>'sourceKey' = c.value->>'sourceKey'
    cross join lateral jsonb_array_elements_text(coalesce(c.value->'players','[]'::jsonb))
      with ordinality p(player_name, ordinality)
    join lateral (
      select cp.id from public.checklist_players cp
      where cp.normalized_name = public.tcos_checklist_normalized_name(p.player_name)
        and cp.birth_date is null
      limit 1
    ) player on true
    on conflict do nothing;

    insert into public.checklist_card_teams(card_id, team_id, display_order, role)
    select card.id, team.id, t.ordinality::integer, 'card_branding'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
    join public.checklist_cards card
      on card.version_id = p_version_id
     and card.metadata->>'sourceKey' = c.value->>'sourceKey'
    cross join lateral jsonb_array_elements_text(coalesce(c.value->'teams','[]'::jsonb))
      with ordinality t(team_name, ordinality)
    join lateral (
      select ct.id from public.checklist_teams ct
      where ct.sport_id = v_sport_id
        and ct.league_id is not distinct from v_league_id
        and ct.normalized_name = public.tcos_checklist_normalized_name(t.team_name)
      limit 1
    ) team on true
    on conflict do nothing;

    select count(*)::integer into v_resolved
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) c(value)
    join public.checklist_cards card
      on card.version_id = p_version_id
     and card.metadata->>'sourceKey' = c.value->>'sourceKey';

  elsif p_chunk_kind = 'parallels' then
    select count(*)::integer into v_resolved
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) p(value)
    join public.checklist_sets s
      on s.version_id = p_version_id
     and s.metadata->>'sourceKey' = p.value->>'setSourceKey';
    if v_resolved <> v_expected then
      raise exception 'Checklist parallel chunk % has unresolved set references: %/%',
        p_chunk_key, v_resolved, v_expected;
    end if;

    insert into public.checklist_parallels(
      release_id, version_id, set_id, name, normalized_name, serial_run,
      configuration_exclusivity, is_base, metadata
    )
    select
      v_release_id, p_version_id, s.id, p.value->>'name',
      public.tcos_checklist_normalized_name(p.value->>'name'),
      nullif(p.value->>'serialRun','')::integer,
      nullif(p.value->>'configurationExclusivity',''), false,
      jsonb_build_object('sourceKey', p.value->>'sourceKey')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) p(value)
    join public.checklist_sets s
      on s.version_id = p_version_id
     and s.metadata->>'sourceKey' = p.value->>'setSourceKey'
    where not exists (
      select 1 from public.checklist_parallels x
      where x.version_id = p_version_id
        and x.metadata->>'sourceKey' = p.value->>'sourceKey'
    );

    select count(*)::integer into v_resolved
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) p(value)
    join public.checklist_parallels x
      on x.version_id = p_version_id
     and x.metadata->>'sourceKey' = p.value->>'sourceKey';

  else
    select count(*)::integer into v_resolved
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) i(value)
    join public.checklist_cards card
      on card.version_id = p_version_id
     and card.metadata->>'sourceKey' = i.value->>'cardSourceKey'
    left join public.checklist_parallels parallel
      on parallel.version_id = p_version_id
     and parallel.metadata->>'sourceKey' = nullif(i.value->>'parallelSourceKey','')
    where nullif(i.value->>'parallelSourceKey','') is null or parallel.id is not null;

    if v_resolved <> v_expected then
      raise exception 'Checklist identity chunk % has unresolved references: %/%',
        p_chunk_key, v_resolved, v_expected;
    end if;

    insert into public.checklist_card_identities(
      release_id, version_id, set_id, card_id, parallel_id,
      identity_schema, canonical_key, fingerprint_sha256, serial_number_tier,
      autograph_status, memorabilia_status, variation,
      configuration_exclusivity, metadata
    )
    select
      v_release_id, p_version_id, card.set_id, card.id, parallel.id,
      coalesce(i.value #>> '{fingerprint,schema}', 'tcos.checklist.identity.v1'),
      i.value #>> '{fingerprint,canonicalKey}',
      i.value #>> '{fingerprint,fingerprintSha256}',
      nullif(i.value #>> '{fingerprint,normalized,serialRun}', ''),
      coalesce(nullif(i.value #>> '{fingerprint,normalized,autographStatus}',''), 'non-auto'),
      coalesce(nullif(i.value #>> '{fingerprint,normalized,memorabiliaStatus}',''), 'non-memorabilia'),
      nullif(i.value #>> '{fingerprint,normalized,variation}', ''),
      nullif(i.value #>> '{fingerprint,normalized,configurationExclusivity}', ''),
      jsonb_build_object(
        'players', coalesce(i.value #> '{fingerprint,normalized,players}', '[]'::jsonb),
        'teams', coalesce(i.value #> '{fingerprint,normalized,teams}', '[]'::jsonb),
        'parallel', i.value #>> '{fingerprint,normalized,parallel}'
      )
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) i(value)
    join public.checklist_cards card
      on card.version_id = p_version_id
     and card.metadata->>'sourceKey' = i.value->>'cardSourceKey'
    left join public.checklist_parallels parallel
      on parallel.version_id = p_version_id
     and parallel.metadata->>'sourceKey' = nullif(i.value->>'parallelSourceKey','')
    where nullif(i.value->>'parallelSourceKey','') is null or parallel.id is not null
    on conflict (identity_schema, fingerprint_sha256) do nothing;
  end if;

  if v_resolved <> v_expected then
    raise exception 'Checklist chunk %/% resolved count mismatch: %/%',
      p_chunk_kind, p_chunk_key, v_resolved, v_expected;
  end if;

  insert into public.checklist_chunk_import_progress(
    version_id, chunk_kind, chunk_key, row_count, resolved_count
  ) values (p_version_id, p_chunk_kind, p_chunk_key, v_expected, v_resolved);

  update public.checklist_versions
  set metadata = metadata || jsonb_build_object(
    'chunkedWriter', true, 'lastChunkKind', p_chunk_kind,
    'lastChunkKey', p_chunk_key, 'lastChunkAt', now())
  where id = p_version_id;

  return jsonb_build_object('ok', true, 'idempotent', false,
    'kind', p_chunk_kind, 'chunkKey', p_chunk_key,
    'rows', v_expected, 'resolved', v_resolved);
end;
$$;

create or replace function public.tcos_finalize_checklist_chunked_import(
  p_version_id uuid,
  p_expected_sets integer,
  p_expected_cards integer,
  p_expected_parallels integer,
  p_expected_identities integer,
  p_issues jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '35s'
set lock_timeout = '20s'
as $$
declare
  v_release_id uuid;
  v_source_file_id uuid;
  v_release_source_id uuid;
  v_import_run_id uuid;
  v_parser_version text;
  v_status text;
  v_is_active boolean;
  v_set_count integer;
  v_card_count integer;
  v_parallel_count integer;
  v_progress_sets integer;
  v_progress_cards integer;
  v_progress_parallels integer;
  v_progress_identities integer;
  v_progress_identity_resolved integer;
  v_error_count integer;
  v_issue jsonb;
begin
  select release_id, source_file_id, parser_version, status, is_active
    into v_release_id, v_source_file_id, v_parser_version, v_status, v_is_active
  from public.checklist_versions where id = p_version_id;
  if v_release_id is null then
    raise exception 'Checklist finalize version % does not exist', p_version_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_release_id::text, 0));

  select count(*)::integer into v_set_count
  from public.checklist_sets where version_id = p_version_id;
  select count(*)::integer into v_card_count
  from public.checklist_cards where version_id = p_version_id;
  select count(*)::integer into v_parallel_count
  from public.checklist_parallels where version_id = p_version_id;

  select coalesce(sum(row_count),0)::integer into v_progress_sets
  from public.checklist_chunk_import_progress where version_id = p_version_id and chunk_kind = 'sets';
  select coalesce(sum(row_count),0)::integer into v_progress_cards
  from public.checklist_chunk_import_progress where version_id = p_version_id and chunk_kind = 'cards';
  select coalesce(sum(row_count),0)::integer into v_progress_parallels
  from public.checklist_chunk_import_progress where version_id = p_version_id and chunk_kind = 'parallels';
  select coalesce(sum(row_count),0)::integer, coalesce(sum(resolved_count),0)::integer
    into v_progress_identities, v_progress_identity_resolved
  from public.checklist_chunk_import_progress where version_id = p_version_id and chunk_kind = 'identities';

  if v_set_count <> p_expected_sets or v_progress_sets <> p_expected_sets then
    raise exception 'Checklist finalize set mismatch: table %, chunks %, expected %',
      v_set_count, v_progress_sets, p_expected_sets;
  end if;
  if v_card_count <> p_expected_cards or v_progress_cards <> p_expected_cards then
    raise exception 'Checklist finalize card mismatch: table %, chunks %, expected %',
      v_card_count, v_progress_cards, p_expected_cards;
  end if;
  if v_parallel_count <> p_expected_parallels or v_progress_parallels <> p_expected_parallels then
    raise exception 'Checklist finalize parallel mismatch: table %, chunks %, expected %',
      v_parallel_count, v_progress_parallels, p_expected_parallels;
  end if;
  if v_progress_identities <> p_expected_identities or v_progress_identity_resolved <> p_expected_identities then
    raise exception 'Checklist finalize identity mismatch: chunks %, resolved %, expected %',
      v_progress_identities, v_progress_identity_resolved, p_expected_identities;
  end if;

  if v_is_active and v_status = 'live' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'chunked', true,
      'releaseId', v_release_id, 'sourceFileId', v_source_file_id,
      'versionId', p_version_id, 'status', 'live',
      'counts', jsonb_build_object('sets', v_set_count, 'cards', v_card_count,
        'parallels', v_parallel_count, 'identities', p_expected_identities, 'errors', 0)
    );
  end if;

  if v_status <> 'importing' or v_is_active then
    raise exception 'Checklist finalize version % is not an inactive importing version', p_version_id;
  end if;

  select count(*)::integer into v_error_count
  from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) issue(value)
  where issue.value->>'severity' = 'error';
  if v_error_count <> 0 then
    raise exception 'Checklist chunked finalize refuses % validation error(s)', v_error_count;
  end if;

  for v_issue in select value from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb))
  loop
    insert into public.checklist_validation_queue(
      release_id, checklist_version_id, issue_type, severity, status, reason, evidence
    ) values (
      v_release_id, p_version_id,
      coalesce(nullif(v_issue->>'code',''), 'import_notice'),
      case when v_issue->>'severity' = 'error' then 'high' else 'low' end,
      case when v_issue->>'severity' = 'error' then 'open' else 'dismissed' end,
      v_issue->>'message', jsonb_build_object('rowReference', v_issue->>'rowReference')
    );
  end loop;

  update public.checklist_versions
  set is_active = false,
      status = case when status = 'live' then 'superseded' else status end
  where release_id = v_release_id and id <> p_version_id and is_active;

  update public.checklist_versions
  set status = 'live', source_row_count = p_expected_cards,
      normalized_card_count = p_expected_cards,
      normalized_identity_count = p_expected_identities,
      imported_at = now(), validated_at = now(), activated_at = now(),
      is_active = true,
      notes = 'Resumable chunked Checklist Registry import',
      metadata = metadata || jsonb_build_object('chunkedWriter', true, 'finalizedAt', now())
  where id = p_version_id;

  select id into v_import_run_id
  from public.checklist_import_runs
  where checklist_version_id = p_version_id and status = 'running'
  order by started_at desc limit 1;
  if v_import_run_id is not null then
    update public.checklist_import_runs
    set source_row_count = p_expected_cards,
        imported_row_count = p_expected_cards,
        skipped_row_count = 0, error_count = 0,
        status = 'successful', finished_at = now(),
        summary = jsonb_build_object(
          'sets', p_expected_sets, 'cards', p_expected_cards,
          'parallels', p_expected_parallels, 'identities', p_expected_identities,
          'validationIssues', coalesce(jsonb_array_length(coalesce(p_issues,'[]'::jsonb)),0),
          'chunkedWriter', true)
    where id = v_import_run_id;
  end if;

  update public.checklist_source_files
  set importer_version = v_parser_version,
      import_status = 'successful', validation_status = 'passed',
      metadata = metadata || jsonb_build_object('chunkedWriter', true)
  where id = v_source_file_id;

  select release_source_id into v_release_source_id
  from public.checklist_source_files where id = v_source_file_id;

  update public.checklist_releases
  set checklist_status = 'live', import_status = 'successful',
      last_successful_check_at = now(), last_checked_at = now(),
      metadata = metadata || jsonb_build_object('latestChunkedWriter', true)
  where id = v_release_id;

  insert into public.checklist_release_status_events(
    release_id, release_source_id, status_domain, previous_status,
    new_status, reason, source_snapshot
  ) values (
    v_release_id, v_release_source_id, 'import', 'importing', 'successful',
    'Resumable chunked Checklist Registry import completed',
    jsonb_build_object('sourceFileId', v_source_file_id, 'versionId', p_version_id)
  );

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'chunked', true,
    'releaseId', v_release_id, 'sourceFileId', v_source_file_id,
    'versionId', p_version_id, 'importRunId', v_import_run_id,
    'status', 'live',
    'counts', jsonb_build_object('sets', v_set_count, 'cards', v_card_count,
      'parallels', v_parallel_count, 'identities', p_expected_identities, 'errors', 0)
  );
end;
$$;

revoke all on function public.tcos_begin_checklist_chunked_import(
  jsonb,text,text,bigint,text,text,text
) from public, anon, authenticated;
revoke all on function public.tcos_append_checklist_chunk(uuid,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_finalize_checklist_chunked_import(
  uuid,integer,integer,integer,integer,jsonb
) from public, anon, authenticated;

grant execute on function public.tcos_begin_checklist_chunked_import(
  jsonb,text,text,bigint,text,text,text
) to service_role;
grant execute on function public.tcos_append_checklist_chunk(uuid,text,text,jsonb)
  to service_role;
grant execute on function public.tcos_finalize_checklist_chunked_import(
  uuid,integer,integer,integer,integer,jsonb
) to service_role;
