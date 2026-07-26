begin;

create table if not exists public.order_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id bigint not null,
  notification_type text not null check (
    notification_type in ('payment_confirmation', 'shipment_confirmation', 'tracking_updated')
  ),
  recipient_email text not null check (
    char_length(recipient_email) between 3 and 320
    and position('@' in recipient_email) > 1
  ),
  recipient_name text,
  subject text not null check (char_length(subject) between 1 and 500),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'failed', 'cancelled')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 256),
  attempt_count integer not null default 0 check (attempt_count between 0 and 25),
  provider text not null default 'resend' check (provider = 'resend'),
  provider_message_id text,
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, idempotency_key),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete cascade,
  check (
    status <> 'sent'
    or (sent_at is not null and provider_message_id is not null)
  )
);

create index if not exists order_notification_deliveries_retry_idx
  on public.order_notification_deliveries(store_id, status, last_attempt_at, created_at)
  where status in ('pending', 'sending', 'failed');

create index if not exists order_notification_deliveries_order_idx
  on public.order_notification_deliveries(store_id, order_id, created_at desc);

create or replace function public.truely_touch_order_notification_delivery()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists truely_touch_order_notification_delivery_trigger
  on public.order_notification_deliveries;
create trigger truely_touch_order_notification_delivery_trigger
before update on public.order_notification_deliveries
for each row execute function public.truely_touch_order_notification_delivery();

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
    last_error = null,
    updated_at = now()
  where id = p_notification_id
    and store_id = p_store_id
    and attempt_count < 10
    and (
      status in ('pending', 'failed')
      or (
        status = 'sending'
        and (last_attempt_at is null or last_attempt_at < now() - interval '15 minutes')
      )
    )
  returning *;
end;
$$;

alter table public.order_notification_deliveries enable row level security;

revoke all on public.order_notification_deliveries from anon, authenticated;
grant select, insert, update, delete on public.order_notification_deliveries to service_role;

revoke all on function public.truely_touch_order_notification_delivery() from public, anon, authenticated;
revoke all on function public.truely_claim_order_notification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.truely_claim_order_notification(uuid, uuid) to service_role;

commit;
