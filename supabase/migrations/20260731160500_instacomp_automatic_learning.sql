-- InstaComp automatic learning bridge.
-- Every saved scan becomes a non-ownership knowledge observation. Operator or
-- official-checklist confirmation promotes exact identities without allowing
-- repeated unreviewed AI guesses to become trusted on their own.

create extension if not exists pgcrypto;

alter table if exists public.tcos_card_knowledge_entries
  add column if not exists observation_count integer not null default 0,
  add column if not exists scanner_observed_count integer not null default 0,
  add column if not exists catalog_confirmed_count integer not null default 0,
  add column if not exists last_observed_at timestamptz,
  add column if not exists latest_submitted_by_account_id uuid,
  add column if not exists latest_submitted_by_actor_type text,
  add column if not exists latest_submitted_at timestamptz;

alter table if exists public.tcos_card_knowledge_observations
  add column if not exists observation_key text,
  add column if not exists observation_confidence numeric,
  add column if not exists submitted_by_account_id uuid,
  add column if not exists submitted_by_actor_type text,
  add column if not exists submitted_store_id uuid;

alter table if exists public.instacomp_scans
  add column if not exists front_image_sha256 text,
  add column if not exists back_image_sha256 text;

do $$
begin
  if to_regclass('public.tcos_card_knowledge_observations') is not null then
    update public.tcos_card_knowledge_observations
    set observation_key = coalesce(
      observation_key,
      case
        when source_scan_item_id is not null then 'job-item:' || source_scan_item_id::text
        when source_scan_id is not null then 'scan:' || source_scan_id
        else 'legacy:' || id::text
      end
    )
    where observation_key is null;

    alter table public.tcos_card_knowledge_observations
      alter column observation_key set not null;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.tcos_card_knowledge_observations'::regclass
        and conname = 'tcos_card_knowledge_observations_key_unique'
    ) then
      alter table public.tcos_card_knowledge_observations
        add constraint tcos_card_knowledge_observations_key_unique
        unique (observation_key);
    end if;

    alter table public.tcos_card_knowledge_observations
      drop constraint if exists tcos_card_knowledge_observations_status_check;
    alter table public.tcos_card_knowledge_observations
      add constraint tcos_card_knowledge_observations_status_check
      check (
        confirmation_status in (
          'operator_confirmed',
          'catalog_confirmed',
          'scanner_observed',
          'cache_replay',
          'operator_rejected',
          'needs_more_info'
        )
      );
  end if;
end;
$$;

create index if not exists tcos_card_knowledge_observations_scan_id_idx
  on public.tcos_card_knowledge_observations(source_scan_id)
  where source_scan_id is not null;

create index if not exists tcos_card_knowledge_observations_hash_idx
  on public.tcos_card_knowledge_observations(front_image_sha256, back_image_sha256)
  where front_image_sha256 is not null;

create index if not exists tcos_card_knowledge_entries_faster_lookup_idx
  on public.tcos_card_knowledge_entries(
    trust_status,
    year,
    brand,
    set_name,
    card_number,
    player,
    parallel,
    last_observed_at desc
  );

create table if not exists public.instacomp_scan_knowledge_cache (
  id uuid primary key default gen_random_uuid(),
  image_fingerprint text not null unique,
  scan_id text,
  knowledge_entry_id uuid references public.tcos_card_knowledge_entries(id) on delete set null,
  front_image_sha256 text not null,
  back_image_sha256 text,
  response_payload jsonb not null default '{}'::jsonb,
  identity_confidence numeric,
  trusted_for_pricing boolean not null default false,
  confirmation_status text not null default 'scanner_observed'
    check (
      confirmation_status in (
        'operator_confirmed',
        'catalog_confirmed',
        'scanner_observed',
        'operator_rejected',
        'needs_more_info'
      )
    ),
  submitted_by_account_id uuid,
  submitted_by_actor_type text,
  submitted_store_id uuid,
  observed_at timestamptz not null default now(),
  market_expires_at timestamptz not null default (now() + interval '6 hours'),
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instacomp_scan_knowledge_cache_front_hash_check
    check (front_image_sha256 ~ '^[a-f0-9]{64}$'),
  constraint instacomp_scan_knowledge_cache_back_hash_check
    check (back_image_sha256 is null or back_image_sha256 ~ '^[a-f0-9]{64}$'),
  constraint instacomp_scan_knowledge_cache_payload_check
    check (jsonb_typeof(response_payload) = 'object')
);

