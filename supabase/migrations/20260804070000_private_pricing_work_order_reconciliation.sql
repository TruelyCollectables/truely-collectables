-- Keep private pricing coverage work orders aligned with the refreshed attack
-- queue. Active operator work resolves automatically when its aggregate gap
-- clears, then reopens if the same target returns. Manual completion and
-- dismissal remain authoritative.

begin;

do $constraints$
declare
  constraint_record record;
begin
  for constraint_record in
    select constraint_row.conname
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attname = 'status'
     and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid =
      'public.tcos_kingmaker_private_pricing_work_orders'::regclass
      and constraint_row.contype = 'c'
  loop
    execute format(
      'alter table public.tcos_kingmaker_private_pricing_work_orders drop constraint %I',
      constraint_record.conname
    );
  end loop;

  for constraint_record in
    select constraint_row.conname
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attname = 'action'
     and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid =
      'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
      and constraint_row.contype = 'c'
  loop
    execute format(
      'alter table public.tcos_kingmaker_private_pricing_work_order_audit drop constraint %I',
      constraint_record.conname
    );
  end loop;

  for constraint_record in
    select constraint_row.conname
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attname = 'status'
     and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid =
      'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
      and constraint_row.contype = 'c'
  loop
    execute format(
      'alter table public.tcos_kingmaker_private_pricing_work_order_audit drop constraint %I',
      constraint_record.conname
    );
  end loop;

  for constraint_record in
    select constraint_row.conname
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attname = 'actor_type'
     and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid =
      'public.tcos_kingmaker_private_pricing_work_order_audit'::regclass
      and constraint_row.contype = 'c'
  loop
    execute format(
      'alter table public.tcos_kingmaker_private_pricing_work_order_audit drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$constraints$;

alter table public.tcos_kingmaker_private_pricing_work_orders
  add constraint tcos_km_work_order_status_check
  check (status in (
    'queued','in_progress','blocked','resolved','completed','dismissed'
  ));

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_action_check
  check (action in ('created','updated','auto_resolved','auto_reopened'));

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_status_check
  check (status in (
    'queued','in_progress','blocked','resolved','completed','dismissed'
  ));

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_actor_check
  check (actor_type in ('admin','system'));

alter table public.tcos_kingmaker_private_pricing_work_orders
  add column if not exists resolved_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists resolution_cycle integer not null default 0
    check (resolution_cycle >= 0);

create or replace function public.tcos_reconcile_kingmaker_private_pricing_work_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_count bigint := 0;
  resolved_count bigint := 0;
  reopened_count bigint := 0;
  reconciled_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(
    hashtext('tcos_kingmaker_private_pricing_work_order_reconciliation')
  );

  update public.tcos_kingmaker_private_pricing_work_orders work
  set
    sport = queue.sport,
    release_year = queue.release_year,
    manufacturer = queue.manufacturer,
    product = queue.product,
    set_name = queue.set_name,
    gap_type = queue.gap_type,
    actionability_status = queue.actionability_status,
    actionability_reasons = queue.actionability_reasons,
    recommended_action = queue.recommended_action,
    potential_unlock = queue.unresolved_rows,
    distinct_card_numbers = queue.distinct_card_numbers,
    source_refreshed_at = queue.refreshed_at,
    last_seen_at = reconciled_at
  from public.tcos_kingmaker_private_pricing_attack_queue queue
  where work.attack_key = queue.attack_key;

  get diagnostics refreshed_count = row_count;

  with transitioned as (
    update public.tcos_kingmaker_private_pricing_work_orders work
    set
      status = 'resolved',
      version = work.version + 1,
      updated_at = reconciled_at,
      resolved_at = reconciled_at,
      resolution_cycle = work.resolution_cycle + 1
    where work.status in ('queued','in_progress','blocked')
      and not exists (
        select 1
        from public.tcos_kingmaker_private_pricing_attack_queue queue
        where queue.attack_key = work.attack_key
      )
    returning work.*
  ), audited as (
    insert into public.tcos_kingmaker_private_pricing_work_order_audit (
      attack_key,
      action,
      status,
      priority,
      version,
      notes_changed,
      notes_digest,
      actor_type,
      created_at
    )
    select
      transitioned.attack_key,
      'auto_resolved',
      transitioned.status,
      transitioned.priority,
      transitioned.version,
      false,
      md5(transitioned.notes),
      'system',
      reconciled_at
    from transitioned
    returning 1
  )
  select count(*)::bigint into resolved_count
  from audited;

  with transitioned as (
    update public.tcos_kingmaker_private_pricing_work_orders work
    set
      status = 'queued',
      version = work.version + 1,
      updated_at = reconciled_at,
      reopened_at = reconciled_at,
      sport = queue.sport,
      release_year = queue.release_year,
      manufacturer = queue.manufacturer,
      product = queue.product,
      set_name = queue.set_name,
      gap_type = queue.gap_type,
      actionability_status = queue.actionability_status,
      actionability_reasons = queue.actionability_reasons,
      recommended_action = queue.recommended_action,
      potential_unlock = queue.unresolved_rows,
      distinct_card_numbers = queue.distinct_card_numbers,
      source_refreshed_at = queue.refreshed_at,
      last_seen_at = reconciled_at
    from public.tcos_kingmaker_private_pricing_attack_queue queue
    where work.attack_key = queue.attack_key
      and work.status = 'resolved'
    returning work.*
  ), audited as (
    insert into public.tcos_kingmaker_private_pricing_work_order_audit (
      attack_key,
      action,
      status,
      priority,
      version,
      notes_changed,
      notes_digest,
      actor_type,
      created_at
    )
    select
      transitioned.attack_key,
      'auto_reopened',
      transitioned.status,
      transitioned.priority,
      transitioned.version,
      false,
      md5(transitioned.notes),
      'system',
      reconciled_at
    from transitioned
    returning 1
  )
  select count(*)::bigint into reopened_count
  from audited;

  return jsonb_build_object(
    'status', 'succeeded',
    'reconciledAt', reconciled_at,
    'activeTargetsRefreshed', refreshed_count,
    'automaticallyResolved', resolved_count,
    'automaticallyReopened', reopened_count
  );
end;
$$;

create or replace function public.tcos_reconcile_private_pricing_work_orders_after_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tcos_reconcile_kingmaker_private_pricing_work_orders();
  return null;
end;
$$;

revoke all on function public.tcos_reconcile_kingmaker_private_pricing_work_orders()
  from public, anon, authenticated;
grant execute on function public.tcos_reconcile_kingmaker_private_pricing_work_orders()
  to service_role;

revoke all on function public.tcos_reconcile_private_pricing_work_orders_after_refresh()
  from public, anon, authenticated;

drop trigger if exists tcos_private_pricing_work_orders_reconcile_after_refresh
  on public.tcos_kingmaker_private_pricing_attack_state;
create trigger tcos_private_pricing_work_orders_reconcile_after_refresh
  after update of last_refresh_status, last_refreshed_at, dirty
  on public.tcos_kingmaker_private_pricing_attack_state
  for each row
  when (
    new.last_refresh_status = 'succeeded'
    and new.dirty = false
    and new.last_refreshed_at is distinct from old.last_refreshed_at
  )
  execute function public.tcos_reconcile_private_pricing_work_orders_after_refresh();

create or replace function public.tcos_kingmaker_private_pricing_work_orders_report(
  p_limit integer default 100,
  p_offset integer default 0,
  p_status text default null,
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
  effective_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
  effective_search text := nullif(public.tcos_kingmaker_price_normalize(p_search), '');
  result_payload jsonb;
begin
  if effective_status is not null
     and effective_status not in (
       'untracked','queued','in_progress','blocked','resolved','completed','dismissed'
     ) then
    raise exception 'Unsupported private pricing work-order filter.' using errcode = '22023';
  end if;

  with targets as (
    select
      queue.attack_key,
      queue.sport,
      queue.release_year,
      queue.manufacturer,
      queue.product,
      queue.set_name,
      queue.gap_type,
      queue.actionability_status,
      queue.actionability_reasons,
      queue.recommended_action,
      queue.unresolved_rows as potential_unlock,
      queue.distinct_card_numbers,
      queue.refreshed_at as source_refreshed_at,
      queue.search_text,
      true as target_active,
      work.status as stored_status,
      coalesce(work.status, 'untracked') as work_status,
      coalesce(work.priority, 3)::smallint as priority,
      coalesce(work.notes, '') as notes,
      coalesce(work.version, 0) as version,
      work.updated_at,
      work.started_at,
      work.blocked_at,
      work.resolved_at,
      work.reopened_at,
      coalesce(work.resolution_cycle, 0) as resolution_cycle,
      work.completed_at,
      work.dismissed_at
    from public.tcos_kingmaker_private_pricing_attack_queue queue
    left join public.tcos_kingmaker_private_pricing_work_orders work
      on work.attack_key = queue.attack_key

    union all

    select
      work.attack_key,
      work.sport,
      work.release_year,
      work.manufacturer,
      work.product,
      work.set_name,
      work.gap_type,
      work.actionability_status,
      work.actionability_reasons,
      work.recommended_action,
      work.potential_unlock,
      work.distinct_card_numbers,
      work.source_refreshed_at,
      public.tcos_kingmaker_price_normalize(concat_ws(
        ' ',
        work.sport,
        work.release_year,
        work.manufacturer,
        work.product,
        work.set_name
      )) as search_text,
      false as target_active,
      work.status as stored_status,
      work.status as work_status,
      work.priority,
      work.notes,
      work.version,
      work.updated_at,
      work.started_at,
      work.blocked_at,
      work.resolved_at,
      work.reopened_at,
      work.resolution_cycle,
      work.completed_at,
      work.dismissed_at
    from public.tcos_kingmaker_private_pricing_work_orders work
    where not exists (
      select 1
      from public.tcos_kingmaker_private_pricing_attack_queue queue
      where queue.attack_key = work.attack_key
    )
  ), filtered as (
    select *
    from targets
    where (effective_status is null or work_status = effective_status)
      and (
        effective_search is null
        or search_text like '%' || effective_search || '%'
      )
  ), ranked as (
    select
      filtered.*,
      row_number() over (
        order by
          case when target_active then 1 else 2 end,
          case work_status
            when 'in_progress' then 1
            when 'blocked' then 2
            when 'queued' then 3
            when 'untracked' then 4
            when 'resolved' then 5
            when 'completed' then 6
            else 7
          end,
          priority,
          case actionability_status when 'actionable' then 1 else 2 end,
          potential_unlock desc,
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
      count(*)::bigint as total_targets,
      count(*) filter (where stored_status is not null)::bigint as tracked_targets,
      count(*) filter (where work_status = 'untracked')::bigint as untracked_targets,
      count(*) filter (where work_status = 'queued')::bigint as queued_targets,
      count(*) filter (where work_status = 'in_progress')::bigint as in_progress_targets,
      count(*) filter (where work_status = 'blocked')::bigint as blocked_targets,
      count(*) filter (where work_status = 'resolved')::bigint as resolved_targets,
      count(*) filter (where work_status = 'completed')::bigint as completed_targets,
      count(*) filter (where work_status = 'dismissed')::bigint as dismissed_targets,
      count(*) filter (where not target_active)::bigint as inactive_targets,
      coalesce(sum(potential_unlock) filter (where target_active), 0)::bigint
        as active_potential_unlock
    from filtered
  ), page_payload as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', priority_rank,
            'attackKey', attack_key,
            'targetActive', target_active,
            'sport', sport,
            'releaseYear', release_year,
            'manufacturer', manufacturer,
            'product', product,
            'setName', set_name,
            'gapType', gap_type,
            'actionabilityStatus', actionability_status,
            'actionabilityReasons', actionability_reasons,
            'recommendedAction', recommended_action,
            'potentialUnlock', potential_unlock,
            'distinctCardNumbers', distinct_card_numbers,
            'sourceRefreshedAt', source_refreshed_at,
            'workOrder', jsonb_build_object(
              'status', work_status,
              'priority', priority,
              'notes', notes,
              'version', version,
              'updatedAt', updated_at,
              'startedAt', started_at,
              'blockedAt', blocked_at,
              'resolvedAt', resolved_at,
              'reopenedAt', reopened_at,
              'resolutionCycle', resolution_cycle,
              'completedAt', completed_at,
              'dismissedAt', dismissed_at
            )
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
    'boundary', 'private_coverage_work_orders_only',
    'filters', jsonb_build_object(
      'status', effective_status,
      'search', effective_search
    ),
    'summary', jsonb_build_object(
      'totalTargets', summary.total_targets,
      'trackedTargets', summary.tracked_targets,
      'untrackedTargets', summary.untracked_targets,
      'queuedTargets', summary.queued_targets,
      'inProgressTargets', summary.in_progress_targets,
      'blockedTargets', summary.blocked_targets,
      'resolvedTargets', summary.resolved_targets,
      'completedTargets', summary.completed_targets,
      'dismissedTargets', summary.dismissed_targets,
      'inactiveTargets', summary.inactive_targets,
      'activePotentialUnlock', summary.active_potential_unlock
    ),
    'pagination', jsonb_build_object(
      'limit', effective_limit,
      'offset', effective_offset,
      'returned', page_payload.returned_rows,
      'totalTargets', summary.total_targets,
      'hasMore', effective_offset + page_payload.returned_rows < summary.total_targets
    ),
    'rows', page_payload.rows
  )
  into result_payload
  from summary
  cross join page_payload;

  return result_payload;
end;
$$;

revoke all on function public.tcos_kingmaker_private_pricing_work_orders_report(
  integer,
  integer,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.tcos_kingmaker_private_pricing_work_orders_report(
  integer,
  integer,
  text,
  text
) to service_role;

commit;
