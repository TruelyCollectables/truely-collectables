begin;

do $regression$
declare
  source_refresh timestamptz := clock_timestamp() - interval '2 minutes';
  attack_refresh jsonb;
  report jsonb;
  filtered_report jsonb;
  report_definition text;
  refresh_definition text;
begin
  update public.tcos_kingmaker_private_pricing_coverage_state
  set
    dirty = false,
    last_refresh_status = 'succeeded',
    last_refreshed_at = source_refresh,
    last_refresh_duration_ms = 100,
    last_group_count = 8,
    last_unresolved_rows = 720,
    updated_at = now()
  where singleton_id = 1;

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
  ) values
    (
      'valid-release-base', 'basketball', 'Basketball', '202526', '2025-26',
      'panini', 'Panini', 'noir', 'Noir', 'base', 'Base',
      100, 100, 0, 90, 1, 0.95, '2026-08-01',
      0, 0, 0, 0, 'missing_release',
      'Create the Registry release and import its authoritative checklist.',
      'basketball 2025 26 panini noir base', source_refresh
    ),
    (
      'valid-release-insert', 'basketball', 'Basketball', '202526', '2025-26',
      'panini', 'Panini', 'noir', 'color', 'Color',
      50, 49, 1, 45, 1, 0.90, '2026-08-01',
      0, 0, 0, 0, 'missing_release',
      'Create the Registry release and import its authoritative checklist.',
      'basketball 2025 26 panini noir color', source_refresh
    ),
    (
      'unknown-release', 'unknown', 'Unknown', 'unknown', 'Unknown',
      'unknown', 'Unknown', 'unknown', 'Unknown', 'unknown', 'Unknown',
      200, 200, 0, 10, 1, 0.99, '2026-08-01',
      0, 0, 0, 0, 'missing_release',
      'Create the Registry release and import its authoritative checklist.',
      'unknown', source_refresh
    ),
    (
      'price-text-release', 'basketball', 'Basketball', '202526', '2025-26',
      'panini', 'Panini', 'donruss', 'Donruss 15 Player L 1.00 L 2.50',
      'base', 'Base',
      120, 120, 0, 100, 1, 0.97, '2026-08-01',
      0, 0, 0, 0, 'missing_release',
      'Create the Registry release and import its authoritative checklist.',
      'basketball 2025 26 panini donruss', source_refresh
    ),
    (
      'pending-release', 'football', 'Football', '2025', '2025',
      'panini', 'Panini', 'select', 'Select', '__all_sets__', 'All sets',
      80, 80, 0, 75, 1, 0.96, '2026-08-01',
      1, 0, 0, 0, 'checklist_pending',
      'Complete validation and activate a checklist version for this release.',
      'football 2025 panini select all sets', source_refresh
    ),
    (
      'valid-set-gap', 'hockey', 'Hockey', '2025', '2025',
      'upper deck', 'Upper Deck', 'series 1', 'Series 1', 'young guns', 'Young Guns',
      60, 59, 1, 55, 1, 0.94, '2026-08-01',
      1, 1, 0, 250, 'set_gap',
      'Add or repair the missing set within the active checklist version.',
      'hockey 2025 upper deck series 1 young guns', source_refresh
    ),
    (
      'instruction-set-gap', 'hockey', 'Hockey', '2025', '2025',
      'upper deck', 'Upper Deck', 'series 1', 'Series 1',
      'instruction', '*BLUE: 1.2x to 3.0x BASIC',
      70, 70, 0, 2, 1, 0.98, '2026-08-01',
      1, 1, 0, 250, 'set_gap',
      'Add or repair the missing set within the active checklist version.',
      'hockey 2025 upper deck series 1 instruction', source_refresh
    ),
    (
      'identity-gap', 'baseball', 'Baseball', '2025', '2025',
      'topps', 'Topps', 'chrome', 'Chrome', 'base', 'Base',
      40, 35, 5, 38, 1, 0.93, '2026-08-01',
      1, 1, 1, 300, 'identity_gap',
      'Repair card, parallel, variation, or numbering identities within the active set.',
      'baseball 2025 topps chrome base', source_refresh
    );

  select public.tcos_refresh_kingmaker_private_pricing_attack_queue(true)
  into attack_refresh;

  if attack_refresh ->> 'status' <> 'succeeded'
     or not (attack_refresh ->> 'refreshed')::boolean
     or (attack_refresh ->> 'totalGroups')::integer <> 7
     or (attack_refresh ->> 'actionableRows')::integer <> 330
     or (attack_refresh ->> 'parserReviewRows')::integer <> 390 then
    raise exception 'Quality firewall refresh failed: %', attack_refresh;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100, 0, null, null, null
  ) into report;

  if report ->> 'boundary' <> 'aggregate_private_reference_only'
     or (report #>> '{snapshot,dirty}')::boolean
     or report #>> '{snapshot,status}' <> 'succeeded'
     or (report #>> '{summary,totalGroups}')::integer <> 7
     or (report #>> '{summary,unresolvedRows}')::integer <> 720
     or (report #>> '{summary,actionableGroups}')::integer <> 4
     or (report #>> '{summary,actionableRows}')::integer <> 330
     or (report #>> '{summary,parserReviewGroups}')::integer <> 3
     or (report #>> '{summary,parserReviewRows}')::integer <> 390
     or (report #>> '{summary,largestUnlock}')::integer <> 150 then
    raise exception 'Quality firewall summary is incorrect: %', report;
  end if;

  if report #>> '{rows,0,actionabilityStatus}' <> 'actionable'
     or report #>> '{rows,0,product}' <> 'Noir'
     or report #>> '{rows,0,setName}' <> 'All sets'
     or (report #>> '{rows,0,potentialUnlock}')::integer <> 150
     or (report #>> '{rows,0,setGroupCount}')::integer <> 2 then
    raise exception 'Release aggregation or actionable ranking failed: %', report;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(report -> 'rows') row
    where row ->> 'product' = 'Unknown'
      and row ->> 'actionabilityStatus' = 'parser_review'
      and (row -> 'actionabilityReasons') ? 'missing_sport'
      and (row -> 'actionabilityReasons') ? 'missing_manufacturer'
      and (row -> 'actionabilityReasons') ? 'missing_product'
  ) then
    raise exception 'Unknown release was not quarantined with explicit reasons: %', report;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(report -> 'rows') row
    where row ->> 'product' like 'Donruss%'
      and row ->> 'actionabilityStatus' = 'parser_review'
      and (row -> 'actionabilityReasons') ? 'product_contains_price_text'
  ) then
    raise exception 'Price-contaminated product label was not quarantined: %', report;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(report -> 'rows') row
    where row ->> 'setName' like '*BLUE%'
      and row ->> 'actionabilityStatus' = 'parser_review'
      and (row -> 'actionabilityReasons') ? 'set_label_looks_like_pricing_instruction'
  ) then
    raise exception 'Instruction-like set label was not quarantined: %', report;
  end if;

  select public.tcos_kingmaker_private_pricing_coverage_report(
    100, 0, 'missing_release', 'Basketball', 'Noir'
  ) into filtered_report;

  if (filtered_report #>> '{summary,totalGroups}')::integer <> 1
     or (filtered_report #>> '{summary,unresolvedRows}')::integer <> 150
     or filtered_report #>> '{rows,0,actionabilityStatus}' <> 'actionable' then
    raise exception 'Quality-ranked filtering failed: %', filtered_report;
  end if;

  select public.tcos_refresh_kingmaker_private_pricing_attack_queue(false)
  into attack_refresh;
  if attack_refresh ->> 'status' <> 'idle'
     or (attack_refresh ->> 'refreshed')::boolean then
    raise exception 'Clean attack queue did not return idle: %', attack_refresh;
  end if;

  update public.tcos_kingmaker_private_pricing_coverage_snapshot
  set unresolved_rows = unresolved_rows + 1
  where snapshot_key = 'valid-release-base';

  if not (
    select dirty
    from public.tcos_kingmaker_private_pricing_attack_state
    where singleton_id = 1
  ) then
    raise exception 'Base snapshot change did not invalidate the attack queue.';
  end if;

  select public.tcos_refresh_kingmaker_private_pricing_attack_queue(false)
  into attack_refresh;
  if attack_refresh ->> 'status' <> 'succeeded'
     or (attack_refresh ->> 'actionableRows')::integer <> 331 then
    raise exception 'Dirty attack queue did not refresh: %', attack_refresh;
  end if;

  if has_function_privilege(
    'anon',
    'public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)',
    'execute'
  ) then
    raise exception 'Quality firewall privilege boundary is incorrect.';
  end if;

  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)'::regprocedure
  ) into report_definition;
  if report_definition ilike '%tcos_kingmaker_price_entries%'
     or report_definition ilike '%raw_text%'
     or report_definition ilike '%value_low%'
     or report_definition ilike '%value_high%' then
    raise exception 'Interactive report scans prohibited private source fields.';
  end if;

  select pg_get_functiondef(
    'public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)'::regprocedure
  ) into refresh_definition;
  if refresh_definition ilike '%raw_text%'
     or refresh_definition ilike '%value_low%'
     or refresh_definition ilike '%value_high%'
     or refresh_definition ilike '%original_filename%' then
    raise exception 'Quality firewall reads prohibited private source fields.';
  end if;

  if report::text ilike '%raw_text%'
     or report::text ilike '%value_low%'
     or report::text ilike '%value_high%'
     or report::text ilike '%original_filename%'
     or report::text ilike '%source_sha256%'
     or report::text ilike '%storage_object_path%' then
    raise exception 'Quality-ranked report disclosed prohibited fields.';
  end if;

  if exists (select 1 from public.tcos_kingmaker_observations)
     or exists (
       select 1
       from public.tcos_kingmaker_price_entries
       where low_observation_id is not null
          or high_observation_id is not null
     ) then
    raise exception 'Quality firewall created or linked pricing observations.';
  end if;
end;
$regression$;

rollback;
