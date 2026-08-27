-- Add administrator-controlled ownership and execution metadata to private
-- pricing coverage work orders. All mutations are optimistic, audited, and
-- source-neutral. This migration cannot create or promote pricing observations.

begin;

alter table public.tcos_kingmaker_private_pricing_work_orders
  add column if not exists assignee text,
  add column if not exists claimed_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists resolution_code text;

alter table public.tcos_kingmaker_private_pricing_work_orders
  drop constraint if exists tcos_km_work_order_assignee_check,
  drop constraint if exists tcos_km_work_order_blocked_reason_check,
  drop constraint if exists tcos_km_work_order_resolution_code_check;

alter table public.tcos_kingmaker_private_pricing_work_orders
  add constraint tcos_km_work_order_assignee_check
    check (assignee is null or char_length(assignee) between 1 and 120),
  add constraint tcos_km_work_order_blocked_reason_check
    check (blocked_reason is null or blocked_reason in (
      'missing_checklist','missing_pricing_source','identity_conflict',
      'insufficient_evidence','source_access_problem','other'
    )),
  add constraint tcos_km_work_order_resolution_code_check
    check (resolution_code is null or resolution_code in (
      'coverage_fixed','no_action_needed','invalid_target',
      'more_evidence_required','dismissed_duplicate'
    ));

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  drop constraint if exists tcos_km_work_order_audit_action_check;

alter table public.tcos_kingmaker_private_pricing_work_order_audit
  add constraint tcos_km_work_order_audit_action_check
  check (action in (
    'created','updated','auto_resolved','auto_reopened',
    'review_scheduled','review_cleared','claimed','released',
    'execution_updated','resolution_recorded'
  ));

create index if not exists tcos_km_work_order_execution_queue_idx
  on public.tcos_kingmaker_private_pricing_work_orders (
    status, due_at, priority, updated_at desc
  )
  where status in ('queued','in_progress','blocked');

