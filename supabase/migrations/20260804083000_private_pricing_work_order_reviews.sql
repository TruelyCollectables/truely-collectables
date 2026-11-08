-- Add private follow-up scheduling for active coverage work orders. Review
-- dates and aggregate attention states are administrator-only. Scheduling is
-- versioned, audited, source-neutral, and cannot mutate pricing observations.

begin;

alter table public.tcos_kingmaker_private_pricing_work_orders
  add column if not exists next_review_at timestamptz,
  add column if not exists review_scheduled_at timestamptz;

do $constraints$
declare
  constraint_record record;
begin
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
end;
$constraints$;

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_action_check
  check (action in (
    'created',
    'updated',
    'auto_resolved',
    'auto_reopened',
    'review_scheduled',
    'review_cleared'
  ));

create index if not exists tcos_km_work_order_next_review_idx
  on public.tcos_kingmaker_private_pricing_work_orders (
    next_review_at,
    priority,
    updated_at desc
  )
  where status in ('queued','in_progress','blocked');

create or replace function public.tcos_schedule_kingmaker_private_pricing_work_order_review(
  p_attack_key text,
  p_next_review_at timestamptz,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  effective_attack_key text := nullif(trim(coalesce(p_attack_key, '')), '');
  existing public.tcos_kingmaker_private_pricing_work_orders%rowtype;
  saved public.tcos_kingmaker_private_pricing_work_orders%rowtype;
  audit_action text;
  changed boolean := false;
begin
  if effective_attack_key is null then
    raise exception 'A private pricing coverage target is required.' using errcode = '22023';
  end if;

  if p_next_review_at is not null
     and p_next_review_at < date_trunc('day', clock_timestamp()) then
    raise exception 'The next review date cannot be in the past.' using errcode = '22023';
  end if;

  if p_next_review_at is not null
     and p_next_review_at > clock_timestamp() + interval '5 years' then
    raise exception 'The next review date is too far in the future.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('tcos_kingmaker_private_pricing_work_order:' || effective_attack_key)
  );

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_attack_queue queue
    where queue.attack_key = effective_attack_key
  ) then
    raise exception 'This private pricing coverage target is no longer active.'
      using errcode = 'P0002';
  end if;

  select *
  into existing
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = effective_attack_key
  for update;

  if not found then
    raise exception 'Create the work order before scheduling a review.'
      using errcode = 'P0002';
  end if;

  if existing.status not in ('queued','in_progress','blocked') then
    raise exception 'Only open work orders can receive a review date.'
      using errcode = '22023';
  end if;

  if p_expected_version is null or p_expected_version <> existing.version then
    raise exception 'The private pricing work order changed. Reload and try again.'
      using errcode = '40001';
  end if;

  changed := existing.next_review_at is distinct from p_next_review_at;
  if not changed then
    saved := existing;
  else
    update public.tcos_kingmaker_private_pricing_work_orders
    set
      next_review_at = p_next_review_at,
      review_scheduled_at = clock_timestamp(),
      version = existing.version + 1,
      updated_at = clock_timestamp()
    where attack_key = effective_attack_key
    returning * into saved;

    audit_action := case
      when p_next_review_at is null then 'review_cleared'
      else 'review_scheduled'
    end;

    insert into public.tcos_kingmaker_private_pricing_work_order_audit (
      attack_key,
      action,
      status,
      priority,
      version,
      notes_changed,
      notes_digest,
      actor_type
    )
    values (
      saved.attack_key,
      audit_action,
      saved.status,
      saved.priority,
      saved.version,
      false,
      md5(saved.notes),
      'admin'
    );
  end if;

  return jsonb_build_object(
    'attackKey', saved.attack_key,
    'status', saved.status,
    'priority', saved.priority,
    'version', saved.version,
    'nextReviewAt', saved.next_review_at,
    'reviewScheduledAt', saved.review_scheduled_at,
    'updatedAt', saved.updated_at,
    'changed', changed
  );
end;
$$;

