-- Expose a source-neutral, administrator-only activity timeline over the
-- existing immutable work-order audit ledger. Private notes, note digests,
-- attack keys, source material, and pricing values never leave the database.

begin;

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
     and effective_action not in ('created','updated','auto_resolved','auto_reopened') then
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
      count(*) filter (where action = 'auto_reopened')::bigint as auto_reopened_events
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
      'autoReopenedEvents', summary.auto_reopened_events
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