create or replace function public.tcos_update_kingmaker_private_pricing_work_order_execution(
  p_attack_key text,
  p_expected_version integer,
  p_operation text,
  p_assignee text default null,
  p_priority integer default null,
  p_due_at timestamptz default null,
  p_blocked_reason text default null,
  p_resolution_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  effective_key text := nullif(trim(coalesce(p_attack_key, '')), '');
  effective_operation text := lower(trim(coalesce(p_operation, '')));
  effective_assignee text := nullif(trim(coalesce(p_assignee, '')), '');
  existing public.tcos_kingmaker_private_pricing_work_orders%rowtype;
  saved public.tcos_kingmaker_private_pricing_work_orders%rowtype;
  audit_action text;
begin
  if effective_key is null then
    raise exception 'A private pricing coverage target is required.' using errcode = '22023';
  end if;
  if effective_operation not in ('claim','release','update','resolve') then
    raise exception 'Unsupported work-order execution operation.' using errcode = '22023';
  end if;
  if p_priority is not null and p_priority not between 1 and 5 then
    raise exception 'Priority must be between 1 and 5.' using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at > clock_timestamp() + interval '5 years' then
    raise exception 'The due date is too far in the future.' using errcode = '22023';
  end if;
  if p_blocked_reason is not null and p_blocked_reason not in (
    'missing_checklist','missing_pricing_source','identity_conflict',
    'insufficient_evidence','source_access_problem','other'
  ) then
    raise exception 'Unsupported blocked reason.' using errcode = '22023';
  end if;
  if p_resolution_code is not null and p_resolution_code not in (
    'coverage_fixed','no_action_needed','invalid_target',
    'more_evidence_required','dismissed_duplicate'
  ) then
    raise exception 'Unsupported resolution code.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('tcos_kingmaker_private_pricing_work_order:' || effective_key));
  select * into existing
  from public.tcos_kingmaker_private_pricing_work_orders
  where attack_key = effective_key
  for update;

  if not found then
    raise exception 'Create the work order before changing execution controls.' using errcode = 'P0002';
  end if;
  if p_expected_version is null or p_expected_version <> existing.version then
    raise exception 'The private pricing work order changed. Reload and try again.' using errcode = '40001';
  end if;

  if effective_operation = 'claim' then
    if effective_assignee is null then
      raise exception 'An assignee is required to claim work.' using errcode = '22023';
    end if;
    if existing.status not in ('queued','in_progress','blocked') then
      raise exception 'Only open work orders can be claimed.' using errcode = '22023';
    end if;
    update public.tcos_kingmaker_private_pricing_work_orders set
      assignee = effective_assignee,
      claimed_at = clock_timestamp(),
      released_at = null,
      status = case when status = 'queued' then 'in_progress' else status end,
      started_at = coalesce(started_at, clock_timestamp()),
      priority = coalesce(p_priority, priority),
      due_at = p_due_at,
      version = version + 1,
      updated_at = clock_timestamp()
    where attack_key = effective_key returning * into saved;
    audit_action := 'claimed';
  elsif effective_operation = 'release' then
    if existing.status not in ('queued','in_progress','blocked') then
      raise exception 'Only open work orders can be released.' using errcode = '22023';
    end if;
    update public.tcos_kingmaker_private_pricing_work_orders set
      assignee = null,
      released_at = clock_timestamp(),
      version = version + 1,
      updated_at = clock_timestamp()
    where attack_key = effective_key returning * into saved;
    audit_action := 'released';
  elsif effective_operation = 'resolve' then
    if p_resolution_code is null then
      raise exception 'A resolution category is required.' using errcode = '22023';
    end if;
    update public.tcos_kingmaker_private_pricing_work_orders set
      resolution_code = p_resolution_code,
      blocked_reason = case when p_resolution_code = 'more_evidence_required' then coalesce(p_blocked_reason, blocked_reason) else null end,
      due_at = p_due_at,
      priority = coalesce(p_priority, priority),
      assignee = coalesce(effective_assignee, assignee),
      version = version + 1,
      updated_at = clock_timestamp()
    where attack_key = effective_key returning * into saved;
    audit_action := 'resolution_recorded';
  else
    update public.tcos_kingmaker_private_pricing_work_orders set
      assignee = effective_assignee,
      priority = coalesce(p_priority, priority),
      due_at = p_due_at,
      blocked_reason = p_blocked_reason,
      resolution_code = p_resolution_code,
      version = version + 1,
      updated_at = clock_timestamp()
    where attack_key = effective_key returning * into saved;
    audit_action := 'execution_updated';
  end if;

  insert into public.tcos_kingmaker_private_pricing_work_order_audit (
    attack_key, action, status, priority, version,
    notes_changed, notes_digest, actor_type
  ) values (
    saved.attack_key, audit_action, saved.status, saved.priority, saved.version,
    false, md5(saved.notes), 'admin'
  );

  return jsonb_build_object(
    'attackKey', saved.attack_key,
    'status', saved.status,
    'priority', saved.priority,
    'version', saved.version,
    'assignee', saved.assignee,
    'claimedAt', saved.claimed_at,
    'releasedAt', saved.released_at,
    'dueAt', saved.due_at,
    'blockedReason', saved.blocked_reason,
    'resolutionCode', saved.resolution_code,
    'updatedAt', saved.updated_at
  );
end;
$$;

create or replace function public.tcos_kingmaker_private_pricing_work_order_execution_report(
  p_limit integer default 100,
  p_offset integer default 0,
  p_lane text default null
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
  effective_lane text := nullif(lower(trim(coalesce(p_lane, ''))), '');
  result_payload jsonb;
begin
  if effective_lane is not null and effective_lane not in (
    'unassigned','assigned','overdue','blocked','due_for_review','recently_resolved'
  ) then
    raise exception 'Unsupported execution lane.' using errcode = '22023';
  end if;

  with base as (
    select
      work.attack_key, work.status, work.priority, work.version,
      work.assignee, work.claimed_at, work.released_at, work.due_at,
      work.next_review_at, work.blocked_reason, work.resolution_code,
      work.updated_at, work.resolved_at, work.completed_at,
      queue.sport, queue.release_year, queue.manufacturer, queue.product,
      queue.set_name, queue.gap_type, queue.actionability_status,
      queue.unresolved_rows as potential_unlock,
      case
        when work.status = 'resolved' and coalesce(work.resolved_at, work.updated_at) >= clock_timestamp() - interval '14 days' then 'recently_resolved'
        when work.status = 'blocked' then 'blocked'
        when work.status in ('queued','in_progress') and work.due_at < clock_timestamp() then 'overdue'
        when work.status in ('queued','in_progress','blocked') and work.next_review_at is not null and work.next_review_at < date_trunc('day', clock_timestamp()) + interval '1 day' then 'due_for_review'
        when work.status in ('queued','in_progress','blocked') and work.assignee is null then 'unassigned'
        when work.status in ('queued','in_progress','blocked') and work.assignee is not null then 'assigned'
        else 'other'
      end as lane
    from public.tcos_kingmaker_private_pricing_work_orders work
    left join public.tcos_kingmaker_private_pricing_attack_queue queue
      on queue.attack_key = work.attack_key
  ), filtered as (
    select * from base
    where lane <> 'other' and (effective_lane is null or lane = effective_lane)
  ), ranked as (
    select filtered.*, row_number() over (
      order by
        case lane when 'overdue' then 1 when 'blocked' then 2 when 'due_for_review' then 3 when 'unassigned' then 4 when 'assigned' then 5 else 6 end,
        priority, due_at nulls last, potential_unlock desc nulls last, updated_at desc
    )::integer as execution_rank
    from filtered
  ), page_rows as (
    select * from ranked order by execution_rank
    limit effective_limit offset effective_offset
  ), summary as (
    select
      count(*)::bigint as total_targets,
      count(*) filter (where lane = 'unassigned')::bigint as unassigned_targets,
      count(*) filter (where lane = 'assigned')::bigint as assigned_targets,
      count(*) filter (where lane = 'overdue')::bigint as overdue_targets,
      count(*) filter (where lane = 'blocked')::bigint as blocked_targets,
      count(*) filter (where lane = 'due_for_review')::bigint as due_for_review_targets,
      count(*) filter (where lane = 'recently_resolved')::bigint as recently_resolved_targets
    from filtered
  ), page_payload as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rank', execution_rank,
      'attackKey', attack_key,
      'lane', lane,
      'status', status,
      'priority', priority,
      'version', version,
      'assignee', assignee,
      'claimedAt', claimed_at,
      'releasedAt', released_at,
      'dueAt', due_at,
      'nextReviewAt', next_review_at,
      'blockedReason', blocked_reason,
      'resolutionCode', resolution_code,
      'updatedAt', updated_at,
      'sport', coalesce(sport, 'Unknown'),
      'releaseYear', coalesce(release_year, 'Unknown'),
      'manufacturer', coalesce(manufacturer, 'Unknown'),
      'product', coalesce(product, 'Unknown'),
      'setName', coalesce(set_name, 'Base / Unspecified'),
      'gapType', coalesce(gap_type, 'identity_gap'),
      'actionabilityStatus', coalesce(actionability_status, 'actionable'),
      'potentialUnlock', coalesce(potential_unlock, 0)
    ) order by execution_rank), '[]'::jsonb) as rows,
    count(*)::integer as returned_rows
    from page_rows
  )
  select jsonb_build_object(
    'generatedAt', clock_timestamp(),
    'boundary', 'private_coverage_work_order_execution_only',
    'filters', jsonb_build_object('lane', effective_lane),
    'summary', jsonb_build_object(
      'totalTargets', summary.total_targets,
      'unassignedTargets', summary.unassigned_targets,
      'assignedTargets', summary.assigned_targets,
      'overdueTargets', summary.overdue_targets,
      'blockedTargets', summary.blocked_targets,
      'dueForReviewTargets', summary.due_for_review_targets,
      'recentlyResolvedTargets', summary.recently_resolved_targets
    ),
    'pagination', jsonb_build_object(
      'limit', effective_limit,
      'offset', effective_offset,
      'returned', page_payload.returned_rows,
      'totalTargets', summary.total_targets,
      'hasMore', effective_offset + page_payload.returned_rows < summary.total_targets
    ),
    'rows', page_payload.rows
  ) into result_payload
  from summary cross join page_payload;

  return result_payload;
end;
$$;

revoke all on function public.tcos_update_kingmaker_private_pricing_work_order_execution(text, integer, text, text, integer, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.tcos_kingmaker_private_pricing_work_order_execution_report(integer, integer, text) from public, anon, authenticated;
grant execute on function public.tcos_update_kingmaker_private_pricing_work_order_execution(text, integer, text, text, integer, timestamptz, text, text) to service_role;
grant execute on function public.tcos_kingmaker_private_pricing_work_order_execution_report(integer, integer, text) to service_role;

comment on function public.tcos_update_kingmaker_private_pricing_work_order_execution(text, integer, text, text, integer, timestamptz, text, text)
  is 'Service-only optimistic claim, release, execution, and resolution controls for private pricing work orders.';
comment on function public.tcos_kingmaker_private_pricing_work_order_execution_report(integer, integer, text)
  is 'Service-only aggregate execution queue with no source material or pricing values.';

commit;