create index if not exists instacomp_scan_knowledge_cache_hash_idx
  on public.instacomp_scan_knowledge_cache(front_image_sha256, back_image_sha256, market_expires_at desc);

create index if not exists instacomp_scan_knowledge_cache_entry_idx
  on public.instacomp_scan_knowledge_cache(knowledge_entry_id, updated_at desc)
  where knowledge_entry_id is not null;

drop trigger if exists instacomp_scan_knowledge_cache_touch on public.instacomp_scan_knowledge_cache;
create trigger instacomp_scan_knowledge_cache_touch
before update on public.instacomp_scan_knowledge_cache
for each row execute function public.tcos_touch_instacomp_scan_updated_at();

alter table public.instacomp_scan_knowledge_cache enable row level security;
revoke all privileges on table public.instacomp_scan_knowledge_cache
  from anon, authenticated, service_role;
grant select, insert, update, delete on table public.instacomp_scan_knowledge_cache
  to service_role;

create or replace function public.tcos_instacomp_knowledge_normalize(
  p_value text,
  p_card_number boolean default false
)
returns text
language sql
immutable
as $$
  select nullif(
    case
      when p_card_number then regexp_replace(
        lower(btrim(coalesce(p_value, ''))),
        '[^[:alnum:]/]+',
        '',
        'g'
      )
      else regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_value, ''))), '&', ' and ', 'g'),
        '[^[:alnum:]/]+',
        '-',
        'g'
      )
    end,
    ''
  );
$$;

create or replace function public.tcos_instacomp_knowledge_serial_run(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_match text[];
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  v_match := regexp_match(lower(p_value), '/\s*(\d{1,7})(?:\D|$)');
  if v_match is null then
    return null;
  end if;
  return '/' || (v_match[1]::integer)::text;
exception when others then
  return null;
end;
$$;

create or replace function public.tcos_instacomp_knowledge_fingerprint(p_ai jsonb)
returns text
language sql
immutable
as $$
  select concat_ws('|',
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'year'), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'brand'), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'setName'), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'cardNumber', true), 'unknown'),
    coalesce(public.tcos_instacomp_knowledge_normalize(p_ai->>'player'), 'unknown'),
    coalesce(
      public.tcos_instacomp_knowledge_normalize(
        coalesce(nullif(p_ai->>'parallel', ''), nullif(p_ai->>'variation', ''))
      ),
      'base'
    ),
    coalesce(public.tcos_instacomp_knowledge_normalize(
      public.tcos_instacomp_knowledge_serial_run(p_ai->>'serialNumber')
    ), 'unknown')
  );
$$;

create or replace function public.tcos_instacomp_knowledge_title(p_ai jsonb)
returns text
language sql
immutable
as $$
  select left(
    coalesce(
      nullif(
        concat_ws(' ',
          nullif(btrim(p_ai->>'year'), ''),
          nullif(btrim(p_ai->>'brand'), ''),
          nullif(btrim(p_ai->>'setName'), ''),
          nullif(btrim(p_ai->>'player'), ''),
          nullif(btrim(p_ai->>'parallel'), ''),
          case when nullif(btrim(p_ai->>'cardNumber'), '') is not null
            then '#' || btrim(p_ai->>'cardNumber') else null end,
          case when nullif(btrim(p_ai->>'serialNumber'), '') is not null
            then btrim(p_ai->>'serialNumber') else null end
        ),
        ''
      ),
      'InstaComp observed card'
    ),
    500
  );
$$;

create or replace function public.tcos_instacomp_refresh_knowledge_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_observation_count integer := 0;
  v_scanner_count integer := 0;
  v_operator_count integer := 0;
  v_catalog_count integer := 0;
  v_last_observed timestamptz;
  v_status text;
  v_row public.tcos_card_knowledge_entries%rowtype;
