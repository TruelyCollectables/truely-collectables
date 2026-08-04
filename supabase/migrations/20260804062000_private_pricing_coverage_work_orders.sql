-- Turn the aggregate private pricing coverage queue into a versioned,
-- administrator-operated work queue. Work orders remain source-neutral,
-- preserve the target snapshot when a gap later disappears, and never create
-- or promote pricing observations.

begin;

create table if not exists public.tcos_kingmaker_private_pricing_work_orders (
  attack_key text primary key,
  status text not null default 'queued'
    check (status in ('queued','in_progress','blocked','completed','dismissed')),
  priority smallint not null default 3 check (priority between 1 and 5),
  notes text not null default '' check (length(notes) <= 2000),
  version integer not null default 1 check (version >= 1),
  sport text not null,
  release_year text not null,
  manufacturer text not null,
  product text not null,
  set_name text not null,
  gap_type text not null
    check (gap_type in ('missing_release','checklist_pending','set_gap','identity_gap')),
  actionability_status text not null
    check (actionability_status in ('actionable','parser_review')),
  actionability_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(actionability_reasons) = 'array'),
  recommended_action text not null,
  potential_unlock bigint not null check (potential_unlock >= 0),
  distinct_card_numbers bigint not null check (distinct_card_numbers >= 0),
  source_refreshed_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  blocked_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz
);

create index if not exists tcos_kingmaker_private_pricing_work_orders_status_idx
  on public.tcos_kingmaker_private_pricing_work_orders (
    status,
    priority,
    updated_at desc
  );

create table if not exists public.tcos_kingmaker_private_pricing_work_order_audit (
  id bigserial primary key,
  attack_key text not null,
  action text not null check (action in ('created','updated')),
  status text not null
    check (status in ('queued','in_progress','blocked','completed','dismissed')),
  priority smallint not null check (priority between 1 and 5),
  version integer not null check (version >= 1),
  notes_changed boolean not null,
  notes_digest text not null,
  actor_type text not null default 'admin' check (actor_type = 'admin'),
  created_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_private_pricing_work_order_audit_key_idx
  on public.tcos_kingmaker_private_pricing_work_order_audit (
    attack_key,
    created_at desc
  );

create or replace function public.tcos_save_kingmaker_private_pricing_work_order(
  p_attack_key text,
  p_status text,
  p_priority integer,
  p_notes text,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.tcos_kingmaker_private_pricing_attack_queue%rowtype;
  existing public.tcos_kingmaker_private_pricing_work_orders%rowtype;
  saved public.tcos_kingmaker_private_pricing_work_orders%rowtype;
  effective_attack_key text := nullif(trim(coalesce(p_attack_key, '')), '');
  effective_status text := lower(trim(coalesce(p_status, 'queued')));
  effective_priority smallint := greatest(1, least(coalesce(p_priority, 3), 5))::smallint;
  effective_notes text := left(trim(coalesce(p_notes, '')), 2000);
  audit_action text;
  notes_changed boolean;
begin
  if effective_attack_key is null then
    raise exception 'A private pricing coverage target is required.' using errcode = '22023';
  end if;

  if effective_status not in ('queued','in_progress','blocked','completed','dismissed') then
    raise exception 'Unsupported private pricing work-order status.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('tcos_kingmaker_private_pricing_work_order:' || effective_attack_key)
  );

  select *
  into target
  from public.tcos_kingmaker_private_pricing_attack_queue
  where attack_key = effective_attack_key;

  if not found then
    raise exception 'This private pricing coverage target is no longer active.' using errcode = 'P0002';
  end if;

  select *
  into existing
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = effective_attack_key
  for update;

  if not found then
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'The private pricing work order changed. Reload and try again.' using errcode = '40001';
    end if;

    insert into public.tcos_kingmaker_private_pricing_work_orders (
      attack_key,
      status,
      priority,
      notes,
      version,
      sport,
      release_year,
      manufacturer,
      product,
      set_name,
      gap_type,
      actionability_status,
      actionability_reasons,
      recommended_action,
      potential_unlock,
      distinct_card_numbers,
      source_refreshed_at,
      last_seen_at,
      started_at,
      blocked_at,
      completed_at,
      dismissed_at
    )
    values (
      target.attack_key,
      effective_status,
      effective_priority,
      effective_notes,
      1,
      target.sport,
      target.release_year,
      target.manufacturer,
      target.product,
      target.set_name,
      target.gap_type,
      target.actionability_status,
      target.actionability_reasons,
      target.recommended_action,
      target.unresolved_rows,
      target.distinct_card_numbers,
      target.refreshed_at,
      now(),
      case when effective_status = 'in_progress' then now() else null end,
      case when effective_status = 'blocked' then now() else null end,
      case when effective_status = 'completed' then now() else null end,
      case when effective_status = 'dismissed' then now() else null end
    )
    returning * into saved;

    audit_action := 'created';
    notes_changed := effective_notes <> '';
  else
    if p_expected_version is null or p_expected_version <> existing.version then
      raise exception 'The private pricing work order changed. Reload and try again.' using errcode = '40001';
    end if;

    notes_changed := effective_notes is distinct from existing.notes;

    update public.tcos_kingmaker_private_pricing_work_orders
    set
      status = effective_status,
      priority = effective_priority,
      notes = effective_notes,
      version = existing.version + 1,
      sport = target.sport,
      release_year = target.release_year,
      manufacturer = target.manufacturer,
      product = target.product,
      set_name = target.set_name,
      gap_type = target.gap_type,
      actionability_status = target.actionability_status,
      actionability_reasons = target.actionability_reasons,
      recommended_action = target.recommended_action,
      potential_unlock = target.unresolved_rows,
      distinct_card_numbers = target.distinct_card_numbers,
      source_refreshed_at = target.refreshed_at,
      last_seen_at = now(),
      updated_at = now(),
      started_at = case
        when effective_status = 'in_progress' then coalesce(existing.started_at, now())
        else existing.started_at
      end,
      blocked_at = case
        when effective_status = 'blocked' then now()
        else existing.blocked_at
      end,
      completed_at = case
        when effective_status = 'completed' then now()
        else existing.completed_at
      end,
      dismissed_at = case
        when effective_status = 'dismissed' then now()
        else existing.dismissed_at
      end
    where attack_key = effective_attack_key
    returning * into saved;

    audit_action := 'updated';
  end if;

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
    notes_changed,
    md5(saved.notes),
    'admin'
  );

  return jsonb_build_object(
    'attackKey', saved.attack_key,
    'status', saved.status,
    'priority', saved.priority,
    'notes', saved.notes,
    'version', saved.version,
    'updatedAt', saved.updated_at,
    'startedAt', saved.started_at,
    'blockedAt', saved.blocked_at,
    'completedAt', saved.completed_at,
    'dismissedAt', saved.dismissed_at
  );
end;
$$;

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
       'untracked','queued','in_progress','blocked','completed','dismissed'
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
            when 'completed' then 5
            else 6
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

alter table public.tcos_kingmaker_private_pricing_work_orders
  enable row level security;
alter table public.tcos_kingmaker_private_pricing_work_order_audit
  enable row level security;

revoke all on table public.tcos_kingmaker_private_pricing_work_orders
  from public, anon, authenticated;
revoke all on table public.tcos_kingmaker_private_pricing_work_order_audit
  from public, anon, authenticated;

revoke all on function public.tcos_save_kingmaker_private_pricing_work_order(
  text,
  text,
  integer,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.tcos_save_kingmaker_private_pricing_work_order(
  text,
  text,
  integer,
  text,
  integer
) to service_role;

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
