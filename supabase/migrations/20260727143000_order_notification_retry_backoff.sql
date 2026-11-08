begin;

alter table public.order_notification_deliveries
  add column if not exists next_attempt_at timestamptz;

update public.order_notification_deliveries
set next_attempt_at = case
  when status in ('sent', 'cancelled') then coalesce(sent_at, updated_at, now())
  when status = 'sending' then
    coalesce(last_attempt_at, updated_at, now()) + interval '15 minutes'
  when status = 'failed' then
    coalesce(last_attempt_at, updated_at, now())
    + case
        when attempt_count <= 1 then interval '15 minutes'
        when attempt_count = 2 then interval '30 minutes'
        when attempt_count = 3 then interval '1 hour'
        when attempt_count = 4 then interval '2 hours'
        when attempt_count = 5 then interval '4 hours'
        else interval '6 hours'
      end
  else now()
end
where next_attempt_at is null;

alter table public.order_notification_deliveries
  alter column next_attempt_at set default now(),
  alter column next_attempt_at set not null;

drop index if exists public.order_notification_deliveries_retry_idx;
create index order_notification_deliveries_retry_idx
  on public.order_notification_deliveries (
    store_id,
    status,
    next_attempt_at,
    created_at
  )
  where status in ('pending', 'sending', 'failed');

create or replace function public.truely_claim_order_notification(
  p_notification_id uuid,
  p_store_id uuid
)
returns setof public.order_notification_deliveries
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return query
  update public.order_notification_deliveries
  set
    status = 'sending',
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    next_attempt_at = now() + interval '15 minutes',
    last_error = null,
    updated_at = now()
  where id = p_notification_id
    and store_id = p_store_id
    and attempt_count < 10
    and next_attempt_at <= now()
    and (
      status in ('pending', 'failed')
      or (
        status = 'sending'
        and (
          last_attempt_at is null
          or last_attempt_at < now() - interval '15 minutes'
        )
      )
    )
  returning *;
end;
$$;

revoke all on function public.truely_claim_order_notification(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.truely_claim_order_notification(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