begin
  select
    count(*)::integer,
    count(*) filter (where confirmation_status in ('scanner_observed','cache_replay'))::integer,
    count(*) filter (where confirmation_status = 'operator_confirmed')::integer,
    count(*) filter (where confirmation_status = 'catalog_confirmed')::integer,
    max(observed_at)
  into
    v_observation_count,
    v_scanner_count,
    v_operator_count,
    v_catalog_count,
    v_last_observed
  from public.tcos_card_knowledge_observations
  where knowledge_entry_id = p_entry_id
    and confirmation_status <> 'operator_rejected';

  v_status := case
    when v_catalog_count >= 1 or v_operator_count >= 3 then 'tcos_trusted'
    when exists (
      select 1 from public.tcos_card_knowledge_observations
      where knowledge_entry_id = p_entry_id
        and confirmation_status in ('operator_rejected','needs_more_info')
    ) then 'needs_review'
    else 'learning'
  end;

  update public.tcos_card_knowledge_entries
  set observation_count = v_observation_count,
      scanner_observed_count = v_scanner_count,
      catalog_confirmed_count = v_catalog_count,
      confirmed_count = v_operator_count + v_catalog_count,
      trust_status = v_status,
      trusted_at = case when v_status = 'tcos_trusted'
        then coalesce(trusted_at, now()) else null end,
      last_seen_at = coalesce(v_last_observed, last_seen_at),
      last_observed_at = v_last_observed
  where id = p_entry_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'identityFingerprint', v_row.identity_fingerprint,
    'title', v_row.title,
    'trustStatus', v_row.trust_status,
    'confirmedCount', v_row.confirmed_count,
    'observationCount', v_row.observation_count,
    'scannerObservedCount', v_row.scanner_observed_count,
    'catalogConfirmedCount', v_row.catalog_confirmed_count,
    'lastObservedAt', v_row.last_observed_at
  );
end;
$$;