create or replace function public.tcos_kingmaker_private_pricing_work_order_review_report(
  p_limit integer default 100,
  p_offset integer default 0,
  p_review_state text default null
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
  effective_review_state text := nullif(lower(trim(coalesce(p_review_state, ''))), '');
  result_payload jsonb;
begin
  if effective_review_state is not null
     and effective_review_state not in ('overdue','due_soon','scheduled','unscheduled') then
    raise exception 'Unsupported private pricing review-state filter.' using errcode = '22023';
  end if;

  with open_work as (
    select
      work.attack_key,
      work.status,
      work.priority,
      work.version,
      work.next_review_at,
      work.review_scheduled_at,
      queue.sport,
      queue.release_year,
      queue.manufacturer,
      queue.product,
      queue.set_name,
      queue.gap_type,
      queue.actionability_status,
      queue.unresolved_rows as potential_unlock,
      queue.distinct_card_numbers,
      case
        when work.next_review_at is null then 'unscheduled'
        when work.next_review_at < date_trunc('day', clock_timestamp()) then 'overdue'
        when work.next_review_at < date_trunc('day', clock_timestamp()) + interval '8 days'
          then 'due_soon'
        else 'scheduled'
      end as review_state
    from public.tcos_kingmaker_private_pricing_work_orders work
    join public.tcos_kingmaker_private_pricing_attack_queue queue
      on queue.attack_key = work.attack_key
    where work.status in ('queued','in_progress','blocked')
  ), filtered as (
    select *
    from open_work
    where effective_review_state is null or review_state = effective_review_state
  ), ranked as (
    select
      filtered.*,
      row_number() over (
        order by
          case review_state
            when 'overdue' then 1
            when 'due_soon' then 2
            when 'unscheduled' then 3
            else 4
          end,
          priority,
          next_review_at nulls first,
          potential_unlock desc,
          release_year,
          manufacturer,
          product,
          set_name
      )::integer as review_rank
    from filtered
  ), page_rows as (
    select *
    from ranked
    order by review_rank
    limit effective_limit
    offset effective_offset
  ), summary as (
    select
      count(*)::bigint as total_open_targets,
      count(*) filter (where review_state = 'overdue')::bigint as overdue_targets,
      count(*) filter (where review_state = 'due_soon')::bigint as due_soon_targets,
      count(*) filter (where review_state = 'scheduled')::bigint as scheduled_targets,
      count(*) filter (where review_state = 'unscheduled')::bigint as unscheduled_targets,
      coalesce(sum(potential_unlock) filter (where review_state = 'overdue'), 0)::bigint
        as overdue_potential_unlock,
      coalesce(sum(potential_unlock) filter (where review_state = 'due_soon'), 0)::bigint
        as due_soon_potential_unlock
    from filtered
  ), page_payload as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', review_rank,
            'attackKey', attack_key,
            'status', status,
            'priority', priority,
            'version', version,
            'nextReviewAt', next_review_at,
            'reviewScheduledAt', review_scheduled_at,
            'reviewState', review_state,
            'sport', sport,
            'releaseYear', release_year,
            'manufacturer', manufacturer,
            'product', product,
            'setName', set_name,
            'gapType', gap_type,
            'actionabilityStatus', actionability_status,
            'potentialUnlock', potential_unlock,
            'distinctCardNumbers', distinct_card_numbers
          )
          order by review_rank
        ),
        '[]'::jsonb
      ) as rows,
      count(*)::integer as returned_rows
    from page_rows
  )
  select jsonb_build_object(
    'generatedAt', clock_timestamp(),
    'boundary', 'private_coverage_work_order_reviews_only',
    'filters', jsonb_build_object(
      'reviewState', effective_review_state
    ),
    'summary', jsonb_build_object(
      'totalOpenTargets', summary.total_open_targets,
      'overdueTargets', summary.overdue_targets,
      'dueSoonTargets', summary.due_soon_targets,
      'scheduledTargets', summary.scheduled_targets,
      'unscheduledTargets', summary.unscheduled_targets,
      'overduePotentialUnlock', summary.overdue_potential_unlock,
      'dueSoonPotentialUnlock', summary.due_soon_potential_unlock
    ),
    'pagination', jsonb_build_object(
      'limit', effective_limit,
      'offset', effective_offset,
      'returned', page_payload.returned_rows,
      'totalTargets', summary.total_open_targets,
      'hasMore', effective_offset + page_payload.returned_rows < summary.total_open_targets
    ),
    'rows', page_payload.rows
  )
  into result_payload
  from summary
  cross join page_payload;

  return result_payload;
end;
$$;

