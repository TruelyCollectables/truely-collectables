begin;

create table if not exists public.seller_marketplace_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  notification_id text not null,
  topic text not null,
  provider_user_id text,
  signature_key_id text,
  event_status text not null default 'received',
  attempt_count integer not null default 1,
  revoke_reason text,
  event_date timestamptz,
  publish_date timestamptz,
  revocation_date timestamptz,
  affected_connection_count integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_webhook_events_provider_check
    check (provider in ('ebay')),
  constraint seller_marketplace_webhook_events_status_check
    check (event_status in ('received', 'processing', 'processed', 'unmatched', 'failed')),
  unique (provider, notification_id)
);

create index if not exists seller_marketplace_webhook_events_status_idx
  on public.seller_marketplace_webhook_events(
    provider,
    event_status,
    received_at desc
  );

create index if not exists seller_marketplace_connections_provider_account_idx
  on public.seller_marketplace_connections(provider, provider_account_id)
  where provider_account_id is not null;

alter table public.seller_marketplace_webhook_events enable row level security;

revoke all privileges on table public.seller_marketplace_webhook_events
  from anon, authenticated;
revoke all privileges on table public.seller_marketplace_webhook_events
  from service_role;

grant select, insert, update on table public.seller_marketplace_webhook_events
  to service_role;

commit;
