begin;

set local role postgres;

do $regression$
declare
  report jsonb;
  created jsonb;
  updated jsonb;
  completed jsonb;
  observations_before bigint;
  observations_after bigint;
  save_definition text;
  report_definition text;
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
      'manufacturer-a',
      'Manufacturer A',
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
      'hockey-2025-26-manufacturer-a-product-a-all-sets',
      now()
    ),
    (
      '22222222222222222222222222222222',
      'basketball',
      'Basketball',
      'unknown',
      'Unknown',
      'unknown',
      'Unknown',
      'unknown',
      'Unknown',
      '__all_sets__',
      'All sets',
      800,
      800,
      0,
      60,
      1,
      1,
      0.20,
      current_date,
      0,
      0,
      0,
      0,
      'missing_release',
      'parser_review',
      '["missing_release_period","missing_manufacturer","missing_product"]'::jsonb,
      'Create the Registry release and import its authoritative checklist.',
      'basketball-unknown',
      now()
    );

  report := public.tcos_kingmaker_private_pricing_work_orders_report(
    100,
    0,
    null,
    null
  );

  if report->>'boundary' <> 'private_coverage_work_orders_only' then
    raise exception 'Work-order report boundary failed.';
  end if;
  if (report#>>'{summary,totalTargets}')::integer <> 2
     or (report#>>'{summary,untrackedTargets}')::integer <> 2 then
    raise exception 'Untracked work-order summary failed: %', report;
  end if;
  if report#>>'{rows,0,attackKey}' <> '11111111111111111111111111111111'
     or report#>>'{rows,0,workOrder,status}' <> 'untracked' then
    raise exception 'Actionable target ordering or untracked state failed: %', report;
  end if;

  created := public.tcos_save_kingmaker_private_pricing_work_order(
    '11111111111111111111111111111111',
    'in_progress',
    1,
    'Acquire the authoritative checklist and validate the release.',
    0
  );

  if created->>'status' <> 'in_progress'
     or (created->>'priority')::integer <> 1
     or (created->>'version')::integer <> 1
     or created->>'startedAt' is null then
    raise exception 'Work-order creation failed: %', created;
  end if;

  updated := public.tcos_save_kingmaker_private_pricing_work_order(
    '11111111111111111111111111111111',
    'blocked',
    2,
    'Waiting for a complete checklist artifact.',
    1
  );

  if updated->>'status' <> 'blocked'
     or (updated->>'version')::integer <> 2
     or updated->>'blockedAt' is null then
    raise exception 'Work-order update failed: %', updated;
  end if;

  begin
    perform public.tcos_save_kingmaker_private_pricing_work_order(
      '11111111111111111111111111111111',
      'completed',
      2,
      'Stale update must fail.',
      1
    );
    raise exception 'Stale work-order update unexpectedly succeeded.';
  exception
    when serialization_failure then null;
  end;

  completed := public.tcos_save_kingmaker_private_pricing_work_order(
    '11111111111111111111111111111111',
    'completed',
    2,
    'Checklist imported and target cleared.',
    2
  );

  if completed->>'status' <> 'completed'
     or (completed->>'version')::integer <> 3
     or completed->>'completedAt' is null then
    raise exception 'Work-order completion failed: %', completed;
  end if;

  if (
    select count(*)
    from public.tcos_kingmaker_private_pricing_work_order_audit
    where attack_key = '11111111111111111111111111111111'
  ) <> 3 then
    raise exception 'Immutable work-order audit count failed.';
  end if;

  delete from public.tcos_kingmaker_private_pricing_attack_queue
  where attack_key = '11111111111111111111111111111111';

  report := public.tcos_kingmaker_private_pricing_work_orders_report(
    100,
    0,
    'completed',
    null
  );

  if (report#>>'{summary,inactiveTargets}')::integer <> 1
     or report#>>'{rows,0,targetActive}' <> 'false'
     or report#>>'{rows,0,workOrder,status}' <> 'completed' then
    raise exception 'Inactive completed work-order retention failed: %', report;
  end if;

  if has_function_privilege(
    'anon',
    'public.tcos_save_kingmaker_private_pricing_work_order(text,text,integer,text,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.tcos_kingmaker_private_pricing_work_orders_report(integer,integer,text,text)',
    'execute'
  ) then
    raise exception 'Public role can execute a private work-order function.';
  end if;

  if has_table_privilege(
    'anon',
    'public.tcos_kingmaker_private_pricing_work_orders',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'public.tcos_kingmaker_private_pricing_work_order_audit',
    'select'
  ) then
    raise exception 'Public role can read a private work-order table.';
  end if;

  select pg_get_functiondef(
    'public.tcos_save_kingmaker_private_pricing_work_order(text,text,integer,text,integer)'::regprocedure
  ) into save_definition;
  select pg_get_functiondef(
    'public.tcos_kingmaker_private_pricing_work_orders_report(integer,integer,text,text)'::regprocedure
  ) into report_definition;

  if lower(save_definition || report_definition) like '%raw_text%'
     or lower(save_definition || report_definition) like '%original_filename%'
     or lower(save_definition || report_definition) like '%storage_object_path%'
     or lower(save_definition || report_definition) like '%value_low%'
     or lower(save_definition || report_definition) like '%value_high%' then
    raise exception 'Work-order functions crossed the aggregate privacy boundary.';
  end if;

  select count(*) into observations_after
  from public.tcos_kingmaker_observations;

  if observations_after <> observations_before then
    raise exception 'Work-order operations changed pricing observations.';
  end if;
end;
$regression$;

rollback;
