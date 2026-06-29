alter table if exists public.account_auth_events
  add column if not exists failure_reason text;

alter table if exists public.account_auth_events
  add column if not exists lockout_until timestamptz;

create index if not exists account_auth_events_store_ip_created_at_idx
  on public.account_auth_events(store_id, ip_address, created_at desc);

create index if not exists account_auth_events_store_email_created_at_idx
  on public.account_auth_events(store_id, lower(email), created_at desc);

create index if not exists account_auth_events_store_lockout_idx
  on public.account_auth_events(store_id, lockout_until desc)
  where lockout_until is not null;
