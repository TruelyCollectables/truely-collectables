-- KINGMAKER private pricing coverage report.
-- Returns aggregate checklist-gap intelligence only. No source documents,
-- extracted text, pricing values, filenames, or provider attribution are exposed.

begin;

create index if not exists tcos_kingmaker_price_entries_private_coverage_idx
  on public.tcos_kingmaker_price_entries (
    identity_match_status,
    guide_id,
    release_year,
    manufacturer,
    product,
    set_name
  )
  where entry_kind = 'card'
    and validation_status <> 'rejected'
    and identity_match_status in ('unmatched', 'ambiguous')
    and low_observation_id is null
    and high_observation_id is null;

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
  ), classified as (
    select
      registry_state.*,
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
      end as recommended_action
    from registry_state
  ), filtered as (
    select *
    from classified
    where (effective_gap_type is null or gap_type = effective_gap_type)
      and (effective_sport is null or sport_key = effective_sport)
      and (
        effective_search is null
        or public.tcos_kingmaker_price_normalize(concat_ws(
          ' ',
          sport,
          release_year,
          manufacturer,
          product,
          set_name
        )) like '%' || effective_search || '%'
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
    'generatedAt', clock_timestamp(),
    'boundary', 'aggregate_private_reference_only',
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
