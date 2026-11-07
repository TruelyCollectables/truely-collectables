-- Build a release-aware quality firewall over the cached private pricing
-- coverage snapshot. Actionable Registry work ranks ahead of parser-noise groups,
-- while malformed or incomplete labels remain visible as quarantined work.

begin;

create table if not exists public.tcos_kingmaker_private_pricing_attack_queue (
  attack_key text primary key,
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
  set_group_count integer not null check (set_group_count >= 1),
  average_parse_confidence numeric,
  latest_reference_date date,
  registry_release_count integer not null check (registry_release_count >= 0),
  active_version_count integer not null check (active_version_count >= 0),
  matching_set_count integer not null check (matching_set_count >= 0),
  active_identity_count bigint not null check (active_identity_count >= 0),
  gap_type text not null
    check (gap_type in ('missing_release','checklist_pending','set_gap','identity_gap')),
  actionability_status text not null
    check (actionability_status in ('actionable','parser_review')),
  actionability_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(actionability_reasons) = 'array'),
  recommended_action text not null,
  search_text text not null,
  refreshed_at timestamptz not null
);

create index if not exists tcos_kingmaker_private_pricing_attack_rank_idx
  on public.tcos_kingmaker_private_pricing_attack_queue (
    actionability_status,
    unresolved_rows desc,
    gap_type,
    distinct_card_numbers desc
  );

create index if not exists tcos_kingmaker_private_pricing_attack_filter_idx
  on public.tcos_kingmaker_private_pricing_attack_queue (
    gap_type,
    sport_key,
    actionability_status
  );

create table if not exists public.tcos_kingmaker_private_pricing_attack_state (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  dirty boolean not null default true,
  dirty_at timestamptz not null default now(),
  source_snapshot_refreshed_at timestamptz,
  last_refresh_status text not null default 'pending'
    check (last_refresh_status in ('pending','refreshing','succeeded','failed')),
  last_refresh_started_at timestamptz,
  last_refreshed_at timestamptz,
  last_refresh_duration_ms integer,
  last_group_count bigint,
  last_actionable_rows bigint,
  last_parser_review_rows bigint,
  last_error_code text,
  updated_at timestamptz not null default now()
);

insert into public.tcos_kingmaker_private_pricing_attack_state (
  singleton_id,
  dirty,
  dirty_at,
  last_refresh_status
)
values (1, true, now(), 'pending')
on conflict (singleton_id) do update
set
  dirty = true,
  dirty_at = now(),
  updated_at = now();

create or replace function public.tcos_mark_kingmaker_private_pricing_attack_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tcos_kingmaker_private_pricing_attack_state
  set
    dirty = true,
    dirty_at = now(),
    updated_at = now()
  where singleton_id = 1;
  return null;
end;
$$;

revoke all on function public.tcos_mark_kingmaker_private_pricing_attack_dirty()
  from public, anon, authenticated;

drop trigger if exists tcos_private_pricing_snapshot_attack_dirty
  on public.tcos_kingmaker_private_pricing_coverage_snapshot;
create trigger tcos_private_pricing_snapshot_attack_dirty
  after insert or update or delete
  on public.tcos_kingmaker_private_pricing_coverage_snapshot
  for each statement
  execute function public.tcos_mark_kingmaker_private_pricing_attack_dirty();

