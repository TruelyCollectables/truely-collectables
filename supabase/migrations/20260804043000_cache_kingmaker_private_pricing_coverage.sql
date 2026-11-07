-- Cache KINGMAKER private pricing coverage so the admin workspace reads a
-- bounded aggregate snapshot instead of rebuilding the entire gap analysis in
-- an interactive request. The snapshot contains no source documents, extracted
-- text, filenames, hashes, pricing values, or provider attribution.

begin;

create table if not exists public.tcos_kingmaker_private_pricing_coverage_snapshot (
  snapshot_key text primary key,
  sport_key text not null,
  sport text not null,
  period_key text not null,
  release_year text not null,
  manufacturer_key text not null,
  manufacturer text not null,
  product_key text not null,
  product text not null,
  set_key text not null,
  set_name text not null,
  unresolved_rows bigint not null check (unresolved_rows >= 0),
  unmatched_rows bigint not null check (unmatched_rows >= 0),
  ambiguous_rows bigint not null check (ambiguous_rows >= 0),
  distinct_card_numbers bigint not null check (distinct_card_numbers >= 0),
  guide_count integer not null check (guide_count >= 0),
  average_parse_confidence numeric,
  latest_reference_date date,
  registry_release_count integer not null check (registry_release_count >= 0),
  active_version_count integer not null check (active_version_count >= 0),
  matching_set_count integer not null check (matching_set_count >= 0),
  active_identity_count bigint not null check (active_identity_count >= 0),
  gap_type text not null
    check (gap_type in ('missing_release','checklist_pending','set_gap','identity_gap')),
  recommended_action text not null,
  search_text text not null,
  refreshed_at timestamptz not null
);

create index if not exists tcos_kingmaker_private_pricing_coverage_rank_idx
  on public.tcos_kingmaker_private_pricing_coverage_snapshot (
    unresolved_rows desc,
    gap_type,
    distinct_card_numbers desc
  );

create index if not exists tcos_kingmaker_private_pricing_coverage_filter_idx
  on public.tcos_kingmaker_private_pricing_coverage_snapshot (
    gap_type,
    sport_key
  );

create table if not exists public.tcos_kingmaker_private_pricing_coverage_state (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  dirty boolean not null default true,
  dirty_at timestamptz not null default now(),
  last_refresh_status text not null default 'pending'
    check (last_refresh_status in ('pending','refreshing','succeeded','failed')),
  last_refresh_started_at timestamptz,
  last_refreshed_at timestamptz,
  last_refresh_duration_ms integer,
  last_group_count bigint,
  last_unresolved_rows bigint,
  last_error_code text,
  updated_at timestamptz not null default now()
);

insert into public.tcos_kingmaker_private_pricing_coverage_state (
  singleton_id,
  dirty,
  dirty_at,
  last_refresh_status
)
values (1, true, now(), 'pending')
on conflict (singleton_id) do nothing;

create or replace function public.tcos_mark_kingmaker_private_pricing_coverage_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tcos_kingmaker_private_pricing_coverage_state
  set
    dirty = true,
    dirty_at = now(),
    updated_at = now()
  where singleton_id = 1;
  return null;
end;
$$;

revoke all on function public.tcos_mark_kingmaker_private_pricing_coverage_dirty()
  from public, anon, authenticated;

create or replace function public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  state_row public.tcos_kingmaker_private_pricing_coverage_state%rowtype;
  refresh_started_at timestamptz := clock_timestamp();
  refresh_finished_at timestamptz;
  duration_ms integer;
  group_count bigint := 0;
  unresolved_count bigint := 0;