create or replace function public.tcos_instacomp_record_scan_knowledge_payload(p_scan jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scan_id text := nullif(p_scan->>'id', '');
  v_ai jsonb;
  v_raw jsonb;
  v_fingerprint text;
  v_title text;
  v_entry_id uuid;
  v_confirmation text := 'scanner_observed';
  v_confidence numeric;
  v_result_payload jsonb;
begin
  if v_scan_id is null then
    return null;
  end if;

  v_ai := jsonb_strip_nulls(
    jsonb_build_object(
      'player', p_scan->>'player',
      'year', p_scan->>'year',
      'brand', p_scan->>'brand',
      'setName', p_scan->>'set_name',
      'cardNumber', p_scan->>'card_number',
      'parallel', p_scan->>'parallel',
      'confidence', p_scan->'confidence'
    ) || coalesce(p_scan->'raw_ai_result', '{}'::jsonb)
  );
  v_raw := coalesce(p_scan->'raw_comp_results', '{}'::jsonb);
  v_fingerprint := public.tcos_instacomp_knowledge_fingerprint(v_ai);
  v_title := public.tcos_instacomp_knowledge_title(v_ai);

  if coalesce(v_raw #>> '{catalogEvidence,status}', '') = 'catalog_confirmed'
     or coalesce(v_raw #>> '{catalogEvidence,catalogConfirmed}', '') = 'true' then
    v_confirmation := 'catalog_confirmed';
  end if;

  begin
    v_confidence := nullif(v_ai->>'confidence', '')::numeric;
  exception when others then
    v_confidence := null;
  end;

  v_result_payload := jsonb_build_object(
    'ok', true,
    'scanId', v_scan_id,
    'ai', v_ai,
    'searchQuery', p_scan->>'search_query',
    'stats', jsonb_build_object('suggestedPrice', p_scan->'suggested_price'),
    'soldStats', coalesce(v_raw->'soldStats', '{}'::jsonb),
    'providers', coalesce(v_raw->'providers', '[]'::jsonb),
    'sourceCoverage', coalesce(v_raw->'sourceCoverage', '[]'::jsonb),
    'activeComps', coalesce(v_raw->'allResults', '[]'::jsonb),
    'marketValueComps', coalesce(v_raw->'marketValueComps', '[]'::jsonb),
    'soldComps', coalesce(v_raw->'soldComps', '[]'::jsonb),
    'remainingCards', coalesce(v_raw->'remainingCards', '[]'::jsonb),
    'links', coalesce(v_raw->'sourceLinks', '{}'::jsonb),
    'catalogEvidence', coalesce(v_raw->'catalogEvidence', '{}'::jsonb),
    'note', 'Recovered from the permanent InstaComp scan ledger.'
  );

  insert into public.tcos_card_knowledge_entries (
    identity_fingerprint,
    title,
    year,
    brand,
    set_name,
    card_number,
    player,
    parallel,
    variation,
    serial_run,
    serial_number,
    team,
    sport,
    is_rookie,
    is_auto,
    is_relic,
    latest_scan_id,
    front_image_sha256,
    back_image_sha256,
    ai_result,
    catalog_evidence,
    market_snapshot,
    source_coverage,
    result_payload,
    last_seen_at,
    last_observed_at
  ) values (
    v_fingerprint,
    v_title,
    nullif(v_ai->>'year', ''),
    nullif(v_ai->>'brand', ''),
    nullif(v_ai->>'setName', ''),
    nullif(v_ai->>'cardNumber', ''),
    nullif(v_ai->>'player', ''),
    nullif(v_ai->>'parallel', ''),
    nullif(v_ai->>'variation', ''),
    public.tcos_instacomp_knowledge_serial_run(v_ai->>'serialNumber'),
    nullif(v_ai->>'serialNumber', ''),
    nullif(v_ai->>'team', ''),
    nullif(v_ai->>'sport', ''),
    coalesce((v_ai->>'isRookie')::boolean, false),
    coalesce((v_ai->>'isAuto')::boolean, false),
    coalesce((v_ai->>'isRelic')::boolean, false),
    v_scan_id,
    nullif(p_scan->>'front_image_sha256', ''),
    nullif(p_scan->>'back_image_sha256', ''),
    v_ai,
    coalesce(v_raw->'catalogEvidence', '{}'::jsonb),
    jsonb_build_object(
      'stats', jsonb_build_object('suggestedPrice', p_scan->'suggested_price'),
      'soldStats', coalesce(v_raw->'soldStats', '{}'::jsonb)
    ),
    coalesce(v_raw->'sourceCoverage', '[]'::jsonb),
    v_result_payload,
    now(),
    now()
  )
  on conflict (identity_fingerprint) do update
  set title = excluded.title,
      year = coalesce(excluded.year, public.tcos_card_knowledge_entries.year),
      brand = coalesce(excluded.brand, public.tcos_card_knowledge_entries.brand),
      set_name = coalesce(excluded.set_name, public.tcos_card_knowledge_entries.set_name),
      card_number = coalesce(excluded.card_number, public.tcos_card_knowledge_entries.card_number),
      player = coalesce(excluded.player, public.tcos_card_knowledge_entries.player),
      parallel = coalesce(excluded.parallel, public.tcos_card_knowledge_entries.parallel),
      variation = coalesce(excluded.variation, public.tcos_card_knowledge_entries.variation),
      serial_run = coalesce(excluded.serial_run, public.tcos_card_knowledge_entries.serial_run),
      serial_number = coalesce(excluded.serial_number, public.tcos_card_knowledge_entries.serial_number),
      team = coalesce(excluded.team, public.tcos_card_knowledge_entries.team),
      sport = coalesce(excluded.sport, public.tcos_card_knowledge_entries.sport),
      is_rookie = excluded.is_rookie,
      is_auto = excluded.is_auto,
      is_relic = excluded.is_relic,
      latest_scan_id = excluded.latest_scan_id,
      front_image_sha256 = coalesce(excluded.front_image_sha256, public.tcos_card_knowledge_entries.front_image_sha256),
      back_image_sha256 = coalesce(excluded.back_image_sha256, public.tcos_card_knowledge_entries.back_image_sha256),
      ai_result = excluded.ai_result,
      catalog_evidence = excluded.catalog_evidence,
      market_snapshot = excluded.market_snapshot,
      source_coverage = excluded.source_coverage,
      result_payload = excluded.result_payload,
      last_seen_at = now(),
      last_observed_at = now()
  returning id into v_entry_id;

  insert into public.tcos_card_knowledge_observations (
    knowledge_entry_id,
    observation_key,
    source_scan_id,
    confirmation_status,
    title,
    front_image_sha256,
    back_image_sha256,
    observation_confidence,
    ai_result,
    catalog_evidence,
    consensus,
    result_payload,
    observed_at
  ) values (
    v_entry_id,
    'scan:' || v_scan_id,
    v_scan_id,
    v_confirmation,
    v_title,
    nullif(p_scan->>'front_image_sha256', ''),
    nullif(p_scan->>'back_image_sha256', ''),
    v_confidence,
    v_ai,
    coalesce(v_raw->'catalogEvidence', '{}'::jsonb),
    coalesce(v_raw->'consensus', '{}'::jsonb),
    v_result_payload,
    coalesce(nullif(p_scan->>'created_at', '')::timestamptz, now())
  )
  on conflict (observation_key) do update
  set knowledge_entry_id = excluded.knowledge_entry_id,
      confirmation_status = case
        when public.tcos_card_knowledge_observations.confirmation_status in ('operator_confirmed','operator_rejected','needs_more_info')
          then public.tcos_card_knowledge_observations.confirmation_status
        else excluded.confirmation_status
      end,
      title = excluded.title,
      front_image_sha256 = coalesce(excluded.front_image_sha256, public.tcos_card_knowledge_observations.front_image_sha256),
      back_image_sha256 = coalesce(excluded.back_image_sha256, public.tcos_card_knowledge_observations.back_image_sha256),
      observation_confidence = excluded.observation_confidence,
      ai_result = excluded.ai_result,
      catalog_evidence = excluded.catalog_evidence,
      consensus = excluded.consensus,
      result_payload = excluded.result_payload;

  perform public.tcos_instacomp_refresh_knowledge_entry(v_entry_id);
  return v_entry_id;
exception when invalid_text_representation then
  -- A malformed legacy boolean or timestamp should not block the scan itself.
  return null;
end;
$$;

create or replace function public.tcos_instacomp_scan_learning_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tcos_instacomp_record_scan_knowledge_payload(to_jsonb(new));
  return new;
exception when others then
  -- Learning is additive. It must never make a paid scan fail.
  raise warning 'InstaComp automatic learning skipped scan %: %', to_jsonb(new)->>'id', sqlerrm;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.instacomp_scans') is not null then
    execute 'drop trigger if exists instacomp_scans_auto_learning on public.instacomp_scans';
    execute 'create trigger instacomp_scans_auto_learning after insert on public.instacomp_scans for each row execute function public.tcos_instacomp_scan_learning_trigger()';
  end if;
end;
$$;

create or replace function public.tcos_instacomp_confirm_scan_knowledge(
  p_scan_id text,
  p_corrections jsonb default '{}'::jsonb,
  p_confirmation_status text default 'operator_confirmed'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scan jsonb;
  v_base_ai jsonb;
  v_ai jsonb;
  v_raw jsonb;
  v_old_entry_id uuid;
  v_new_entry_id uuid;
  v_fingerprint text;
  v_title text;
  v_result jsonb;
  v_cache_id uuid;
begin
  if p_confirmation_status not in ('operator_confirmed','operator_rejected','needs_more_info') then
    raise exception 'Unsupported confirmation status';
  end if;

  execute 'select to_jsonb(s) from public.instacomp_scans s where s.id::text = $1 limit 1'
    into v_scan using p_scan_id;
  if v_scan is null then
    raise exception 'InstaComp scan not found';
  end if;

  v_base_ai := jsonb_strip_nulls(
    jsonb_build_object(
      'player', v_scan->>'player',
      'year', v_scan->>'year',
      'brand', v_scan->>'brand',
      'setName', v_scan->>'set_name',
      'cardNumber', v_scan->>'card_number',
      'parallel', v_scan->>'parallel',
      'confidence', v_scan->'confidence'
    ) || coalesce(v_scan->'raw_ai_result', '{}'::jsonb)
  );
  v_ai := v_base_ai || jsonb_strip_nulls(jsonb_build_object(
    'player', p_corrections->'player',
    'year', p_corrections->'year',
    'brand', p_corrections->'brand',
    'setName', p_corrections->'setName',
    'cardNumber', p_corrections->'cardNumber',
    'parallel', p_corrections->'parallel',
    'variation', p_corrections->'variation',
    'serialNumber', p_corrections->'serialNumber',
    'team', p_corrections->'team',
    'sport', p_corrections->'sport',
    'conditionGuess', p_corrections->'conditionGuess',
    'isRookie', p_corrections->'isRookie',
    'isAuto', p_corrections->'isAuto',
    'isRelic', p_corrections->'isRelic'
  ));
  -- jsonb_build_object retains JSON nulls; strip them so blanks do not erase evidence.
  v_ai := jsonb_strip_nulls(v_ai);
  v_raw := coalesce(v_scan->'raw_comp_results', '{}'::jsonb);
  v_fingerprint := public.tcos_instacomp_knowledge_fingerprint(v_ai);
  v_title := public.tcos_instacomp_knowledge_title(v_ai);

  select knowledge_entry_id into v_old_entry_id
  from public.tcos_card_knowledge_observations
  where observation_key = 'scan:' || p_scan_id;

  v_result := jsonb_build_object(
    'ok', true,
    'scanId', p_scan_id,
    'ai', v_ai,
    'searchQuery', v_scan->>'search_query',
    'stats', jsonb_build_object('suggestedPrice', v_scan->'suggested_price'),
    'soldStats', coalesce(v_raw->'soldStats', '{}'::jsonb),
    'providers', coalesce(v_raw->'providers', '[]'::jsonb),
    'sourceCoverage', coalesce(v_raw->'sourceCoverage', '[]'::jsonb),
    'activeComps', coalesce(v_raw->'allResults', '[]'::jsonb),
    'marketValueComps', coalesce(v_raw->'marketValueComps', '[]'::jsonb),
    'soldComps', coalesce(v_raw->'soldComps', '[]'::jsonb),
    'remainingCards', coalesce(v_raw->'remainingCards', '[]'::jsonb),
    'links', coalesce(v_raw->'sourceLinks', '{}'::jsonb),
    'catalogEvidence', coalesce(v_raw->'catalogEvidence', '{}'::jsonb),
    'operatorCorrections', p_corrections
  );

  insert into public.tcos_card_knowledge_entries (
    identity_fingerprint, title, year, brand, set_name, card_number, player,
    parallel, variation, serial_run, serial_number, team, sport,
    is_rookie, is_auto, is_relic, latest_scan_id, ai_result,
    operator_corrections, catalog_evidence, market_snapshot, source_coverage,
    result_payload, last_seen_at, last_observed_at
  ) values (
    v_fingerprint, v_title, nullif(v_ai->>'year',''), nullif(v_ai->>'brand',''),
    nullif(v_ai->>'setName',''), nullif(v_ai->>'cardNumber',''),
    nullif(v_ai->>'player',''), nullif(v_ai->>'parallel',''),
    nullif(v_ai->>'variation',''), public.tcos_instacomp_knowledge_serial_run(v_ai->>'serialNumber'),
    nullif(v_ai->>'serialNumber',''), nullif(v_ai->>'team',''), nullif(v_ai->>'sport',''),
    coalesce((v_ai->>'isRookie')::boolean,false),
    coalesce((v_ai->>'isAuto')::boolean,false),
    coalesce((v_ai->>'isRelic')::boolean,false),
    p_scan_id, v_ai, p_corrections,
    coalesce(v_raw->'catalogEvidence','{}'::jsonb),
    jsonb_build_object('stats', v_result->'stats', 'soldStats', v_result->'soldStats'),
    coalesce(v_raw->'sourceCoverage','[]'::jsonb), v_result, now(), now()
  )
  on conflict (identity_fingerprint) do update
  set title = excluded.title,
      year = excluded.year,
      brand = excluded.brand,
      set_name = excluded.set_name,
      card_number = excluded.card_number,
      player = excluded.player,
      parallel = excluded.parallel,
      variation = excluded.variation,
      serial_run = excluded.serial_run,
      serial_number = excluded.serial_number,
      team = excluded.team,
      sport = excluded.sport,
      is_rookie = excluded.is_rookie,
      is_auto = excluded.is_auto,
      is_relic = excluded.is_relic,
      latest_scan_id = excluded.latest_scan_id,
      ai_result = excluded.ai_result,
      operator_corrections = excluded.operator_corrections,
      result_payload = excluded.result_payload,
      last_seen_at = now(),
      last_observed_at = now()
  returning id into v_new_entry_id;

  insert into public.tcos_card_knowledge_observations (
    knowledge_entry_id, observation_key, source_scan_id, confirmation_status,
    title, front_image_sha256, back_image_sha256, ai_result,
    operator_corrections, catalog_evidence, consensus, result_payload, observed_at
  ) values (
    v_new_entry_id, 'scan:' || p_scan_id, p_scan_id, p_confirmation_status,
    v_title, nullif(v_scan->>'front_image_sha256',''), nullif(v_scan->>'back_image_sha256',''),
    v_ai, p_corrections, coalesce(v_raw->'catalogEvidence','{}'::jsonb),
    coalesce(v_raw->'consensus','{}'::jsonb), v_result, now()
  )
  on conflict (observation_key) do update
  set knowledge_entry_id = excluded.knowledge_entry_id,
      confirmation_status = excluded.confirmation_status,
      title = excluded.title,
      front_image_sha256 = coalesce(excluded.front_image_sha256, public.tcos_card_knowledge_observations.front_image_sha256),
      back_image_sha256 = coalesce(excluded.back_image_sha256, public.tcos_card_knowledge_observations.back_image_sha256),
      ai_result = excluded.ai_result,
      operator_corrections = excluded.operator_corrections,
      catalog_evidence = excluded.catalog_evidence,
      consensus = excluded.consensus,
      result_payload = excluded.result_payload,
      observed_at = now();

  update public.instacomp_scan_knowledge_cache
  set knowledge_entry_id = v_new_entry_id,
      response_payload = v_result,
      confirmation_status = p_confirmation_status,
      updated_at = now()
  where scan_id = p_scan_id
  returning id into v_cache_id;

  if v_old_entry_id is not null and v_old_entry_id <> v_new_entry_id then
    perform public.tcos_instacomp_refresh_knowledge_entry(v_old_entry_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'scanId', p_scan_id,
    'cacheId', v_cache_id,
    'entry', public.tcos_instacomp_refresh_knowledge_entry(v_new_entry_id)
  );
end;
$$;

create or replace function public.tcos_instacomp_record_cache_replay(
  p_cache_id uuid,
  p_observation_key text,
  p_submitted_by_account_id uuid default null,
  p_submitted_by_actor_type text default null,
  p_submitted_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cache public.instacomp_scan_knowledge_cache%rowtype;
  v_entry jsonb;
begin
  select * into v_cache
  from public.instacomp_scan_knowledge_cache
  where id = p_cache_id;

  if v_cache.id is null or v_cache.knowledge_entry_id is null then
    raise exception 'InstaComp cache entry not found';
  end if;

  update public.instacomp_scan_knowledge_cache
  set hit_count = hit_count + 1,
      last_hit_at = now()
  where id = p_cache_id;

  insert into public.tcos_card_knowledge_observations (
    knowledge_entry_id,
    observation_key,
    source_scan_id,
    confirmation_status,
    title,
    front_image_sha256,
    back_image_sha256,
    observation_confidence,
    submitted_by_account_id,
    submitted_by_actor_type,
    submitted_store_id,
    ai_result,
    result_payload,
    observed_at
  ) values (
    v_cache.knowledge_entry_id,
    p_observation_key,
    v_cache.scan_id,
    'cache_replay',
    public.tcos_instacomp_knowledge_title(v_cache.response_payload->'ai'),
    v_cache.front_image_sha256,
    v_cache.back_image_sha256,
    v_cache.identity_confidence,
    p_submitted_by_account_id,
    p_submitted_by_actor_type,
    p_submitted_store_id,
    coalesce(v_cache.response_payload->'ai','{}'::jsonb),
    v_cache.response_payload,
    now()
  ) on conflict (observation_key) do nothing;

  v_entry := public.tcos_instacomp_refresh_knowledge_entry(v_cache.knowledge_entry_id);
  return jsonb_build_object('ok', true, 'entry', v_entry);
end;
$$;

revoke all on function public.tcos_instacomp_refresh_knowledge_entry(uuid) from public, anon, authenticated;
revoke all on function public.tcos_instacomp_record_scan_knowledge_payload(jsonb) from public, anon, authenticated;
revoke all on function public.tcos_instacomp_confirm_scan_knowledge(text,jsonb,text) from public, anon, authenticated;
revoke all on function public.tcos_instacomp_record_cache_replay(uuid,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.tcos_instacomp_refresh_knowledge_entry(uuid) to service_role;
grant execute on function public.tcos_instacomp_record_scan_knowledge_payload(jsonb) to service_role;
grant execute on function public.tcos_instacomp_confirm_scan_knowledge(text,jsonb,text) to service_role;
grant execute on function public.tcos_instacomp_record_cache_replay(uuid,text,uuid,text,uuid) to service_role;

-- Backfill the permanent knowledge ledger from scans already saved before this bridge.
do $$
declare
  v_scan jsonb;
begin
  if to_regclass('public.instacomp_scans') is not null then
    for v_scan in execute 'select to_jsonb(s) from public.instacomp_scans s order by s.created_at asc'
    loop
      perform public.tcos_instacomp_record_scan_knowledge_payload(v_scan);
    end loop;
  end if;
exception when others then
  raise warning 'InstaComp historical learning backfill stopped: %', sqlerrm;
end;
$$;
