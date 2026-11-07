begin;

set local role postgres;

do $regression$
declare
  report jsonb;
  claimed_report jsonb;
  first_row jsonb;
  current_version integer;
  observations_before bigint;
  observations_after bigint;
  function_definition text;
  target_key text := '22222222222222222222222222222222';
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
    'maker-a',
    'Maker A',
    'product-a',
    'Product A',
    '__all_sets__',
    'All sets',
    250,
    225,
    25,
    125,
    2,
    4,
    0.96,
    current_date,
    0,
    0,
    0,
    0,
    'missing_release',
    'actionable',
    '[]'::jsonb,
    'Create the Registry release and import its authoritative checklist.',
    'hockey-2025-26-maker-a-product-a-all-sets',
    clock_timestamp()
  );

  perform public.tcos_save_kingmaker_private_pricing_work_order(
    target_key,
    'queued',
    3,
    'Private execution notes must never appear in the activity timeline.',
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
    'Private Audit Administrator',
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
    'Private Audit Administrator',
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
    'release',
    null,
    null,
    null,
    null,
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

  select version into current_version
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = target_key;

  perform public.tcos_schedule_kingmaker_private_pricing_work_order_review(
    target_key,
    null,
    current_version
  );

  report := public.tcos_kingmaker_private_pricing_work_order_activity_report(
    100,
    0,
    null,
    null
  );

  if report->>'boundary' <> 'private_coverage_work_order_activity_only' then
    raise exception 'Execution activity boundary failed.';
  end if;

  if (report#>>'{summary,totalEvents}')::integer <> 7
     or (report#>>'{summary,adminEvents}')::integer <> 7
     or (report#>>'{summary,systemEvents}')::integer <> 0
     or (report#>>'{summary,createdEvents}')::integer <> 1
     or (report#>>'{summary,reviewScheduledEvents}')::integer <> 1
     or (report#>>'{summary,reviewClearedEvents}')::integer <> 1
     or (report#>>'{summary,claimedEvents}')::integer <> 1
     or (report#>>'{summary,releasedEvents}')::integer <> 1
     or (report#>>'{summary,executionUpdatedEvents}')::integer <> 1
     or (report#>>'{summary,resolutionRecordedEvents}')::integer <> 1 then
    raise exception 'Execution activity summary failed: %', report;
  end if;

  first_row := report#>'{rows,0}';
  if first_row->>'action' <> 'review_cleared'
     or first_row->>'actorType' <> 'admin'
     or (first_row->>'version')::integer <> 7
     or first_row->>'targetActive' <> 'true' then
    raise exception 'Newest execution activity event failed: %', first_row;
  end if;

  claimed_report := public.tcos_kingmaker_private_pricing_work_order_activity_report(
    100,
    0,
    'claimed',
    'admin'
  );

  if (claimed_report#>>'{summary,totalEvents}')::integer <> 1
     or claimed_report#>>'{rows,0,action}' <> 'claimed'
     or claimed_report#>>'{rows,0,actorType}' <> 'admin' then
    raise exception 'Claimed activity filter failed: %', claimed_report;
  end if;

  if first_row ? 'attackKey'
     or first_row ? 'assignee'
     or first_row ? 'blockedReason'
     or first_row ? 'resolutionCode'
     or first_row ? 'notes'
     or first_row ? 'notesDigest'
     or first_row ? 'id' then
    raise exception 'Execution activity exposed private control data: %', first_row;
  end if;

  if lower(report::text) like '%22222222222222222222222222222222%'
     or lower(report::text) like '%private audit administrator%'
     or lower(report::text) like '%private execution notes%'
     or lower(report::text) like '%raw_text%'
     or lower(report::text) like '%original_filename%'
     or lower(report::text) like '%storage_object_path%'
     or lower(report::text) like '%value_low%'
     or lower(report::text) like '%value_high%' then
    raise exception 'Execution activity crossed the privacy boundary.';
  end if;

  if has_function_privilege(
    'anon',
    'public.tcos_kingmaker_private_pricing_work_order_activity_report(integer,integer,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_kingmaker_private_pricing_work_order_activity_report(integer,integer,text,text)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.tcos_kingmaker_private_pricing_work_order_activity_report(integer,integer,text,text)',
    'execute'
  ) then
    raise exception 'Execution activity privilege boundary failed.';
  end if;

  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_work_order_activity_report(integer,integer,text,text)'::regprocedure
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
    raise exception 'Execution activity function references prohibited private fields.';
  end if;

  select count(*) into observations_after
  from public.tcos_kingmaker_observations;

  if observations_after <> observations_before then
    raise exception 'Execution activity reporting changed pricing observations.';
  end if;
end;
$regression$;

rollback;
