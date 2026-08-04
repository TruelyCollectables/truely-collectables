begin;

set local role postgres;

do $regression$
declare
  resolved_report jsonb;
  observations_before bigint;
  observations_after bigint;
  first_refresh timestamptz := clock_timestamp() + interval '1 second';
  second_refresh timestamptz := clock_timestamp() + interval '2 seconds';
  third_refresh timestamptz := clock_timestamp() + interval '3 seconds';
  reconciliation_definition text;
  trigger_definition text;
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
  values
    (
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
    ),
    (
      '22222222222222222222222222222222',
      'basketball',
      'Basketball',
      '2025',
      '2025',
      'maker-b',
      'Maker B',
      'product-b',
      'Product B',
      '__all_sets__',
      'All sets',
      300,
      300,
      0,
      150,
      1,
      2,
      0.90,
      current_date,
      0,
      0,
      0,
      0,
      'missing_release',
      'actionable',
      '[]'::jsonb,
      'Create the Registry release and import its authoritative checklist.',
      'basketball-2025-maker-b-product-b-all-sets',
      now()
    );

  perform public.tcos_save_kingmaker_private_pricing_work_order(
    '11111111111111111111111111111111',
    'in_progress',
    1,
    'Preserve this private operator note across reconciliation.',
    0
  );

  perform public.tcos_save_kingmaker_private_pricing_work_order(
    '22222222222222222222222222222222',
    'completed',
    2,
    'Manual completion must remain authoritative.',
    0
  );

  delete from public.tcos_kingmaker_private_pricing_attack_queue
  where attack_key in (
    '11111111111111111111111111111111',
    '22222222222222222222222222222222'
  );

  update public.tcos_kingmaker_private_pricing_attack_state
  set
    dirty = false,
    last_refresh_status = 'succeeded',
    last_refreshed_at = first_refresh,
    updated_at = first_refresh
  where singleton_id = 1;

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_work_orders
    where attack_key = '11111111111111111111111111111111'
      and status = 'resolved'
      and version = 2
      and resolution_cycle = 1
      and resolved_at is not null
      and notes = 'Preserve this private operator note across reconciliation.'
  ) then
    raise exception 'Open work order did not auto-resolve with its note preserved.';
  end if;

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_work_order_audit
    where attack_key = '11111111111111111111111111111111'
      and action = 'auto_resolved'
      and status = 'resolved'
      and version = 2
      and notes_changed = false
      and actor_type = 'system'
  ) then
    raise exception 'Auto-resolve audit receipt is missing.';
  end if;

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_work_orders
    where attack_key = '22222222222222222222222222222222'
      and status = 'completed'
      and version = 1
      and resolution_cycle = 0
  ) then
    raise exception 'Manual completion was overridden by reconciliation.';
  end if;

  resolved_report := public.tcos_kingmaker_private_pricing_work_orders_report(
    100,
    0,
    'resolved',
    null
  );

  if (resolved_report#>>'{summary,resolvedTargets}')::integer <> 1
     or resolved_report#>>'{rows,0,workOrder,status}' <> 'resolved'
     or resolved_report#>>'{rows,0,targetActive}' <> 'false'
     or (resolved_report#>>'{rows,0,workOrder,resolutionCycle}')::integer <> 1 then
    raise exception 'Resolved report contract failed: %', resolved_report;
  end if;

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

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_work_orders
    where attack_key = '11111111111111111111111111111111'
      and status = 'queued'
      and version = 3
      and resolution_cycle = 1
      and reopened_at is not null
      and potential_unlock = 125
      and distinct_card_numbers = 80
      and notes = 'Preserve this private operator note across reconciliation.'
  ) then
    raise exception 'Returned target did not reopen with refreshed aggregate values.';
  end if;

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_work_order_audit
    where attack_key = '11111111111111111111111111111111'
      and action = 'auto_reopened'
      and status = 'queued'
      and version = 3
      and notes_changed = false
      and actor_type = 'system'
  ) then
    raise exception 'Auto-reopen audit receipt is missing.';
  end if;

  begin
    perform public.tcos_save_kingmaker_private_pricing_work_order(
      '11111111111111111111111111111111',
      'in_progress',
      1,
      'A stale operator update must not overwrite reconciliation.',
      1
    );
    raise exception 'Stale operator update unexpectedly succeeded.';
  exception
    when serialization_failure then null;
  end;

  update public.tcos_kingmaker_private_pricing_attack_state
  set
    dirty = true,
    last_refresh_status = 'refreshing',
    last_refreshed_at = third_refresh,
    updated_at = third_refresh
  where singleton_id = 1;

  if (
    select version
    from public.tcos_kingmaker_private_pricing_work_orders
    where attack_key = '11111111111111111111111111111111'
  ) <> 3 then
    raise exception 'Non-successful refresh state triggered reconciliation.';
  end if;

  if has_function_privilege(
    'anon',
    'public.tcos_reconcile_kingmaker_private_pricing_work_orders()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_reconcile_kingmaker_private_pricing_work_orders()',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.tcos_reconcile_kingmaker_private_pricing_work_orders()',
    'execute'
  ) then
    raise exception 'Reconciliation RPC privilege boundary failed.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.tcos_kingmaker_private_pricing_attack_state'::regclass
      and tgname = 'tcos_private_pricing_work_orders_reconcile_after_refresh'
      and not tgisinternal
  ) then
    raise exception 'Successful-refresh reconciliation trigger is missing.';
  end if;

  select pg_get_functiondef(
    'public.tcos_reconcile_kingmaker_private_pricing_work_orders()'::regprocedure
  ) into reconciliation_definition;
  select pg_get_functiondef(
    'public.tcos_reconcile_private_pricing_work_orders_after_refresh()'::regprocedure
  ) into trigger_definition;

  if lower(reconciliation_definition || trigger_definition) like '%raw_text%'
     or lower(reconciliation_definition || trigger_definition) like '%original_filename%'
     or lower(reconciliation_definition || trigger_definition) like '%storage_object_path%'
     or lower(reconciliation_definition || trigger_definition) like '%value_low%'
     or lower(reconciliation_definition || trigger_definition) like '%value_high%' then
    raise exception 'Reconciliation crossed the aggregate privacy boundary.';
  end if;

  select count(*) into observations_after
  from public.tcos_kingmaker_observations;

  if observations_after <> observations_before then
    raise exception 'Work-order reconciliation changed pricing observations.';
  end if;
end;
$regression$;

rollback;