create or replace function public.tcos_kingmaker_private_pricing_work_order_activity_report(
  p_limit integer default 100,
  p_offset integer default 0,
  p_action text default null,
  p_actor_type text default null
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
  effective_action text := nullif(lower(trim(coalesce(p_action, ''))), '');
  effective_actor_type text := nullif(lower(trim(coalesce(p_actor_type, ''))), '');
  result_payload jsonb;
begin
  if effective_action is not null
     and effective_action not in (
       'created','updated','auto_resolved','auto_reopened',
       'review_scheduled','review_cleared'
     ) then
    raise exception 'Unsupported private pricing work-order activity filter.'
      using errcode = '22023';
  end if;

  if effective_actor_type is not null
     and effective_actor_type not in ('admin','system') then
    raise exception 'Unsupported private pricing work-order actor filter.'
      using errcode = '22023';
  end if;

  with filtered as (
    select
      audit.action,
      audit.status,
      audit.priority,
      audit.version,
      audit.notes_changed,
      audit.actor_type,
      audit.created_at,
      work.sport,
      work.release_year,
      work.manufacturer,
      work.product,
      work.set_name,
      work.gap_type,
      work.actionability_status,
      exists (
        select 1
        from public.tcos_kingmaker_private_pricing_attack_queue queue
        where queue.attack_key = work.attack_key
      ) as target_active
    from public.tcos_kingmaker_private_pricing_work_order_audit audit
    join public.tcos_kingmaker_private_pricing_work_orders work
      on work.attack_key = audit.attack_key
    where (effective_action is null or audit.action = effective_action)
      and (effective_actor_type is null or audit.actor_type = effective_actor_type)
  ), summary as (
    select
      count(*)::bigint as total_events,
      count(*) filter (where actor_type = 'admin')::bigint as admin_events,
      count(*) filter (where actor_type = 'system')::bigint as system_events,
      count(*) filter (where notes_changed)::bigint as note_change_events,
      count(*) filter (where action = 'created')::bigint as created_events,
      count(*) filter (where action = 'updated')::bigint as updated_events,
      count(*) filter (where action = 'auto_resolved')::bigint as auto_resolved_events,
      count(*) filter (where action = 'auto_reopened')::bigint as auto_reopened_events,
      count(*) filter (where action = 'review_scheduled')::bigint as review_scheduled_events,
      count(*) filter (where action = 'review_cleared')::bigint as review_cleared_events
    from filtered
  ), page_rows as (
    select
      filtered.*,
      row_number() over (
        order by created_at desc, version desc, release_year, manufacturer, product, set_name
      )::integer as event_rank
    from filtered
    order by created_at desc, version desc, release_year, manufacturer, product, set_name
    limit effective_limit
    offset effective_offset
  ), page_payload as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', event_rank,
            'action', action,
            'status', status,
            'priority', priority,
            'version', version,
            'notesChanged', notes_changed,
            'actorType', actor_type,
            'createdAt', created_at,
            'targetActive', target_active,
            'sport', sport,
            'releaseYear', release_year,
            'manufacturer', manufacturer,
            'product', product,
            'setName', set_name,
            'gapType', gap_type,
            'actionabilityStatus', actionability_status
          )
          order by event_rank
        ),
        '[]'::jsonb
      ) as rows,
      count(*)::integer as returned_rows
    from page_rows
  )
  select jsonb_build_object(
    'generatedAt', clock_timestamp(),
    'boundary', 'private_coverage_work_order_activity_only',
    'filters', jsonb_build_object(
      'action', effective_action,
      'actorType', effective_actor_type
    ),
    'summary', jsonb_build_object(
      'totalEvents', summary.total_events,
      'adminEvents', summary.admin_events,
      'systemEvents', summary.system_events,
      'noteChangeEvents', summary.note_change_events,
      'createdEvents', summary.created_events,
      'updatedEvents', summary.updated_events,
      'autoResolvedEvents', summary.auto_resolved_events,
      'autoReopenedEvents', summary.auto_reopened_events,
      'reviewScheduledEvents', summary.review_scheduled_events,
      'reviewClearedEvents', summary.review_cleared_events
    ),
    'pagination', jsonb_build_object(
      'limit', effective_limit,
      'offset', effective_offset,
      'returned', page_payload.returned_rows,
      'totalEvents', summary.total_events,
      'hasMore', effective_offset + page_payload.returned_rows < summary.total_events
    ),
    'rows', page_payload.rows
  )
  into result_payload
  from summary
  cross join page_payload;

  return result_payload;
end;
$$;

revoke all on function public.tcos_schedule_kingmaker_private_pricing_work_order_review(
  text,
  timestamptz,
  integer
) from public, anon, authenticated;
grant execute on function public.tcos_schedule_kingmaker_private_pricing_work_order_review(
  text,
  timestamptz,
  integer
) to service_role;

revoke all on function public.tcos_kingmaker_private_pricing_work_order_review_report(
  integer,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.tcos_kingmaker_private_pricing_work_order_review_report(
  integer,
  integer,
  text
) to service_role;

revoke all on function public.tcos_kingmaker_private_pricing_work_order_activity_report(
  integer,
  integer,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.tcos_kingmaker_private_pricing_work_order_activity_report(
  integer,
  integer,
  text,
  text
) to service_role;

commit;
