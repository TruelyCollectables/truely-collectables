begin;

set local role postgres;

do $regression$
declare
  report jsonb;
  admin_report jsonb;
  system_report jsonb;
  first_row jsonb;
  observations_before bigint;
  observations_after bigint;
  first_refresh timestamptz := clock_timestamp() + interval '1 second';
  second_refresh timestamptz := clock_timestamp() + interval '2 seconds';
  function_definition text;
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
  )
  values (
    '11111111111111111111111111111111',
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
    500,
    480,
    20,
    250,
    2,
    4,
    0.95,
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
    now()
  );

  perform public.tcos_save_kingmaker_private_pricing_work_order(
    '11111111111111111111111111111111',
    'queued',
    2,
    'This private sentence must never leave the database.',
    0
  );

  perform public.tcos_save_kingmaker_private_pricing_work_order(
    '11111111111111111111111111111111',
    'blocked',
    1,
    'A different private sentence must remain sealed.',
    1
  );

  delete from public.tcos_kingmaker_private_pricing_attack_queue
  where attack_key = '11111111111111111111111111111111';

  update public.tcos_kingmaker_private_pricing_attack_state
  set
    dirty = false,
    last_refresh_status = 'succeeded',
    last_refreshed_at = first_refresh,
    updated_at = first_refresh
  where singleton_id = 1;

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
  values (
    '11111111111111111111111111111111',
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
    125,
    100,
    25,
    80,
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
    second_refresh
  );

  update public.tcos_kingmaker_private_pricing_attack_state
  set
    dirty = false,
    last_refresh_status = 'succeeded',
    last_refreshed_at = second_refresh,
    updated_at = second_refresh
  where singleton_id = 1;

  update public.tcos_kingmaker_private_pricing_work_order_audit
  set created_at = case action
    when 'created' then '2026-08-04T12:00:00Z'::timestamptz
    when 'updated' then '2026-08-04T12:01:00Z'::timestamptz
    when 'auto_resolved' then '2026-08-04T12:02:00Z'::timestamptz
    when 'auto_reopened' then '2026-08-04T12:03:00Z'::timestamptz
    else created_at
  end;

  report := public.tcos_kingmaker_private_pricing_work_order_activity_report(
    100,
    0,
    null,
    null
  );

  if report->>'boundary' <> 'private_coverage_work_order_activity_only' then
    raise exception 'Activity report boundary failed.';
  end if;

  if (report#>>'{summary,totalEvents}')::integer <> 4
     or (report#>>'{summary,adminEvents}')::integer <> 2
     or (report#>>'{summary,systemEvents}')::integer <> 2
     or (report#>>'{summary,noteChangeEvents}')::integer <> 2
     or (report#>>'{summary,createdEvents}')::integer <> 1
     or (report#>>'{summary,updatedEvents}')::integer <> 1
     or (report#>>'{summary,autoResolvedEvents}')::integer <> 1
     or (report#>>'{summary,autoReopenedEvents}')::integer <> 1 then
    raise exception 'Activity report summary failed: %', report;
  end if;

  first_row := report#>'{rows,0}';
  if first_row->>'action' <> 'auto_reopened'
     or first_row->>'actorType' <> 'system'
     or first_row->>'status' <> 'queued'
     or (first_row->>'version')::integer <> 4
     or first_row->>'targetActive' <> 'true' then
    raise exception 'Newest-first activity ordering failed: %', first_row;
  end if;

  if first_row ? 'attackKey'
     or first_row ? 'notes'
     or first_row ? 'notesDigest'
     or first_row ? 'notes_digest'
     or first_row ? 'id' then
    raise exception 'Activity row exposed a private identifier or private text field: %', first_row;
  end if;

  if lower(report::text) like '%this private sentence%'
     or lower(report::text) like '%different private sentence%'
     or lower(report::text) like '%11111111111111111111111111111111%'
     or lower(report::text) like '%raw_text%'
     or lower(report::text) like '%original_filename%'
     or lower(report::text) like '%storage_object_path%'
     or lower(report::text) like '%value_low%'
     or lower(report::text) like '%value_high%' then
    raise exception 'Activity report crossed the privacy boundary.';
  end if;

  admin_report := public.tcos_kingmaker_private_pricing_work_order_activity_report(
    100,
    0,
    null,
    'admin'
  );
  if (admin_report#>>'{summary,totalEvents}')::integer <> 2
     or admin_report#>>'{rows,0,actorType}' <> 'admin'
     or admin_report#>>'{rows,1,actorType}' <> 'admin' then
    raise exception 'Administrator activity filter failed: %', admin_report;
  end if;

  system_report := public.tcos_kingmaker_private_pricing_work_order_activity_report(
    100,
    0,
    'auto_resolved',
    'system'
  );
  if (system_report#>>'{summary,totalEvents}')::integer <> 1
     or system_report#>>'{rows,0,action}' <> 'auto_resolved'
     or system_report#>>'{rows,0,actorType}' <> 'system' then
    raise exception 'System activity filter failed: %', system_report;
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
    raise exception 'Activity report privilege boundary failed.';
  end if;

  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_work_order_activity_report(integer,integer,text,text)'::regprocedure
  ) into function_definition;

  if lower(function_definition) like '%notes_digest%'
     or lower(function_definition) like '%raw_text%'
     or lower(function_definition) like '%original_filename%'
     or lower(function_definition) like '%storage_object_path%'
     or lower(function_definition) like '%value_low%'
     or lower(function_definition) like '%value_high%' then
    raise exception 'Activity report function references prohibited private fields.';
  end if;

  select count(*) into observations_after
  from public.tcos_kingmaker_observations;

  if observations_after <> observations_before then
    raise exception 'Activity reporting changed pricing observations.';
  end if;
end;
$regression$;

rollback;
