begin;

set local role postgres;

do $regression$
declare
  report jsonb;
  first_row jsonb;
  current_version integer;
  observations_before bigint;
  observations_after bigint;
  function_definition text;
  target_key text := '33333333333333333333333333333333';
begin
  select count(*) into observations_before
  from public.tcos_kingmaker_observations;

  delete from public.tcos_kingmaker_private_pricing_work_order_audit;
  delete from public.tcos_kingmaker_private_pricing_work_orders;
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
  ) values (
    target_key,
    'hockey',
    'Hockey',
    '2025-26',
    '2025-26',
    'maker-history',
    'Maker History',
    'product-history',
    'Product History',
    '__all_sets__',
    'All sets',
    180,
    160,
    20,
    90,
    2,
    3,
    0.97,
    current_date,
    0,
    0,
    0,
    0,
    'missing_release',
    'actionable',
    '[]'::jsonb,
    'Create the Registry release and import its authoritative checklist.',
    'hockey-2025-26-maker-history-product-history-all-sets',
    clock_timestamp()
  );

  perform public.tcos_save_kingmaker_private_pricing_work_order(
    target_key,
    'queued',
    3,
    'Private target history notes must remain sealed.',
    0
  );

  select version into current_version
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = target_key;

  perform public.tcos_schedule_kingmaker_private_pricing_work_order_review(
    target_key,
    clock_timestamp() + interval '2 days',
    current_version
  );

  select version into current_version
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = target_key;

  perform public.tcos_update_kingmaker_private_pricing_work_order_execution(
    target_key,
    current_version,
    'claim',
    'Private Target History Administrator',
    1,
    clock_timestamp() + interval '1 day',
    null,
    null
  );

  select version into current_version
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = target_key;

  perform public.tcos_update_kingmaker_private_pricing_work_order_execution(
    target_key,
    current_version,
    'update',
    'Private Target History Administrator',
    1,
    clock_timestamp() + interval '1 day',
    'missing_checklist',
    null
  );

  select version into current_version
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = target_key;

  perform public.tcos_update_kingmaker_private_pricing_work_order_execution(
    target_key,
    current_version,
    'resolve',
    null,
    2,
    null,
    null,
    'coverage_fixed'
  );

  report := public.tcos_kingmaker_private_pricing_work_order_target_history_report(
    target_key,
    50,
    0
  );

  if report->>'boundary' <> 'private_coverage_work_order_target_history_only' then
    raise exception 'Target history boundary failed.';
  end if;

  if report#>>'{target,releaseYear}' <> '2025-26'
     or report#>>'{target,manufacturer}' <> 'Maker History'
     or report#>>'{target,product}' <> 'Product History'
     or report#>>'{target,targetActive}' <> 'true'
     or report#>>'{target,status}' <> 'in_progress'
     or (report#>>'{target,version}')::integer <> 5 then
    raise exception 'Target history identity summary failed: %', report#>'{target}';
  end if;

  if (report#>>'{summary,totalEvents}')::integer <> 5
     or (report#>>'{summary,createdEvents}')::integer <> 1
     or (report#>>'{summary,reviewScheduledEvents}')::integer <> 1
     or (report#>>'{summary,claimedEvents}')::integer <> 1
     or (report#>>'{summary,executionUpdatedEvents}')::integer <> 1
     or (report#>>'{summary,resolutionRecordedEvents}')::integer <> 1
     or (report#>>'{pagination,returned}')::integer <> 5
     or report#>>'{pagination,hasMore}' <> 'false' then
    raise exception 'Target history summary failed: %', report;
  end if;

  first_row := report#>'{rows,0}';
  if first_row->>'action' <> 'resolution_recorded'
     or first_row->>'actorType' <> 'admin'
     or (first_row->>'version')::integer <> 5
     or first_row->>'status' <> 'in_progress' then
    raise exception 'Target history newest event failed: %', first_row;
  end if;

  if report ? 'attackKey'
     or report->'target' ? 'attackKey'
     or first_row ? 'attackKey'
     or first_row ? 'assignee'
     or first_row ? 'blockedReason'
     or first_row ? 'resolutionCode'
     or first_row ? 'notes'
     or first_row ? 'notesDigest'
     or first_row ? 'id' then
    raise exception 'Target history exposed private control data: %', report;
  end if;

  if lower(report::text) like '%33333333333333333333333333333333%'
     or lower(report::text) like '%private target history administrator%'
     or lower(report::text) like '%private target history notes%'
     or lower(report::text) like '%raw_text%'
     or lower(report::text) like '%original_filename%'
     or lower(report::text) like '%storage_object_path%'
     or lower(report::text) like '%value_low%'
     or lower(report::text) like '%value_high%' then
    raise exception 'Target history crossed the privacy boundary.';
  end if;

  begin
    perform public.tcos_kingmaker_private_pricing_work_order_target_history_report(
      'missing-target',
      50,
      0
    );
    raise exception 'Missing target did not fail closed.';
  exception
    when sqlstate 'P0002' then null;
  end;

  if has_function_privilege(
    'anon',
    'public.tcos_kingmaker_private_pricing_work_order_target_history_report(text,integer,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_kingmaker_private_pricing_work_order_target_history_report(text,integer,integer)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.tcos_kingmaker_private_pricing_work_order_target_history_report(text,integer,integer)',
    'execute'
  ) then
    raise exception 'Target history privilege boundary failed.';
  end if;

  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_work_order_target_history_report(text,integer,integer)'::regprocedure
  ) into function_definition;

  if lower(function_definition) like '%notes_digest%'
     or lower(function_definition) like '%assignee%'
     or lower(function_definition) like '%blocked_reason%'
     or lower(function_definition) like '%resolution_code%'
     or lower(function_definition) like '%raw_text%'
     or lower(function_definition) like '%original_filename%'
     or lower(function_definition) like '%storage_object_path%'
     or lower(function_definition) like '%value_low%'
     or lower(function_definition) like '%value_high%' then
    raise exception 'Target history function references prohibited private fields.';
  end if;

  select count(*) into observations_after
  from public.tcos_kingmaker_observations;

  if observations_after <> observations_before then
    raise exception 'Target history reporting changed pricing observations.';
  end if;
end;
$regression$;

rollback;