begin
  if not pg_try_advisory_xact_lock(
    hashtext('tcos_kingmaker_private_pricing_coverage_refresh')
  ) then
    return jsonb_build_object(
      'status', 'busy',
      'refreshed', false
    );
  end if;

  select *
  into state_row
  from public.tcos_kingmaker_private_pricing_coverage_state
  where singleton_id = 1
  for update;

  if not coalesce(p_force, false) and not state_row.dirty then
    return jsonb_build_object(
      'status', 'idle',
      'refreshed', false,
      'lastRefreshedAt', state_row.last_refreshed_at,
      'totalGroups', coalesce(state_row.last_group_count, 0),
      'unresolvedRows', coalesce(state_row.last_unresolved_rows, 0)
    );
  end if;

  update public.tcos_kingmaker_private_pricing_coverage_state
  set
    last_refresh_status = 'refreshing',
    last_refresh_started_at = refresh_started_at,
    last_error_code = null,
    updated_at = now()
  where singleton_id = 1;

  create temporary table tcos_private_pricing_coverage_refresh
  on commit drop
  as
  with unresolved_groups as (
    select
      public.tcos_kingmaker_price_normalize(guide.sport) as sport_key,
      coalesce(min(nullif(trim(guide.sport), '')), 'Unknown') as sport,
      coalesce(
        nullif(public.tcos_kingmaker_price_normalize(entry.release_year), ''),
        nullif(public.tcos_kingmaker_price_normalize(entry.season), ''),
        'unknown'
      ) as period_key,
      coalesce(
        min(nullif(trim(entry.release_year), '')),
        min(nullif(trim(entry.season), '')),
        'Unknown'
      ) as release_year,
      public.tcos_kingmaker_price_normalize(entry.manufacturer) as manufacturer_key,
      coalesce(min(nullif(trim(entry.manufacturer), '')), 'Unknown') as manufacturer,
      public.tcos_kingmaker_price_normalize(entry.product) as product_key,
      coalesce(min(nullif(trim(entry.product), '')), 'Unknown') as product,
      public.tcos_kingmaker_price_normalize(entry.set_name) as set_key,
      coalesce(min(nullif(trim(entry.set_name), '')), 'Base / Unspecified') as set_name,
      count(*)::bigint as unresolved_rows,
      count(*) filter (
        where entry.identity_match_status = 'unmatched'
      )::bigint as unmatched_rows,
      count(*) filter (
        where entry.identity_match_status = 'ambiguous'
      )::bigint as ambiguous_rows,
      count(distinct nullif(
        public.tcos_kingmaker_price_normalize(entry.card_number),
        ''
      ))::bigint as distinct_card_numbers,
      count(distinct entry.guide_id)::integer as guide_count,
      round(avg(entry.parse_confidence), 4) as average_parse_confidence,
      max(guide.edition_date) as latest_reference_date
    from public.tcos_kingmaker_price_entries entry
    join public.tcos_kingmaker_price_guides guide
      on guide.id = entry.guide_id
    where entry.entry_kind = 'card'
      and entry.validation_status <> 'rejected'
      and entry.identity_match_status in ('unmatched', 'ambiguous')
      and entry.low_observation_id is null
      and entry.high_observation_id is null
    group by
      public.tcos_kingmaker_price_normalize(guide.sport),
      coalesce(
        nullif(public.tcos_kingmaker_price_normalize(entry.release_year), ''),
        nullif(public.tcos_kingmaker_price_normalize(entry.season), ''),
        'unknown'
      ),
      public.tcos_kingmaker_price_normalize(entry.manufacturer),
      public.tcos_kingmaker_price_normalize(entry.product),
      public.tcos_kingmaker_price_normalize(entry.set_name)
  ), registry_state as (
    select
      unresolved.*,
      count(distinct release.id)::integer as registry_release_count,
      count(distinct version.id)::integer as active_version_count,
      count(distinct set_row.id)::integer as matching_set_count,
      coalesce(max(version.normalized_identity_count), 0)::bigint as active_identity_count
    from unresolved_groups unresolved
    left join public.checklist_sports sport
      on public.tcos_kingmaker_price_normalize(sport.name) = unresolved.sport_key
    left join public.checklist_manufacturers manufacturer
      on public.tcos_kingmaker_price_normalize(manufacturer.name) = unresolved.manufacturer_key
    left join public.checklist_releases release
      on release.sport_id = sport.id
     and release.manufacturer_id = manufacturer.id
     and public.tcos_kingmaker_price_normalize(release.product_name) = unresolved.product_key
     and unresolved.period_key in (
       public.tcos_kingmaker_price_normalize(release.release_year),
       public.tcos_kingmaker_price_normalize(release.season)
     )
    left join public.checklist_versions version
      on version.release_id = release.id
     and version.is_active
     and version.status in ('live', 'revised')
    left join public.checklist_sets set_row
      on set_row.release_id = release.id
     and set_row.version_id = version.id
     and (
       public.tcos_kingmaker_price_normalize(set_row.name) = unresolved.set_key
       or (
         unresolved.set_key in ('', 'base')
         and set_row.set_type = 'base'
       )
     )
    group by
      unresolved.sport_key,
      unresolved.sport,
      unresolved.period_key,
      unresolved.release_year,
      unresolved.manufacturer_key,
      unresolved.manufacturer,
      unresolved.product_key,
      unresolved.product,
      unresolved.set_key,
      unresolved.set_name,
      unresolved.unresolved_rows,
      unresolved.unmatched_rows,
      unresolved.ambiguous_rows,
      unresolved.distinct_card_numbers,
      unresolved.guide_count,
      unresolved.average_parse_confidence,
      unresolved.latest_reference_date
  )
  select
    md5(concat_ws(
      chr(31),
      sport_key,
      period_key,
      manufacturer_key,
      product_key,
      set_key
    )) as snapshot_key,
    sport_key,
    sport,
    period_key,
    release_year,
    manufacturer_key,
    manufacturer,
    product_key,
    product,
    set_key,
    set_name,
    unresolved_rows,
    unmatched_rows,
    ambiguous_rows,
    distinct_card_numbers,
    guide_count,
    average_parse_confidence,
    latest_reference_date,
    registry_release_count,
    active_version_count,
    matching_set_count,
    active_identity_count,
    case
      when registry_release_count = 0 then 'missing_release'
      when active_version_count = 0 then 'checklist_pending'
      when matching_set_count = 0 then 'set_gap'
      else 'identity_gap'
    end as gap_type,
    case
      when registry_release_count = 0
        then 'Create the Registry release and import its authoritative checklist.'
      when active_version_count = 0
        then 'Complete validation and activate a checklist version for this release.'
      when matching_set_count = 0
        then 'Add or repair the missing set within the active checklist version.'
      else 'Repair card, parallel, variation, or numbering identities within the active set.'
    end as recommended_action,
    public.tcos_kingmaker_price_normalize(concat_ws(
      ' ',
      sport,
      release_year,
      manufacturer,
      product,
      set_name
    )) as search_text,
    refresh_started_at as refreshed_at
  from registry_state;

  delete from public.tcos_kingmaker_private_pricing_coverage_snapshot;

  insert into public.tcos_kingmaker_private_pricing_coverage_snapshot (
    snapshot_key,
    sport_key,
    sport,
    period_key,
    release_year,
    manufacturer_key,
    manufacturer,
    product_key,
    product,
    set_key,
    set_name,
    unresolved_rows,
    unmatched_rows,
    ambiguous_rows,
    distinct_card_numbers,
    guide_count,
    average_parse_confidence,
    latest_reference_date,
    registry_release_count,
    active_version_count,
    matching_set_count,
    active_identity_count,
    gap_type,
    recommended_action,
    search_text,
    refreshed_at
  )
  select
    snapshot_key,
    sport_key,
    sport,
    period_key,
    release_year,
    manufacturer_key,
    manufacturer,
    product_key,
    product,
    set_key,
    set_name,
    unresolved_rows,
    unmatched_rows,
    ambiguous_rows,
    distinct_card_numbers,
    guide_count,
    average_parse_confidence,
    latest_reference_date,
    registry_release_count,
    active_version_count,
    matching_set_count,
    active_identity_count,
    gap_type,
    recommended_action,
    search_text,
    refreshed_at
  from tcos_private_pricing_coverage_refresh;

  get diagnostics group_count = row_count;

  select coalesce(sum(unresolved_rows), 0)::bigint
  into unresolved_count
  from public.tcos_kingmaker_private_pricing_coverage_snapshot;

  refresh_finished_at := clock_timestamp();
  duration_ms := greatest(
    0,
    round(extract(epoch from refresh_finished_at - refresh_started_at) * 1000)::integer
  );

  update public.tcos_kingmaker_private_pricing_coverage_state
  set
    dirty = false,
    last_refresh_status = 'succeeded',
    last_refreshed_at = refresh_finished_at,
    last_refresh_duration_ms = duration_ms,
    last_group_count = group_count,
    last_unresolved_rows = unresolved_count,
    last_error_code = null,
    updated_at = now()
  where singleton_id = 1;

  return jsonb_build_object(
    'status', 'succeeded',
    'refreshed', true,
    'refreshedAt', refresh_finished_at,
    'durationMs', duration_ms,
    'totalGroups', group_count,
    'unresolvedRows', unresolved_count
  );
