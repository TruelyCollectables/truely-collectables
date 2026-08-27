-- Provide a source-neutral, administrator-only history report for one private
-- pricing coverage work order. The target key is accepted only as a trusted
-- service-role parameter and is never returned. Private notes, note digests,
-- assignee labels, blocker values, resolution values, source material, and
-- pricing values remain sealed inside the database.

begin;

create or replace function public.tcos_kingmaker_private_pricing_work_order_target_history_report(
  p_attack_key text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  effective_key text := nullif(trim(coalesce(p_attack_key, '')), '');
  effective_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  effective_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  result_payload jsonb;
begin
  if effective_key is null then
    raise exception 'A private pricing coverage target is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tcos_kingmaker_private_pricing_work_orders work
    where work.attack_key = effective_key
  ) then
    raise exception 'The private pricing work order was not found.'
      using errcode = 'P0002';
  end if;

  with selected_work as (
    select
      work.status,
      work.priority,
      work.version,
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
    from public.tcos_kingmaker_private_pricing_work_orders work
    where work.attack_key = effective_key
  ), filtered as (
    select
      audit.action,
      audit.status,
      audit.priority,
      audit.version,
      audit.notes_changed,
      audit.actor_type,
      audit.created_at
    from public.tcos_kingmaker_private_pricing_work_order_audit audit
    where audit.attack_key = effective_key
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
      count(*) filter (where action = 'review_cleared')::bigint as review_cleared_events,
      count(*) filter (where action = 'claimed')::bigint as claimed_events,
      count(*) filter (where action = 'released')::bigint as released_events,
      count(*) filter (where action = 'execution_updated')::bigint as execution_updated_events,
      count(*) filter (where action = 'resolution_recorded')::bigint as resolution_recorded_events
    from filtered
  ), ranked as (
    select
      filtered.*,
      row_number() over (
        order by created_at desc, version desc, action
      )::integer as event_rank
    from filtered
  ), page_rows as (
    select *
    from ranked
    order by event_rank
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
            'createdAt', created_at
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
    'boundary', 'private_coverage_work_order_target_history_only',
    'target', jsonb_build_object(
      'status', selected_work.status,
      'priority', selected_work.priority,
      'version', selected_work.version,
      'targetActive', selected_work.target_active,
      'sport', selected_work.sport,
      'releaseYear', selected_work.release_year,
      'manufacturer', selected_work.manufacturer,
      'product', selected_work.product,
      'setName', selected_work.set_name,
      'gapType', selected_work.gap_type,
      'actionabilityStatus', selected_work.actionability_status
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
      'reviewClearedEvents', summary.review_cleared_events,
      'claimedEvents', summary.claimed_events,
      'releasedEvents', summary.released_events,
      'executionUpdatedEvents', summary.execution_updated_events,
      'resolutionRecordedEvents', summary.resolution_recorded_events
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
  from selected_work
  cross join summary
  cross join page_payload;

  return result_payload;
end;
$$;

revoke all on function public.tcos_kingmaker_private_pricing_work_order_target_history_report(
  text,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.tcos_kingmaker_private_pricing_work_order_target_history_report(
  text,
  integer,
  integer
) to service_role;

commit;