create or replace function public.tcos_refresh_kingmaker_private_pricing_attack_queue(
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  base_state public.tcos_kingmaker_private_pricing_coverage_state%rowtype;
  attack_state public.tcos_kingmaker_private_pricing_attack_state%rowtype;
  refresh_started_at timestamptz := clock_timestamp();
  refresh_finished_at timestamptz;
  duration_ms integer;
  group_count bigint := 0;
  actionable_rows bigint := 0;
  parser_review_rows bigint := 0;
begin
  if not pg_try_advisory_xact_lock(
    hashtext('tcos_kingmaker_private_pricing_attack_refresh')
  ) then
    return jsonb_build_object(
      'status', 'busy',
      'refreshed', false
    );
  end if;

  select *
  into base_state
  from public.tcos_kingmaker_private_pricing_coverage_state
  where singleton_id = 1;

  if base_state.last_refresh_status <> 'succeeded'
     or base_state.last_refreshed_at is null then
    return jsonb_build_object(
      'status', 'blocked',
      'refreshed', false,
      'reason', 'base_snapshot_unavailable'
    );
  end if;

  select *
  into attack_state
  from public.tcos_kingmaker_private_pricing_attack_state
  where singleton_id = 1
  for update;

  if not coalesce(p_force, false)
     and not attack_state.dirty
     and attack_state.source_snapshot_refreshed_at = base_state.last_refreshed_at then
    return jsonb_build_object(
      'status', 'idle',
      'refreshed', false,
      'lastRefreshedAt', attack_state.last_refreshed_at,
      'totalGroups', coalesce(attack_state.last_group_count, 0),
      'actionableRows', coalesce(attack_state.last_actionable_rows, 0),
      'parserReviewRows', coalesce(attack_state.last_parser_review_rows, 0)
    );
  end if;

  update public.tcos_kingmaker_private_pricing_attack_state
  set
    last_refresh_status = 'refreshing',
    last_refresh_started_at = refresh_started_at,
    last_error_code = null,
    updated_at = now()
  where singleton_id = 1;

  drop table if exists pg_temp.tcos_private_pricing_attack_refresh;

  create temporary table tcos_private_pricing_attack_refresh
  on commit drop
  as
  with release_level as (
    select
      snapshot.sport_key,
      coalesce(min(snapshot.sport), 'Unknown') as sport,
      snapshot.period_key,
      coalesce(min(snapshot.release_year), 'Unknown') as release_year,
      snapshot.manufacturer_key,
      coalesce(min(snapshot.manufacturer), 'Unknown') as manufacturer,
      snapshot.product_key,
      coalesce(min(snapshot.product), 'Unknown') as product,
      '__all_sets__'::text as set_key,
      'All sets'::text as set_name,
      sum(snapshot.unresolved_rows)::bigint as unresolved_rows,
      sum(snapshot.unmatched_rows)::bigint as unmatched_rows,
      sum(snapshot.ambiguous_rows)::bigint as ambiguous_rows,
      sum(snapshot.distinct_card_numbers)::bigint as distinct_card_numbers,
      max(snapshot.guide_count)::integer as guide_count,
      count(*)::integer as set_group_count,
      case
        when sum(snapshot.unresolved_rows) = 0 then null
        else round(
          sum(
            coalesce(snapshot.average_parse_confidence, 0) *
            snapshot.unresolved_rows
          ) / sum(snapshot.unresolved_rows),
          4
        )
      end as average_parse_confidence,
      max(snapshot.latest_reference_date) as latest_reference_date,
      max(snapshot.registry_release_count)::integer as registry_release_count,
      max(snapshot.active_version_count)::integer as active_version_count,
      max(snapshot.matching_set_count)::integer as matching_set_count,
      max(snapshot.active_identity_count)::bigint as active_identity_count,
      snapshot.gap_type,
      case
        when snapshot.gap_type = 'missing_release'
          then 'Create the Registry release and import its authoritative checklist.'
        else 'Complete validation and activate a checklist version for this release.'
      end as recommended_action,
      max(snapshot.refreshed_at) as source_refreshed_at
    from public.tcos_kingmaker_private_pricing_coverage_snapshot snapshot
    where snapshot.gap_type in ('missing_release', 'checklist_pending')
    group by
      snapshot.sport_key,
      snapshot.period_key,
      snapshot.manufacturer_key,
      snapshot.product_key,
      snapshot.gap_type
  ), set_level as (
    select
      snapshot.sport_key,
      snapshot.sport,
      snapshot.period_key,
      snapshot.release_year,
      snapshot.manufacturer_key,
      snapshot.manufacturer,
      snapshot.product_key,
      snapshot.product,
      snapshot.set_key,
      snapshot.set_name,
      snapshot.unresolved_rows,
      snapshot.unmatched_rows,
      snapshot.ambiguous_rows,
      snapshot.distinct_card_numbers,
      snapshot.guide_count,
      1::integer as set_group_count,
      snapshot.average_parse_confidence,
      snapshot.latest_reference_date,
      snapshot.registry_release_count,
      snapshot.active_version_count,
      snapshot.matching_set_count,
      snapshot.active_identity_count,
      snapshot.gap_type,
      snapshot.recommended_action,
      snapshot.refreshed_at as source_refreshed_at
    from public.tcos_kingmaker_private_pricing_coverage_snapshot snapshot
    where snapshot.gap_type in ('set_gap', 'identity_gap')
  ), grouped as (
    select * from release_level
    union all
    select * from set_level
  ), quality as (
    select
      grouped.*,
      coalesce(reasons.reason_list, '[]'::jsonb) as actionability_reasons
    from grouped
    cross join lateral (
      select jsonb_agg(reason order by reason) as reason_list
      from (
        select 'missing_sport'::text as reason
        where grouped.sport_key in ('', 'unknown')
           or lower(trim(grouped.sport)) = 'unknown'
        union all
        select 'missing_release_period'
        where grouped.period_key in ('', 'unknown')
           or lower(trim(grouped.release_year)) = 'unknown'
        union all
        select 'invalid_release_period'
        where grouped.period_key not in ('', 'unknown')
          and lower(trim(grouped.release_year)) <> 'unknown'
          and trim(grouped.release_year) !~ '^[12][0-9]{3}([-/ ][0-9]{2,4})?$'
        union all
        select 'missing_manufacturer'
        where grouped.manufacturer_key in ('', 'unknown')
           or lower(trim(grouped.manufacturer)) = 'unknown'
        union all
        select 'missing_product'
        where grouped.product_key in ('', 'unknown')
           or lower(trim(grouped.product)) = 'unknown'
        union all
        select 'product_contains_price_text'
        where grouped.product ~ '[0-9]+\.[0-9]{2}'
           or grouped.product ~ '\$[0-9]'
        union all
        select 'product_label_too_long'
        where length(grouped.product) > 120
        union all
        select 'set_label_looks_like_pricing_instruction'
        where grouped.gap_type in ('set_gap', 'identity_gap')
          and (
            trim(grouped.set_name) like '*%'
            or lower(grouped.set_name) ~ '(^|[^a-z])(basic|[0-9.]+x[[:space:]]+to[[:space:]]+[0-9.]+x)([^a-z]|$)'
          )
        union all
        select 'set_label_too_long'
        where grouped.gap_type in ('set_gap', 'identity_gap')
          and length(grouped.set_name) > 140
        union all
        select 'very_low_parse_confidence'
        where grouped.average_parse_confidence is not null
          and grouped.average_parse_confidence < 0.60
      ) detected
    ) reasons
  )
  select
    md5(concat_ws(
      chr(31),
      quality.sport_key,
      quality.period_key,
      quality.manufacturer_key,
      quality.product_key,
      quality.set_key,
      quality.gap_type
    )) as attack_key,
    quality.sport_key,
    quality.sport,
    quality.period_key,
    quality.release_year,
    quality.manufacturer_key,
    quality.manufacturer,
    quality.product_key,
    quality.product,
    quality.set_key,
    quality.set_name,
    quality.unresolved_rows,
    quality.unmatched_rows,
    quality.ambiguous_rows,
    quality.distinct_card_numbers,
    quality.guide_count,
    quality.set_group_count,
    quality.average_parse_confidence,
    quality.latest_reference_date,
    quality.registry_release_count,
    quality.active_version_count,
    quality.matching_set_count,
    quality.active_identity_count,
    quality.gap_type,
    case
      when jsonb_array_length(quality.actionability_reasons) = 0
        then 'actionable'
      else 'parser_review'
    end as actionability_status,
    quality.actionability_reasons,
    quality.recommended_action,
    public.tcos_kingmaker_price_normalize(concat_ws(
      ' ',
      quality.sport,
      quality.release_year,
      quality.manufacturer,
      quality.product,
      quality.set_name
    )) as search_text,
    refresh_started_at as refreshed_at
  from quality;

  delete from public.tcos_kingmaker_private_pricing_attack_queue;

  insert into public.tcos_kingmaker_private_pricing_attack_queue (
    attack_key,
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
    set_group_count,
    average_parse_confidence,
    latest_reference_date,
    registry_release_count,
    active_version_count,
    matching_set_count,
    active_identity_count,
    gap_type,
    actionability_status,
    actionability_reasons,
    recommended_action,
    search_text,
    refreshed_at
  )
  select
    attack_key,
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
    set_group_count,
    average_parse_confidence,
    latest_reference_date,
    registry_release_count,
    active_version_count,
    matching_set_count,
    active_identity_count,
    gap_type,
    actionability_status,
    actionability_reasons,
    recommended_action,
    search_text,
    refreshed_at
  from tcos_private_pricing_attack_refresh;

  get diagnostics group_count = row_count;

  select
    coalesce(sum(unresolved_rows) filter (
      where actionability_status = 'actionable'
    ), 0)::bigint,
    coalesce(sum(unresolved_rows) filter (
      where actionability_status = 'parser_review'
    ), 0)::bigint
  into actionable_rows, parser_review_rows
  from public.tcos_kingmaker_private_pricing_attack_queue;

  refresh_finished_at := clock_timestamp();
  duration_ms := greatest(
    0,
    round(extract(epoch from refresh_finished_at - refresh_started_at) * 1000)::integer
  );

  update public.tcos_kingmaker_private_pricing_attack_state
  set
    dirty = false,
    source_snapshot_refreshed_at = base_state.last_refreshed_at,
    last_refresh_status = 'succeeded',
    last_refreshed_at = refresh_finished_at,
    last_refresh_duration_ms = duration_ms,
    last_group_count = group_count,
    last_actionable_rows = actionable_rows,
    last_parser_review_rows = parser_review_rows,
    last_error_code = null,
    updated_at = now()
  where singleton_id = 1;

  return jsonb_build_object(
    'status', 'succeeded',
    'refreshed', true,
    'refreshedAt', refresh_finished_at,
    'durationMs', duration_ms,
    'totalGroups', group_count,
    'actionableRows', actionable_rows,
    'parserReviewRows', parser_review_rows
  );
exception
  when others then
    refresh_finished_at := clock_timestamp();
    duration_ms := greatest(
      0,
      round(extract(epoch from refresh_finished_at - refresh_started_at) * 1000)::integer
    );
    update public.tcos_kingmaker_private_pricing_attack_state
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
  base_state public.tcos_kingmaker_private_pricing_coverage_state%rowtype;
  attack_state public.tcos_kingmaker_private_pricing_attack_state%rowtype;
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
  into base_state
  from public.tcos_kingmaker_private_pricing_coverage_state
  where singleton_id = 1;

  select *
  into attack_state
  from public.tcos_kingmaker_private_pricing_attack_state
  where singleton_id = 1;

  with filtered as (
    select *
    from public.tcos_kingmaker_private_pricing_attack_queue queue
    where (effective_gap_type is null or queue.gap_type = effective_gap_type)
      and (effective_sport is null or queue.sport_key = effective_sport)
      and (
        effective_search is null
        or queue.search_text like '%' || effective_search || '%'
      )
  ), ranked as (
    select
      filtered.*,
      row_number() over (
        order by
          case actionability_status
            when 'actionable' then 1
            else 2
          end,
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
      count(*) filter (
        where actionability_status = 'actionable'
      )::bigint as actionable_groups,
      coalesce(sum(unresolved_rows) filter (
        where actionability_status = 'actionable'
      ), 0)::bigint as actionable_rows,
      count(*) filter (
        where actionability_status = 'parser_review'
      )::bigint as parser_review_groups,
      coalesce(sum(unresolved_rows) filter (
        where actionability_status = 'parser_review'
      ), 0)::bigint as parser_review_rows,
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
      coalesce(max(unresolved_rows) filter (
        where actionability_status = 'actionable'
      ), 0)::bigint as largest_unlock
    from filtered
  ), page_payload as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', priority_rank,
            'gapType', gap_type,
            'actionabilityStatus', actionability_status,
            'actionabilityReasons', actionability_reasons,
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
            'setGroupCount', set_group_count,
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
    'generatedAt', coalesce(attack_state.last_refreshed_at, clock_timestamp()),
    'boundary', 'aggregate_private_reference_only',
    'snapshot', jsonb_build_object(
      'dirty', coalesce(base_state.dirty, true)
        or coalesce(attack_state.dirty, true)
        or attack_state.source_snapshot_refreshed_at is distinct from base_state.last_refreshed_at,
      'status', coalesce(attack_state.last_refresh_status, 'pending'),
      'lastRefreshedAt', attack_state.last_refreshed_at,
      'lastRefreshDurationMs', attack_state.last_refresh_duration_ms,
      'sourceSnapshotRefreshedAt', attack_state.source_snapshot_refreshed_at,
      'ageSeconds', case
        when attack_state.last_refreshed_at is null then null
        else greatest(
          0,
          round(extract(epoch from clock_timestamp() - attack_state.last_refreshed_at))::bigint
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
      'actionableGroups', summary.actionable_groups,
      'actionableRows', summary.actionable_rows,
      'parserReviewGroups', summary.parser_review_groups,
      'parserReviewRows', summary.parser_review_rows,
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

alter table public.tcos_kingmaker_private_pricing_attack_queue
  enable row level security;
alter table public.tcos_kingmaker_private_pricing_attack_state
  enable row level security;

revoke all on table public.tcos_kingmaker_private_pricing_attack_queue
  from public, anon, authenticated;
revoke all on table public.tcos_kingmaker_private_pricing_attack_state
  from public, anon, authenticated;

revoke all on function public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)
  from public, anon, authenticated;
grant execute on function public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)
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

commit;