exception
  when others then
    refresh_finished_at := clock_timestamp();
    duration_ms := greatest(
      0,
      round(extract(epoch from refresh_finished_at - refresh_started_at) * 1000)::integer
    );
    update public.tcos_kingmaker_private_pricing_coverage_state
    set
      dirty = true,
      last_refresh_status = 'failed',
      last_refresh_duration_ms = duration_ms,
      last_error_code = sqlstate,
      updated_at = now()
    where singleton_id = 1;
    return jsonb_build_object(
      'status', 'failed',
      'refreshed', false,
      'errorCode', sqlstate,
      'durationMs', duration_ms
    );
end;
$$;

create or replace function public.tcos_kingmaker_private_pricing_coverage_report(
  p_limit integer default 100,
  p_offset integer default 0,
  p_gap_type text default null,
  p_sport text default null,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  effective_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
  effective_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  effective_gap_type text := nullif(lower(trim(coalesce(p_gap_type, ''))), '');
  effective_sport text := nullif(public.tcos_kingmaker_price_normalize(p_sport), '');
  effective_search text := nullif(public.tcos_kingmaker_price_normalize(p_search), '');
  state_row public.tcos_kingmaker_private_pricing_coverage_state%rowtype;
  result_payload jsonb;
begin
  if effective_gap_type is not null
     and effective_gap_type not in (
       'missing_release',
       'checklist_pending',
       'set_gap',
       'identity_gap'
     ) then
    raise exception 'Unsupported private pricing coverage gap type.';
  end if;

  select *
  into state_row
  from public.tcos_kingmaker_private_pricing_coverage_state
  where singleton_id = 1;

  with filtered as (
    select *
    from public.tcos_kingmaker_private_pricing_coverage_snapshot snapshot
    where (effective_gap_type is null or snapshot.gap_type = effective_gap_type)
      and (effective_sport is null or snapshot.sport_key = effective_sport)
      and (
        effective_search is null
        or snapshot.search_text like '%' || effective_search || '%'
      )
  ), ranked as (
    select
      filtered.*,
      row_number() over (
        order by
          unresolved_rows desc,
          case gap_type
            when 'missing_release' then 1
            when 'checklist_pending' then 2
            when 'set_gap' then 3
            else 4
          end,
          distinct_card_numbers desc,
          sport,
          release_year,
          manufacturer,
          product,
          set_name
      )::integer as priority_rank
    from filtered
  ), page_rows as (
    select *
    from ranked
    order by priority_rank
    limit effective_limit
    offset effective_offset
  ), summary as (
    select
      count(*)::bigint as total_groups,
      coalesce(sum(unresolved_rows), 0)::bigint as unresolved_rows,
      coalesce(sum(unmatched_rows), 0)::bigint as unmatched_rows,
      coalesce(sum(ambiguous_rows), 0)::bigint as ambiguous_rows,
      coalesce(sum(unresolved_rows) filter (
        where gap_type = 'missing_release'
      ), 0)::bigint as missing_release_rows,
      coalesce(sum(unresolved_rows) filter (
        where gap_type = 'checklist_pending'
      ), 0)::bigint as checklist_pending_rows,
      coalesce(sum(unresolved_rows) filter (
        where gap_type = 'set_gap'
      ), 0)::bigint as set_gap_rows,
      coalesce(sum(unresolved_rows) filter (
        where gap_type = 'identity_gap'
      ), 0)::bigint as identity_gap_rows,
      coalesce(max(unresolved_rows), 0)::bigint as largest_unlock
    from filtered
  ), page_payload as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', priority_rank,
            'gapType', gap_type,
            'sport', sport,
            'releaseYear', release_year,
            'manufacturer', manufacturer,
            'product', product,
            'setName', set_name,
            'potentialUnlock', unresolved_rows,
            'unmatchedRows', unmatched_rows,
            'ambiguousRows', ambiguous_rows,
            'distinctCardNumbers', distinct_card_numbers,
            'guideCount', guide_count,
            'averageParseConfidence', average_parse_confidence,
            'latestReferenceDate', latest_reference_date,
            'registryReleaseCount', registry_release_count,
            'activeVersionCount', active_version_count,
            'matchingSetCount', matching_set_count,
            'activeIdentityCount', active_identity_count,
            'recommendedAction', recommended_action
          )
          order by priority_rank
        ),
        '[]'::jsonb
      ) as rows,
      count(*)::integer as returned_rows
    from page_rows
  )
  select jsonb_build_object(
    'generatedAt', coalesce(state_row.last_refreshed_at, clock_timestamp()),
    'boundary', 'aggregate_private_reference_only',
    'snapshot', jsonb_build_object(
      'dirty', coalesce(state_row.dirty, true),
      'status', coalesce(state_row.last_refresh_status, 'pending'),
      'lastRefreshedAt', state_row.last_refreshed_at,
      'lastRefreshDurationMs', state_row.last_refresh_duration_ms,
      'ageSeconds', case
        when state_row.last_refreshed_at is null then null
        else greatest(
          0,
          round(extract(epoch from clock_timestamp() - state_row.last_refreshed_at))::bigint
        )
      end
    ),
    'filters', jsonb_build_object(
      'gapType', effective_gap_type,
      'sport', effective_sport,
      'search', effective_search
    ),
    'summary', jsonb_build_object(
      'totalGroups', summary.total_groups,
      'unresolvedRows', summary.unresolved_rows,
      'unmatchedRows', summary.unmatched_rows,
      'ambiguousRows', summary.ambiguous_rows,
      'missingReleaseRows', summary.missing_release_rows,
      'checklistPendingRows', summary.checklist_pending_rows,
      'setGapRows', summary.set_gap_rows,
      'identityGapRows', summary.identity_gap_rows,
      'largestUnlock', summary.largest_unlock
    ),
    'pagination', jsonb_build_object(
      'limit', effective_limit,
      'offset', effective_offset,
      'returned', page_payload.returned_rows,
      'totalGroups', summary.total_groups,
      'hasMore', effective_offset + page_payload.returned_rows < summary.total_groups
    ),
    'rows', page_payload.rows
  )
  into result_payload
  from summary
  cross join page_payload;

  return result_payload;
