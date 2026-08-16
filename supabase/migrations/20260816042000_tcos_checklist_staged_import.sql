-- Chunk-safe Checklist Registry ingestion.
-- Keeps the existing one-shot RPC intact, but provides a staged contract for
-- large validated plans so no request has to materialize an entire release.

create index if not exists checklist_sets_version_source_key_idx
  on public.checklist_sets(version_id, ((metadata->>'sourceKey')))
  where nullif(metadata->>'sourceKey', '') is not null;

create index if not exists checklist_cards_version_source_key_idx
  on public.checklist_cards(version_id, ((metadata->>'sourceKey')))
  where nullif(metadata->>'sourceKey', '') is not null;

create index if not exists checklist_parallels_version_source_key_idx
  on public.checklist_parallels(version_id, ((metadata->>'sourceKey')))
  where nullif(metadata->>'sourceKey', '') is not null;

create or replace function public.tcos_begin_checklist_import_plan(
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
set statement_timeout = '25s'
set lock_timeout = '10s'
as $$
declare
  v_release jsonb := coalesce(p_plan->'release', '{}'::jsonb);
  v_source jsonb := coalesce(p_plan->'source', '{}'::jsonb);
  v_validation jsonb := coalesce(p_plan->'validation', '{}'::jsonb);
  v_expected jsonb := coalesce(v_validation->'counts', '{}'::jsonb);
  v_manufacturer_id uuid;
  v_brand_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_release_id uuid;
  v_release_source_id uuid;
  v_source_file_id uuid;
  v_previous_version_id uuid;
  v_version_id uuid;
  v_import_run_id uuid;
  v_version_number integer;
  v_release_slug text;
  v_manufacturer_slug text;
  v_sport_slug text;
  v_league_slug text;
  v_brand_slug text;
  v_version_status text;
  v_version_active boolean;
  v_version_metadata jsonb;
  v_sets integer := 0;
  v_cards integer := 0;
  v_parallels integer := 0;
  v_identities integer := 0;
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

  insert into public.checklist_manufacturers(name, slug)
  values (v_release->>'manufacturer', v_manufacturer_slug)
  on conflict (slug) do update set name = excluded.name, active = true
  returning id into v_manufacturer_id;

  insert into public.checklist_sports(name, slug)
  values (v_release->>'sport', v_sport_slug)
  on conflict (slug) do update set name = excluded.name, active = true
  returning id into v_sport_id;

  if v_brand_slug is not null then
    insert into public.checklist_brands(manufacturer_id, name, slug)
    values (v_manufacturer_id, v_release->>'brand', v_brand_slug)
    on conflict (manufacturer_id, slug) do update set name = excluded.name, active = true
    returning id into v_brand_id;
  end if;

  if v_league_slug is not null then
    insert into public.checklist_leagues(sport_id, name, slug)
    values (v_sport_id, v_release->>'league', v_league_slug)
    on conflict (sport_id, slug) do update set name = excluded.name, active = true
    returning id into v_league_id;
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
    begin
      insert into public.checklist_releases(
        manufacturer_id, brand_id, sport_id, league_id, product_name, slug,
        release_year, season, official_checklist_url, release_status,
        checklist_status, import_status, last_checked_at, metadata
      ) values (
        v_manufacturer_id, v_brand_id, v_sport_id, v_league_id,
        v_release->>'product', v_release_slug,
        nullif(v_release->>'releaseYear',''), nullif(v_release->>'season',''),
        nullif(v_source->>'sourceUrl',''), 'released', 'detected', 'importing', now(),
        jsonb_build_object('latestAdapterId',p_plan->>'adapterId','latestAdapterVersion',p_plan->>'adapterVersion')
      ) returning id into v_release_id;
    exception when unique_violation then
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
    end;
  end if;

  if v_release_id is null then
    raise exception 'Could not resolve Checklist Registry release';
  end if;

  perform 1 from public.checklist_releases where id = v_release_id for update;
  update public.checklist_releases
  set product_name = coalesce(nullif(v_release->>'product',''), product_name),
      official_checklist_url = coalesce(nullif(v_source->>'sourceUrl',''), official_checklist_url),
      checklist_status = case when checklist_status = 'live' then checklist_status else 'detected' end,
      import_status = case when import_status = 'successful' then import_status else 'importing' end,
      last_checked_at = now(),
      metadata = metadata || jsonb_build_object('latestAdapterId',p_plan->>'adapterId','latestAdapterVersion',p_plan->>'adapterVersion')
  where id = v_release_id;

  insert into public.checklist_release_sources(
    release_id, source_type, source_url, authoritative, access_status,
    last_checked_at, last_successful_at, metadata
  ) values (
    v_release_id, 'checklist_file', v_source->>'sourceUrl',
    (v_source->>'authority') in ('official_manufacturer','manual_official_file'),
    'available', now(), now(),
    jsonb_build_object('authority',v_source->>'authority','redistributionAllowed',coalesce((v_source->>'redistributionAllowed')::boolean,false))
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
    begin
      insert into public.checklist_source_files(
        release_id, release_source_id, source_file_type, source_url, original_filename,
        storage_bucket, storage_object_path, mime_type, size_bytes, sha256, retrieved_at,
        importer_version, import_status, validation_status, metadata
      ) values (
        v_release_id, v_release_source_id, 'checklist', v_source->>'sourceUrl', p_original_filename,
        p_storage_bucket, p_storage_object_path, p_mime_type, p_size_bytes, p_sha256,
        coalesce(nullif(v_source->>'retrievedAt','')::timestamptz, now()),
        p_plan->>'adapterVersion', 'importing', 'passed',
        jsonb_build_object('adapterId',p_plan->>'adapterId','authority',v_source->>'authority','privateArchiveRequired',true)
      ) returning id into v_source_file_id;
    exception when unique_violation then
      select id into v_source_file_id
      from public.checklist_source_files
      where release_id = v_release_id and sha256 = p_sha256;
    end;
  end if;

  if v_source_file_id is null then
    raise exception 'Could not resolve Checklist Registry source file';
  end if;

  select id, status, is_active, metadata
  into v_version_id, v_version_status, v_version_active, v_version_metadata
  from public.checklist_versions
  where source_file_id = v_source_file_id
    and parser_version = p_plan->>'adapterVersion'
    and normalized_schema_version = 'tcos.checklist.normalized.v1';

  if v_version_id is not null then
    select count(*) into v_sets from public.checklist_sets where version_id = v_version_id;
    select count(*) into v_cards from public.checklist_cards where version_id = v_version_id;
    select count(*) into v_parallels from public.checklist_parallels where version_id = v_version_id;
    select count(*) into v_identities from public.checklist_card_identities where version_id = v_version_id;

    if v_version_active and v_version_status in ('live','revised') then
      if v_sets <> coalesce((v_expected->>'sets')::integer,0)
         or v_cards <> coalesce((v_expected->>'cards')::integer,0)
         or v_parallels <> coalesce((v_expected->>'parallels')::integer,0)
         or v_identities <> coalesce((v_expected->>'identities')::integer,0) then
        raise exception 'Existing live Checklist Registry version does not match validated expected counts';
      end if;
      return jsonb_build_object(
        'ok',true,'complete',true,'idempotent',true,'releaseId',v_release_id,
        'sourceFileId',v_source_file_id,'versionId',v_version_id,
        'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities)
      );
    end if;

    if v_version_status = 'importing'
       and coalesce((v_version_metadata->>'stagedImport')::boolean,false) then
      select id into v_import_run_id
      from public.checklist_import_runs
      where checklist_version_id = v_version_id and status in ('running','partial')
      order by created_at desc limit 1;
      if v_import_run_id is null then
        insert into public.checklist_import_runs(
          release_id, source_file_id, checklist_version_id, importer_name, importer_version,
          status, source_row_count, started_at, summary
        ) values (
          v_release_id, v_source_file_id, v_version_id, p_plan->>'adapterId', p_plan->>'adapterVersion',
          'running', coalesce((v_expected->>'cards')::integer,0), now(),
          jsonb_build_object('schema',p_plan->>'schema','staged',true,'expectedCounts',v_expected)
        ) returning id into v_import_run_id;
      end if;
      return jsonb_build_object(
        'ok',true,'complete',false,'resumed',true,'releaseId',v_release_id,
        'sourceFileId',v_source_file_id,'versionId',v_version_id,'importRunId',v_import_run_id,
        'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities)
      );
    end if;

    if v_version_status = 'importing' and v_sets = 0 and v_cards = 0 and v_parallels = 0 and v_identities = 0 then
      update public.checklist_versions
      set source_row_count = coalesce((v_expected->>'cards')::integer,0),
          metadata = metadata || jsonb_build_object('stagedImport',true,'expectedCounts',v_expected,'importPlanSchema',p_plan->>'schema')
      where id = v_version_id;
      select id into v_import_run_id
      from public.checklist_import_runs
      where checklist_version_id = v_version_id and status in ('running','partial')
      order by created_at desc limit 1;
      if v_import_run_id is null then
        insert into public.checklist_import_runs(
          release_id, source_file_id, checklist_version_id, importer_name, importer_version,
          status, source_row_count, started_at, summary
        ) values (
          v_release_id, v_source_file_id, v_version_id, p_plan->>'adapterId', p_plan->>'adapterVersion',
          'running', coalesce((v_expected->>'cards')::integer,0), now(),
          jsonb_build_object('schema',p_plan->>'schema','staged',true,'expectedCounts',v_expected)
        ) returning id into v_import_run_id;
      end if;
      return jsonb_build_object(
        'ok',true,'complete',false,'adopted',true,'releaseId',v_release_id,
        'sourceFileId',v_source_file_id,'versionId',v_version_id,'importRunId',v_import_run_id,
        'counts',jsonb_build_object('sets',0,'cards',0,'parallels',0,'identities',0)
      );
    end if;

    raise exception 'Existing Checklist Registry version is not safely resumable (status %, active %)', v_version_status, v_version_active;
  end if;

  select id into v_previous_version_id
  from public.checklist_versions
  where release_id = v_release_id and is_active
  limit 1;

  select coalesce(max(version_number),0) + 1 into v_version_number
  from public.checklist_versions where release_id = v_release_id;

  insert into public.checklist_versions(
    release_id, source_file_id, previous_version_id, version_number, parser_version,
    normalized_schema_version, status, source_row_count, notes, metadata
  ) values (
    v_release_id, v_source_file_id, v_previous_version_id, v_version_number,
    p_plan->>'adapterVersion', 'tcos.checklist.normalized.v1', 'importing',
    coalesce((v_expected->>'cards')::integer,0), 'Staged chunk-safe Checklist Registry import',
    jsonb_build_object('adapterId',p_plan->>'adapterId','stagedImport',true,'expectedCounts',v_expected,'importPlanSchema',p_plan->>'schema')
  ) returning id into v_version_id;

  insert into public.checklist_import_runs(
    release_id, source_file_id, checklist_version_id, importer_name, importer_version,
    status, source_row_count, started_at, summary
  ) values (
    v_release_id, v_source_file_id, v_version_id, p_plan->>'adapterId', p_plan->>'adapterVersion',
    'running', coalesce((v_expected->>'cards')::integer,0), now(),
    jsonb_build_object('schema',p_plan->>'schema','staged',true,'expectedCounts',v_expected)
  ) returning id into v_import_run_id;

  return jsonb_build_object(
    'ok',true,'complete',false,'idempotent',false,'releaseId',v_release_id,
    'sourceFileId',v_source_file_id,'versionId',v_version_id,'importRunId',v_import_run_id,
    'counts',jsonb_build_object('sets',0,'cards',0,'parallels',0,'identities',0)
  );
end;
$$;

create or replace function public.tcos_append_checklist_import_chunk(
  p_version_id uuid,
  p_sets jsonb,
  p_cards jsonb,
  p_parallels jsonb,
  p_identities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '25s'
set lock_timeout = '10s'
as $$
declare
  v_release_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_status text;
  v_staged boolean;
  v_missing integer := 0;
  v_sets integer := 0;
  v_cards integer := 0;
  v_parallels integer := 0;
  v_identities integer := 0;
begin
  p_sets := coalesce(p_sets,'[]'::jsonb);
  p_cards := coalesce(p_cards,'[]'::jsonb);
  p_parallels := coalesce(p_parallels,'[]'::jsonb);
  p_identities := coalesce(p_identities,'[]'::jsonb);

  select v.release_id, v.status, coalesce((v.metadata->>'stagedImport')::boolean,false), r.sport_id, r.league_id
  into v_release_id, v_status, v_staged, v_sport_id, v_league_id
  from public.checklist_versions v
  join public.checklist_releases r on r.id = v.release_id
  where v.id = p_version_id
  for update of v;

  if v_release_id is null then raise exception 'Unknown Checklist Registry version'; end if;
  if v_status <> 'importing' or not v_staged then
    raise exception 'Checklist Registry version is not an active staged import';
  end if;

  if jsonb_array_length(p_sets) > 0 then
    insert into public.checklist_sets(release_id,version_id,name,normalized_name,set_type,metadata)
    select v_release_id, p_version_id, x."name",
           coalesce(nullif(x."normalizedName",''),public.tcos_checklist_normalized_name(x."name")),
           coalesce(nullif(x."setType",''),'other'), jsonb_build_object('sourceKey',x."sourceKey")
    from jsonb_to_recordset(p_sets) as x("sourceKey" text,"name" text,"normalizedName" text,"setType" text)
    on conflict do nothing;

    select count(*) into v_missing
    from jsonb_to_recordset(p_sets) as x("sourceKey" text,"name" text,"normalizedName" text,"setType" text)
    where not exists (
      select 1 from public.checklist_sets s
      where s.version_id=p_version_id and s.metadata->>'sourceKey'=x."sourceKey"
    );
    if v_missing > 0 then raise exception 'Checklist set chunk left % source keys unmapped', v_missing; end if;
  end if;

  if jsonb_array_length(p_cards) > 0 then
    select count(*) into v_missing
    from jsonb_to_recordset(p_cards) as x("sourceKey" text,"setSourceKey" text,"cardNumber" text,players jsonb,teams jsonb,"rookieDesignation" boolean,"firstBowmanDesignation" boolean,"autographStatus" text,"memorabiliaStatus" text,variation text,"sourceNotes" text)
    where not exists (
      select 1 from public.checklist_sets s
      where s.version_id=p_version_id and s.metadata->>'sourceKey'=x."setSourceKey"
    );
    if v_missing > 0 then raise exception 'Checklist card chunk references % unknown set source keys', v_missing; end if;

    insert into public.checklist_cards(
      release_id,version_id,set_id,card_number,normalized_card_number,rookie_designation,
      first_bowman_designation,autograph_status,memorabilia_status,variation,normalized_variation,
      checklist_notes,metadata
    )
    select v_release_id,p_version_id,s.id,x."cardNumber",
           regexp_replace(lower(x."cardNumber"),'[^[:alnum:]/]+','','g'),
           x."rookieDesignation",x."firstBowmanDesignation",
           coalesce(nullif(x."autographStatus",''),'non-auto'),
           coalesce(nullif(x."memorabiliaStatus",''),'non-memorabilia'),
           nullif(x.variation,''),public.tcos_checklist_normalized_name(x.variation),
           nullif(x."sourceNotes",''),jsonb_build_object('sourceKey',x."sourceKey")
    from jsonb_to_recordset(p_cards) as x("sourceKey" text,"setSourceKey" text,"cardNumber" text,players jsonb,teams jsonb,"rookieDesignation" boolean,"firstBowmanDesignation" boolean,"autographStatus" text,"memorabiliaStatus" text,variation text,"sourceNotes" text)
    join public.checklist_sets s on s.version_id=p_version_id and s.metadata->>'sourceKey'=x."setSourceKey"
    on conflict do nothing;

    select count(*) into v_missing
    from jsonb_to_recordset(p_cards) as x("sourceKey" text,"setSourceKey" text,"cardNumber" text,players jsonb,teams jsonb,"rookieDesignation" boolean,"firstBowmanDesignation" boolean,"autographStatus" text,"memorabiliaStatus" text,variation text,"sourceNotes" text)
    where not exists (
      select 1 from public.checklist_cards c
      where c.version_id=p_version_id and c.metadata->>'sourceKey'=x."sourceKey"
    );
    if v_missing > 0 then raise exception 'Checklist card chunk left % source keys unmapped', v_missing; end if;

    with input_cards as (
      select * from jsonb_to_recordset(p_cards) as x("sourceKey" text,players jsonb)
    ), player_input as (
      select distinct p.value as canonical_name, public.tcos_checklist_normalized_name(p.value) as normalized_name
      from input_cards c
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.players)='array' then c.players else '[]'::jsonb end) p(value)
    )
    insert into public.checklist_players(canonical_name,normalized_name)
    select canonical_name,normalized_name from player_input where normalized_name is not null
    on conflict do nothing;

    with input_cards as (
      select * from jsonb_to_recordset(p_cards) as x("sourceKey" text,players jsonb)
    ), player_input as (
      select c."sourceKey", p.value as canonical_name, public.tcos_checklist_normalized_name(p.value) as normalized_name, p.ordinality::integer as display_order
      from input_cards c
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.players)='array' then c.players else '[]'::jsonb end) with ordinality p(value,ordinality)
    )
    insert into public.checklist_card_players(card_id,player_id,display_order,role)
    select c.id,p.id,i.display_order,'subject'
    from player_input i
    join public.checklist_cards c on c.version_id=p_version_id and c.metadata->>'sourceKey'=i."sourceKey"
    join public.checklist_players p on p.normalized_name=i.normalized_name and p.birth_date is null
    where i.normalized_name is not null
    on conflict do nothing;

    with input_cards as (
      select * from jsonb_to_recordset(p_cards) as x("sourceKey" text,teams jsonb)
    ), team_input as (
      select distinct t.value as canonical_name, public.tcos_checklist_normalized_name(t.value) as normalized_name
      from input_cards c
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.teams)='array' then c.teams else '[]'::jsonb end) t(value)
    )
    insert into public.checklist_teams(sport_id,league_id,canonical_name,normalized_name)
    select v_sport_id,v_league_id,canonical_name,normalized_name from team_input where normalized_name is not null
    on conflict do nothing;

    with input_cards as (
      select * from jsonb_to_recordset(p_cards) as x("sourceKey" text,teams jsonb)
    ), team_input as (
      select c."sourceKey", t.value as canonical_name, public.tcos_checklist_normalized_name(t.value) as normalized_name, t.ordinality::integer as display_order
      from input_cards c
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.teams)='array' then c.teams else '[]'::jsonb end) with ordinality t(value,ordinality)
    )
    insert into public.checklist_card_teams(card_id,team_id,display_order,role)
    select c.id,t.id,i.display_order,'card_branding'
    from team_input i
    join public.checklist_cards c on c.version_id=p_version_id and c.metadata->>'sourceKey'=i."sourceKey"
    join public.checklist_teams t on t.sport_id=v_sport_id and t.league_id is not distinct from v_league_id and t.normalized_name=i.normalized_name
    where i.normalized_name is not null
    on conflict do nothing;
  end if;

  if jsonb_array_length(p_parallels) > 0 then
    select count(*) into v_missing
    from jsonb_to_recordset(p_parallels) as x("sourceKey" text,"setSourceKey" text,"name" text,"serialRun" integer,"configurationExclusivity" text)
    where not exists (
      select 1 from public.checklist_sets s
      where s.version_id=p_version_id and s.metadata->>'sourceKey'=x."setSourceKey"
    );
    if v_missing > 0 then raise exception 'Checklist parallel chunk references % unknown set source keys', v_missing; end if;

    insert into public.checklist_parallels(
      release_id,version_id,set_id,name,normalized_name,serial_run,configuration_exclusivity,is_base,metadata
    )
    select v_release_id,p_version_id,s.id,x."name",public.tcos_checklist_normalized_name(x."name"),
           x."serialRun",nullif(x."configurationExclusivity",''),false,jsonb_build_object('sourceKey',x."sourceKey")
    from jsonb_to_recordset(p_parallels) as x("sourceKey" text,"setSourceKey" text,"name" text,"serialRun" integer,"configurationExclusivity" text)
    join public.checklist_sets s on s.version_id=p_version_id and s.metadata->>'sourceKey'=x."setSourceKey"
    on conflict do nothing;

    select count(*) into v_missing
    from jsonb_to_recordset(p_parallels) as x("sourceKey" text,"setSourceKey" text,"name" text,"serialRun" integer,"configurationExclusivity" text)
    where not exists (
      select 1 from public.checklist_parallels p
      where p.version_id=p_version_id and p.metadata->>'sourceKey'=x."sourceKey"
    );
    if v_missing > 0 then raise exception 'Checklist parallel chunk left % source keys unmapped', v_missing; end if;
  end if;

  if jsonb_array_length(p_identities) > 0 then
    select count(*) into v_missing
    from jsonb_to_recordset(p_identities) as x("cardSourceKey" text,"parallelSourceKey" text,fingerprint jsonb)
    where not exists (
      select 1 from public.checklist_cards c
      where c.version_id=p_version_id and c.metadata->>'sourceKey'=x."cardSourceKey"
    ) or (
      nullif(x."parallelSourceKey",'') is not null and not exists (
        select 1 from public.checklist_parallels p
        where p.version_id=p_version_id and p.metadata->>'sourceKey'=x."parallelSourceKey"
      )
    );
    if v_missing > 0 then raise exception 'Checklist identity chunk has % unresolved card/parallel source keys', v_missing; end if;

    insert into public.checklist_card_identities(
      release_id,version_id,set_id,card_id,parallel_id,identity_schema,canonical_key,
      fingerprint_sha256,serial_number_tier,autograph_status,memorabilia_status,variation,
      configuration_exclusivity,metadata
    )
    select v_release_id,p_version_id,c.set_id,c.id,p.id,
           coalesce(nullif(x.fingerprint->>'schema',''),'tcos.checklist.identity.v1'),
           x.fingerprint->>'canonicalKey',x.fingerprint->>'fingerprintSha256',
           nullif(x.fingerprint #>> '{normalized,serialRun}',''),
           coalesce(nullif(x.fingerprint #>> '{normalized,autographStatus}',''),'non-auto'),
           coalesce(nullif(x.fingerprint #>> '{normalized,memorabiliaStatus}',''),'non-memorabilia'),
           nullif(x.fingerprint #>> '{normalized,variation}',''),
           nullif(x.fingerprint #>> '{normalized,configurationExclusivity}',''),
           jsonb_build_object(
             'players',coalesce(x.fingerprint #> '{normalized,players}','[]'::jsonb),
             'teams',coalesce(x.fingerprint #> '{normalized,teams}','[]'::jsonb),
             'parallel',x.fingerprint #>> '{normalized,parallel}'
           )
    from jsonb_to_recordset(p_identities) as x("cardSourceKey" text,"parallelSourceKey" text,fingerprint jsonb)
    join public.checklist_cards c on c.version_id=p_version_id and c.metadata->>'sourceKey'=x."cardSourceKey"
    left join public.checklist_parallels p on nullif(x."parallelSourceKey",'') is not null and p.version_id=p_version_id and p.metadata->>'sourceKey'=x."parallelSourceKey"
    on conflict do nothing;

    select count(*) into v_missing
    from jsonb_to_recordset(p_identities) as x("cardSourceKey" text,"parallelSourceKey" text,fingerprint jsonb)
    where not exists (
      select 1 from public.checklist_card_identities i
      where i.version_id=p_version_id
        and i.identity_schema=coalesce(nullif(x.fingerprint->>'schema',''),'tcos.checklist.identity.v1')
        and i.fingerprint_sha256=x.fingerprint->>'fingerprintSha256'
    );
    if v_missing > 0 then raise exception 'Checklist identity chunk left % fingerprints unmapped in staged version', v_missing; end if;
  end if;

  select count(*) into v_sets from public.checklist_sets where version_id=p_version_id;
  select count(*) into v_cards from public.checklist_cards where version_id=p_version_id;
  select count(*) into v_parallels from public.checklist_parallels where version_id=p_version_id;
  select count(*) into v_identities from public.checklist_card_identities where version_id=p_version_id;

  update public.checklist_import_runs
  set status='running', imported_row_count=v_cards,
      summary=summary || jsonb_build_object('currentCounts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities))
  where id=(select id from public.checklist_import_runs where checklist_version_id=p_version_id order by created_at desc limit 1);

  return jsonb_build_object('ok',true,'versionId',p_version_id,'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities));
end;
$$;

create or replace function public.tcos_finalize_checklist_import_plan(
  p_version_id uuid,
  p_expected_sets integer,
  p_expected_cards integer,
  p_expected_parallels integer,
  p_expected_identities integer,
  p_validation_issues jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '25s'
set lock_timeout = '10s'
as $$
declare
  v_release_id uuid;
  v_source_file_id uuid;
  v_release_source_id uuid;
  v_previous_version_id uuid;
  v_status text;
  v_active boolean;
  v_sets integer;
  v_cards integer;
  v_parallels integer;
  v_identities integer;
  v_issue jsonb;
begin
  p_validation_issues := coalesce(p_validation_issues,'[]'::jsonb);
  select v.release_id,v.source_file_id,v.previous_version_id,v.status,v.is_active,sf.release_source_id
  into v_release_id,v_source_file_id,v_previous_version_id,v_status,v_active,v_release_source_id
  from public.checklist_versions v
  join public.checklist_source_files sf on sf.id=v.source_file_id
  where v.id=p_version_id
  for update of v;

  if v_release_id is null then raise exception 'Unknown Checklist Registry version'; end if;

  select count(*) into v_sets from public.checklist_sets where version_id=p_version_id;
  select count(*) into v_cards from public.checklist_cards where version_id=p_version_id;
  select count(*) into v_parallels from public.checklist_parallels where version_id=p_version_id;
  select count(*) into v_identities from public.checklist_card_identities where version_id=p_version_id;

  if v_sets<>p_expected_sets or v_cards<>p_expected_cards or v_parallels<>p_expected_parallels or v_identities<>p_expected_identities then
    return jsonb_build_object(
      'ok',false,'status','incomplete','versionId',p_version_id,
      'expected',jsonb_build_object('sets',p_expected_sets,'cards',p_expected_cards,'parallels',p_expected_parallels,'identities',p_expected_identities),
      'actual',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities)
    );
  end if;

  if v_active and v_status in ('live','revised') then
    return jsonb_build_object('ok',true,'status','live','idempotent',true,'releaseId',v_release_id,'sourceFileId',v_source_file_id,'versionId',p_version_id,'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities));
  end if;
  if v_status <> 'importing' then raise exception 'Checklist Registry staged version cannot be finalized from status %', v_status; end if;

  for v_issue in select value from jsonb_array_elements(p_validation_issues)
  loop
    insert into public.checklist_validation_queue(release_id,checklist_version_id,issue_type,severity,status,reason,evidence)
    values (
      v_release_id,p_version_id,coalesce(nullif(v_issue->>'code',''),'import_notice'),
      case when v_issue->>'severity'='error' then 'high' else 'low' end,
      case when v_issue->>'severity'='error' then 'open' else 'dismissed' end,
      coalesce(nullif(v_issue->>'message',''),'Checklist import notice'),
      jsonb_build_object('rowReference',v_issue->>'rowReference')
    );
  end loop;

  if exists (select 1 from jsonb_array_elements(p_validation_issues) q(value) where q.value->>'severity'='error') then
    raise exception 'Passed staged import unexpectedly contains validation errors';
  end if;

  update public.checklist_versions
  set is_active=false,status='superseded'
  where release_id=v_release_id and is_active and id<>p_version_id;

  update public.checklist_versions
  set status='live',normalized_card_count=v_cards,normalized_identity_count=v_identities,
      imported_at=now(),validated_at=now(),activated_at=now(),is_active=true,
      metadata=metadata || jsonb_build_object('stagedImportComplete',true,'completedCounts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities))
  where id=p_version_id;

  update public.checklist_source_files
  set import_status='successful',validation_status='passed'
  where id=v_source_file_id;

  update public.checklist_import_runs
  set status='successful',imported_row_count=v_cards,skipped_row_count=0,error_count=0,finished_at=now(),
      summary=summary || jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities,'validationIssues',jsonb_array_length(p_validation_issues),'stagedComplete',true)
  where id=(select id from public.checklist_import_runs where checklist_version_id=p_version_id order by created_at desc limit 1);

  update public.checklist_releases
  set checklist_status='live',import_status='successful',last_successful_check_at=now(),last_checked_at=now()
  where id=v_release_id;

  insert into public.checklist_release_status_events(release_id,release_source_id,status_domain,previous_status,new_status,reason,source_snapshot)
  values (v_release_id,v_release_source_id,'import','importing','successful','Staged chunk-safe Checklist Registry import completed',jsonb_build_object('sourceFileId',v_source_file_id,'versionId',p_version_id));

  return jsonb_build_object('ok',true,'status','live','idempotent',false,'releaseId',v_release_id,'sourceFileId',v_source_file_id,'versionId',p_version_id,'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities));
end;
$$;

revoke all on function public.tcos_begin_checklist_import_plan(jsonb,text,text,bigint,text,text,text) from public, anon, authenticated;
revoke all on function public.tcos_append_checklist_import_chunk(uuid,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.tcos_finalize_checklist_import_plan(uuid,integer,integer,integer,integer,jsonb) from public, anon, authenticated;
grant execute on function public.tcos_begin_checklist_import_plan(jsonb,text,text,bigint,text,text,text) to service_role;
grant execute on function public.tcos_append_checklist_import_chunk(uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.tcos_finalize_checklist_import_plan(uuid,integer,integer,integer,integer,jsonb) to service_role;