end;
$$;

revoke all on table public.tcos_kingmaker_private_pricing_coverage_snapshot
  from public, anon, authenticated;
revoke all on table public.tcos_kingmaker_private_pricing_coverage_state
  from public, anon, authenticated;

alter table public.tcos_kingmaker_private_pricing_coverage_snapshot
  enable row level security;
alter table public.tcos_kingmaker_private_pricing_coverage_state
  enable row level security;

revoke all on function public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)
  from public, anon, authenticated;
grant execute on function public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)
  to service_role;

revoke all on function public.tcos_kingmaker_private_pricing_coverage_report(
  integer,
  integer,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.tcos_kingmaker_private_pricing_coverage_report(
  integer,
  integer,
  text,
  text,
  text
) to service_role;

-- Statement-level invalidation keeps imports and checklist updates cheap while
-- guaranteeing the next scheduled refresh knows the snapshot is stale.
do $triggers$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'tcos_kingmaker_price_entries',
    'tcos_kingmaker_price_guides',
    'checklist_sports',
    'checklist_manufacturers',
    'checklist_releases',
    'checklist_versions',
    'checklist_sets'
  ]
  loop
    trigger_name := format('%s_private_pricing_coverage_dirty', table_name);
    execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public.tcos_mark_kingmaker_private_pricing_coverage_dirty()',
      trigger_name,
      table_name
    );
  end loop;
end;
$triggers$;

commit;
